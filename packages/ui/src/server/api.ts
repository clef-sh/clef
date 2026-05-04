import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync, spawn } from "child_process";
import { Router, Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import * as YAML from "yaml";

// On Linux, libuv creates socketpairs for child stdio. Go's os.Open on
// /dev/stdin re-opens /proc/self/fd/0 which fails with ENXIO on socketpairs.
// Use a FIFO workaround on Linux, but not inside Jest (where the runner is
// mocked and real subprocesses are never spawned).
const _useStdinFifo = process.platform === "linux" && !process.env.JEST_WORKER_ID;
import {
  ManifestParser,
  MatrixManager,
  SopsClient,
  DiffEngine,
  LintRunner,
  SchemaValidator,
  GitIntegration,
  ScanRunner,
  SubprocessRunner,
  ClefManifest,
  composeSecretSource,
  createSopsEncryptionBackend,
  FilesystemStorageBackend,
  ScanResult,
  KmsConfig,
  getPendingKeys,
  markResolved,
  markPendingWithRetry,
  recordRotation,
  removeRotation,
  generateRandomValue,
  ImportRunner,
  RecipientManager,
  ServiceIdentityManager,
  StructureManager,
  TransactionManager,
  validateAgePublicKey,
  VALID_KMS_PROVIDERS,
  BackendMigrator,
  ResetManager,
  SyncManager,
  resolveBackendConfig,
  validateResetScope,
  PolicyParser,
  CLEF_POLICY_FILENAME,
  PolicyValidationError,
  runCompliance,
  writeSchema,
  NamespaceSchema,
  SchemaKey,
} from "@clef-sh/core";
import type { BackendType, ImportFormat, MigrationProgressEvent, ResetScope } from "@clef-sh/core";
import { registerEnvelopeRoutes } from "./envelope";

export interface ApiDeps {
  runner: SubprocessRunner;
  repoRoot: string;
  ageKeyFile?: string;
  ageKey?: string;
  sopsPath?: string;
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const parser = new ManifestParser();
  const matrix = new MatrixManager();
  // Wrap the runner so sops subprocesses always run from the repo root
  // and work around /dev/stdin failures on Linux.
  //
  // Problem: SopsClient.encrypt passes /dev/stdin as the input file.
  // On Linux /dev/stdin → /proc/self/fd/0 which fails with ENXIO when
  // the Node SEA binary was spawned with stdin detached.
  //
  // Fix: when we see /dev/stdin in the args AND stdin content in opts,
  // replace it with a FIFO (named pipe). A FIFO is an in-memory kernel
  // buffer — plaintext never touches disk. The FIFO is cleaned up after
  // the subprocess exits.
  const sopsRunner: SubprocessRunner = {
    run: (cmd, args, opts) => {
      const stdinIdx = args.indexOf("/dev/stdin");
      // Only use the FIFO workaround in Linux SEA binaries where
      // /dev/stdin → /proc/self/fd/0 fails with ENXIO on socketpairs.
      // Normal Node.js processes (including Jest on Linux CI) work fine.
      const needsFifo = stdinIdx >= 0 && opts?.stdin !== undefined && _useStdinFifo;

      if (!needsFifo) {
        return deps.runner.run(cmd, args, {
          ...opts,
          cwd: opts?.cwd ?? deps.repoRoot,
          env: opts?.env,
        });
      }

      // Create a FIFO and feed stdin content through a background process
      const fifoDir = execFileSync("mktemp", ["-d", path.join(os.tmpdir(), "clef-fifo-XXXXXX")])
        .toString()
        .trim();
      const fifoPath = path.join(fifoDir, "input");
      execFileSync("mkfifo", [fifoPath]);

      // Background writer — blocks at OS level until sops opens the read end
      const writer = spawn("dd", [`of=${fifoPath}`, "status=none"], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      writer.stdin.write(opts.stdin);
      writer.stdin.end();

      const patchedArgs = [...args];
      patchedArgs[stdinIdx] = fifoPath;

      const { stdin: _stdin, ...restOpts } = opts;

      return deps.runner
        .run(cmd, patchedArgs, {
          ...restOpts,
          cwd: restOpts?.cwd ?? deps.repoRoot,
          ...(restOpts?.env ? { env: restOpts.env } : {}),
        })
        .finally(() => {
          try {
            writer.kill();
          } catch {
            /* already exited */
          }
          try {
            execFileSync("rm", ["-rf", fifoDir]);
          } catch {
            /* best effort */
          }
        });
    },
  };
  const sops = new SopsClient(sopsRunner, deps.ageKeyFile, deps.ageKey, deps.sopsPath);
  const diffEngine = new DiffEngine();
  const schemaValidator = new SchemaValidator();
  const git = new GitIntegration(deps.runner);
  const tx = new TransactionManager(git);
  const scanRunner = new ScanRunner(deps.runner);
  // Manifest-bound managers are constructed per-request so the manifest
  // edits the user makes through other UI flows are picked up without
  // restarting the server.
  const buildSourceFor = (manifest: ClefManifest) =>
    composeSecretSource(
      new FilesystemStorageBackend(manifest, deps.repoRoot),
      createSopsEncryptionBackend(sops),
      manifest,
    );
  const structureManager = new StructureManager(matrix, buildSourceFor, tx);

  // In-session scan cache
  let lastScanResult: ScanResult | null = null;
  let lastScanAt: string | null = null;

  function loadManifest(): ClefManifest {
    const manifestPath = `${deps.repoRoot}/clef.yaml`;
    return parser.parse(manifestPath);
  }

  function zeroStringRecord(record: Record<string, string>): void {
    for (const k of Object.keys(record)) record[k] = "";
  }

  /**
   * Strict-shape validator for an incoming schema payload from the UI.
   * Returns a clean NamespaceSchema or throws with a user-readable message.
   * Mirrors the same field set SchemaValidator.loadSchema accepts on disk.
   */
  function validateIncomingSchema(input: unknown): NamespaceSchema {
    if (!input || typeof input !== "object") {
      throw new Error("Schema payload must be an object with a 'keys' map.");
    }
    const obj = input as { keys?: unknown };
    if (!obj.keys || typeof obj.keys !== "object") {
      throw new Error("Schema payload is missing the required 'keys' map.");
    }
    const out: Record<string, SchemaKey> = {};
    for (const [name, raw] of Object.entries(obj.keys as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") {
        throw new Error(`Key '${name}' must be an object with at least 'type' and 'required'.`);
      }
      const def = raw as Record<string, unknown>;
      if (typeof def.type !== "string" || !["string", "integer", "boolean"].includes(def.type)) {
        throw new Error(
          `Key '${name}' has invalid type '${String(def.type)}'. Must be 'string', 'integer', or 'boolean'.`,
        );
      }
      if (typeof def.required !== "boolean") {
        throw new Error(`Key '${name}' must have boolean 'required'.`);
      }
      if (def.pattern !== undefined && def.pattern !== "") {
        if (typeof def.pattern !== "string") {
          throw new Error(`Key '${name}' has non-string 'pattern'.`);
        }
        try {
          new RegExp(def.pattern);
        } catch (err) {
          throw new Error(`Key '${name}' pattern is not a valid regex: ${(err as Error).message}.`);
        }
      }
      if (def.description !== undefined && typeof def.description !== "string") {
        throw new Error(`Key '${name}' has non-string 'description'.`);
      }
      out[name] = {
        type: def.type as SchemaKey["type"],
        required: def.required,
        ...(typeof def.pattern === "string" && def.pattern !== "" ? { pattern: def.pattern } : {}),
        ...(typeof def.description === "string" && def.description !== ""
          ? { description: def.description }
          : {}),
      };
    }
    return { keys: out };
  }

  function setNoCacheHeaders(res: Response): void {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
  }

  // Resolve `relPath` against `root` and reject anything that escapes the root
  // via `..` or absolute redirection. Returns null when the candidate would
  // land outside, so callers reply with a 4xx instead of touching the FS.
  // Defense in depth: the UI binds 127.0.0.1 + bearer token, but schema paths
  // come from the manifest YAML and (for PUT) the request body, so clamp.
  function resolvePathWithinRoot(root: string, relPath: string): string | null {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relPath);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return resolved;
    }
    return null;
  }

  // Whitelist matching clef's own ENV_NAME_PATTERN (manifest/parser.ts). Used
  // on the URL `:ns` param so it cannot smuggle `..`, `/`, NUL, etc. into a
  // default schema filename like `schemas/${ns}.yaml`.
  const SAFE_NAMESPACE_PARAM = /^[a-z][a-z0-9_-]*$/;
  function isSafeNamespaceParam(ns: string): boolean {
    return SAFE_NAMESPACE_PARAM.test(ns);
  }

  // Validate a manifest- or request-supplied schema path is a safe relative
  // path string before it reaches the FS. This is the sanitizer CodeQL's
  // `js/path-injection` query recognizes — `resolvePathWithinRoot` stays as
  // belt-and-suspenders, but the explicit shape check is what clears the
  // taint flow analysis.
  function isSafeSchemaRelPath(p: string): boolean {
    if (p.length === 0 || p.includes("\0")) return false;
    if (path.isAbsolute(p)) return false;
    // Reject `..` traversal in either separator. Normalize must be a no-op —
    // any `./`, `../`, or doubled separator means the input was already not
    // in canonical form, which is suspicious for a manifest field.
    const normalized = path.posix.normalize(p.replace(/\\/g, "/"));
    if (normalized !== p.replace(/\\/g, "/")) return false;
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      return false;
    }
    return true;
  }

  // Defense-in-depth rate limit applied to every /api route.  This server
  // binds to 127.0.0.1 only and gates /api on a session bearer token, so
  // remote DoS is not the threat model — the limiter exists to bound a
  // pathological local client (a buggy script, a runaway test loop) and to
  // satisfy CodeQL's missing-rate-limit rule on file-system-touching routes.
  // Per-instance store so each `createApiRouter()` call (i.e. each test) gets
  // a fresh counter — no cross-test contamination.
  //
  // Limit sized for bursty legitimate usage: the e2e suite comfortably sits
  // near 100 req/s during dense describe blocks, and a human clicking
  // through the Matrix rapidly can produce 20-30 req/s of their own.  The
  // earlier 1000/min cap was tripping real test runs while adding no
  // meaningful security gain at 127.0.0.1 scope.
  const apiRateLimitStore = new MemoryStore();
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10_000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: apiRateLimitStore,
  });
  router.use(apiLimiter);

  // GET /api/manifest
  router.get("/manifest", (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      res.json(manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load manifest";
      res.status(500).json({ error: message, code: "MANIFEST_ERROR" });
    }
  });

  // GET /api/matrix
  router.get("/matrix", async (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const statuses = await matrix.getMatrixStatus(manifest, deps.repoRoot, sops);
      res.json(statuses);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get matrix status";
      res.status(500).json({ error: message, code: "MATRIX_ERROR" });
    }
  });

  // GET /api/namespace/:ns/:env
  // FR-31 note: Decrypted values are held in V8 heap memory during the request lifecycle.
  // JavaScript/V8 uses immutable strings — we cannot reliably zero them after use.
  // This is a known limitation of garbage-collected runtimes.
  router.get(
    "/namespace/:ns/:env",
    async (req: Request<{ ns: string; env: string }>, res: Response) => {
      setNoCacheHeaders(res);
      try {
        const manifest = loadManifest();
        const { ns, env } = req.params;

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envExists = manifest.environments.some((e) => e.name === env);

        if (!nsExists || !envExists) {
          res.status(404).json({
            error: `Namespace '${ns}' or environment '${env}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }

        const filePath = `${deps.repoRoot}/${manifest.file_pattern.replace("{namespace}", ns).replace("{environment}", env)}`;
        const decrypted = await sops.decrypt(filePath);

        // Read pending keys from metadata (plaintext sidecar)
        let pending: string[] = [];
        try {
          pending = await getPendingKeys(filePath);
        } catch {
          // Metadata unreadable — no pending info
        }

        res.json({ ...decrypted, pending });
      } catch {
        res.status(500).json({ error: "Failed to decrypt namespace", code: "DECRYPT_ERROR" });
      }
    },
  );

  // PUT /api/namespace/:ns/:env/:key
  // body: { value: string } — set a specific value
  // body: { random: true }  — generate random value server-side and mark pending
  // Note: Unlike the CLI set command, the API rolls back on metadata failure
  // to ensure callers always get a consistent state. See set.ts for the CLI
  // approach which warns and continues. This asymmetry is intentional.
  router.put(
    "/namespace/:ns/:env/:key",
    async (req: Request<{ ns: string; env: string; key: string }>, res: Response) => {
      setNoCacheHeaders(res);
      try {
        const manifest = loadManifest();
        const { ns, env, key } = req.params;
        const {
          value,
          random,
          confirmed,
          commit: commitFlag,
        } = req.body as {
          value?: string;
          random?: boolean;
          confirmed?: boolean;
          commit?: boolean;
        };
        // Auto-commit by default. The edit-multiple-rows-then-batch-commit
        // flow in NamespaceEditor.handleSave passes commit:false to defer.
        const shouldCommit = commitFlag !== false;

        if (!random && (value === undefined || value === null)) {
          res.status(400).json({
            error: "Request body must include 'value' or 'random: true'.",
            code: "BAD_REQUEST",
          });
          return;
        }

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envExists = manifest.environments.some((e) => e.name === env);

        if (!nsExists || !envExists) {
          res.status(404).json({
            error: `Namespace '${ns}' or environment '${env}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }

        if (matrix.isProtectedEnvironment(manifest, env) && !confirmed) {
          res.status(409).json({
            error: "Protected environment requires confirmation",
            code: "PROTECTED_ENV",
            protected: true,
          });
          return;
        }

        const relCellPath = manifest.file_pattern
          .replace("{namespace}", ns)
          .replace("{environment}", env);
        const filePath = `${deps.repoRoot}/${relCellPath}`;
        const decrypted = await sops.decrypt(filePath);

        // Inside the mutate callback we do the actual encrypt + metadata
        // update. When auto-commit is enabled this runs inside tx.run; when
        // disabled (batched edit flow) it runs directly.
        let response: Record<string, unknown> = { success: true, key };
        const doWork = async (): Promise<void> => {
          if (random) {
            decrypted.values[key] = generateRandomValue();
            await sops.encrypt(filePath, decrypted.values, manifest, env);
            // Metadata update failure used to trigger an in-method rollback
            // here. Inside tx.run, that rollback comes for free via git
            // reset, so we just let the throw propagate.
            await markPendingWithRetry(filePath, [key], "clef ui");
            response = { success: true, key, pending: true };
          } else {
            decrypted.values[key] = String(value);
            await sops.encrypt(filePath, decrypted.values, manifest, env);

            // Validate against schema if defined
            const nsDef = manifest.namespaces.find((n) => n.name === ns);
            if (nsDef?.schema) {
              try {
                const schema = schemaValidator.loadSchema(path.join(deps.repoRoot, nsDef.schema));
                const result = schemaValidator.validate({ [key]: String(value) }, schema);
                const violations = [...result.errors, ...result.warnings];
                if (violations.length > 0) {
                  response = {
                    success: true,
                    key,
                    warnings: violations.map((v) => v.message),
                  };
                }
              } catch {
                // Schema load failed — skip validation, not fatal
              }
            }
            // Real value set is a rotation event.  recordRotation also
            // strips any matching pending entry, so this one call replaces
            // the old markResolved + implicit pending cleanup.
            try {
              await recordRotation(filePath, [key], "clef ui");
            } catch {
              // Metadata update failed — non-fatal
            }
          }
        };

        if (shouldCommit) {
          await tx.run(deps.repoRoot, {
            description: `clef ui: set ${ns}/${env}/${key}`,
            paths: [relCellPath, relCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
            mutate: doWork,
          });
        } else {
          await doWork();
        }

        res.json(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to set value";
        res.status(500).json({ error: message, code: "SET_ERROR" });
      }
    },
  );

  // DELETE /api/namespace/:ns/:env/:key
  router.delete(
    "/namespace/:ns/:env/:key",
    async (req: Request<{ ns: string; env: string; key: string }>, res: Response) => {
      setNoCacheHeaders(res);
      try {
        const manifest = loadManifest();
        const { ns, env, key } = req.params;
        const { confirmed, commit: commitFlag } = (req.body ?? {}) as {
          confirmed?: boolean;
          commit?: boolean;
        };
        const shouldCommit = commitFlag !== false;

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envExists = manifest.environments.some((e) => e.name === env);

        if (!nsExists || !envExists) {
          res.status(404).json({
            error: `Namespace '${ns}' or environment '${env}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }

        if (matrix.isProtectedEnvironment(manifest, env) && !confirmed) {
          res.status(409).json({
            error: "Protected environment requires confirmation",
            code: "PROTECTED_ENV",
            protected: true,
          });
          return;
        }

        const relCellPath = manifest.file_pattern
          .replace("{namespace}", ns)
          .replace("{environment}", env);
        const filePath = `${deps.repoRoot}/${relCellPath}`;
        const decrypted = await sops.decrypt(filePath);

        if (!(key in decrypted.values)) {
          res.status(404).json({
            error: `Key '${key}' not found in ${ns}/${env}.`,
            code: "KEY_NOT_FOUND",
          });
          return;
        }

        const doWork = async (): Promise<void> => {
          delete decrypted.values[key];
          await sops.encrypt(filePath, decrypted.values, manifest, env);
          // Strip both pending and rotation records — the key no longer
          // exists, so stale metadata would mislead policy.
          try {
            await markResolved(filePath, [key]);
            await removeRotation(filePath, [key]);
          } catch {
            // Best effort — orphaned metadata is annoying but not dangerous
          }
        };

        if (shouldCommit) {
          await tx.run(deps.repoRoot, {
            description: `clef ui: delete ${ns}/${env}/${key}`,
            paths: [relCellPath, relCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
            mutate: doWork,
          });
        } else {
          await doWork();
        }

        res.json({ success: true, key });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete key";
        res.status(500).json({ error: message, code: "DELETE_ERROR" });
      }
    },
  );

  // POST /api/namespace/:ns/:env/:key/accept — resolve pending state without changing the value
  router.post(
    "/namespace/:ns/:env/:key/accept",
    async (req: Request<{ ns: string; env: string; key: string }>, res: Response) => {
      setNoCacheHeaders(res);
      try {
        const manifest = loadManifest();
        const { ns, env, key } = req.params;

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envExists = manifest.environments.some((e) => e.name === env);

        if (!nsExists || !envExists) {
          res.status(404).json({
            error: `Namespace '${ns}' or environment '${env}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }

        const relCellPath = manifest.file_pattern
          .replace("{namespace}", ns)
          .replace("{environment}", env);
        const filePath = `${deps.repoRoot}/${relCellPath}`;
        const decrypted = await sops.decrypt(filePath);
        const value = key in decrypted.values ? String(decrypted.values[key]) : undefined;
        await tx.run(deps.repoRoot, {
          description: `clef ui: accept ${ns}/${env}/${key}`,
          paths: [relCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
          mutate: async () => {
            // Accept is an explicit user action declaring the current
            // (placeholder) value to be the real value.  Treat as a
            // rotation — it establishes a point-in-time "this is the
            // current secret" assertion.  recordRotation also strips the
            // pending entry.
            await recordRotation(filePath, [key], "clef ui (accept)");
          },
        });
        res.json({ success: true, key, value });
      } catch {
        res.status(500).json({ error: "Failed to accept pending value", code: "ACCEPT_ERROR" });
      }
    },
  );

  // POST /api/copy
  // body: { key, fromNs, fromEnv, toNs, toEnv, confirmed? }
  router.post("/copy", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { key, fromNs, fromEnv, toNs, toEnv, confirmed } = req.body as {
        key: string;
        fromNs: string;
        fromEnv: string;
        toNs: string;
        toEnv: string;
        confirmed?: boolean;
      };

      if (!key || !fromNs || !fromEnv || !toNs || !toEnv) {
        res.status(400).json({
          error: "Request body must include 'key', 'fromNs', 'fromEnv', 'toNs', 'toEnv'.",
          code: "BAD_REQUEST",
        });
        return;
      }

      if (matrix.isProtectedEnvironment(manifest, toEnv) && !confirmed) {
        res.status(409).json({
          error: "Protected environment requires confirmation",
          code: "PROTECTED_ENV",
          protected: true,
        });
        return;
      }

      const cells = matrix.resolveMatrix(manifest, deps.repoRoot);
      const fromCell = cells.find((c) => c.namespace === fromNs && c.environment === fromEnv);
      const toCell = cells.find((c) => c.namespace === toNs && c.environment === toEnv);

      if (!fromCell || !toCell) {
        res.status(404).json({
          error: "Source or destination cell not found in matrix.",
          code: "NOT_FOUND",
        });
        return;
      }

      const source = await sops.decrypt(fromCell.filePath);
      if (!(key in source.values)) {
        res.status(404).json({
          error: `Key '${key}' not found in ${fromNs}/${fromEnv}.`,
          code: "KEY_NOT_FOUND",
        });
        return;
      }

      const relToPath = path.relative(deps.repoRoot, toCell.filePath);
      await tx.run(deps.repoRoot, {
        description: `clef ui: copy ${key} from ${fromNs}/${fromEnv} to ${toNs}/${toEnv}`,
        paths: [relToPath, relToPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
        mutate: async () => {
          const dest = await sops.decrypt(toCell.filePath);
          const valueChanged = dest.values[key] !== source.values[key];
          dest.values[key] = source.values[key];
          await sops.encrypt(toCell.filePath, dest.values, manifest, toCell.environment);
          // Only a real value change is a rotation.  Copying an identical
          // value re-encrypts the ciphertext but does not rotate — matches
          // the import semantics agreed in the design.
          try {
            if (valueChanged) {
              await recordRotation(toCell.filePath, [key], "clef ui (copy)");
            } else {
              await markResolved(toCell.filePath, [key]);
            }
          } catch {
            // Non-fatal — destination may not have had pending state
          }
        },
      });
      res.json({ success: true, key, from: `${fromNs}/${fromEnv}`, to: `${toNs}/${toEnv}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to copy value";
      res.status(500).json({ error: message, code: "COPY_ERROR" });
    }
  });

  // GET /api/diff/:ns/:envA/:envB
  router.get(
    "/diff/:ns/:envA/:envB",
    async (req: Request<{ ns: string; envA: string; envB: string }>, res: Response) => {
      setNoCacheHeaders(res);
      try {
        const manifest = loadManifest();
        const { ns, envA, envB } = req.params;

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envAExists = manifest.environments.some((e) => e.name === envA);
        const envBExists = manifest.environments.some((e) => e.name === envB);

        if (!nsExists || !envAExists || !envBExists) {
          res.status(404).json({
            error: `Namespace '${ns}', environment '${envA}', or environment '${envB}' not found.`,
            code: "NOT_FOUND",
          });
          return;
        }

        // Compose a per-request SecretSource. The manifest is parsed
        // per-request (it can change while the server runs), so the
        // source is built here rather than at router construction.
        const storage = new FilesystemStorageBackend(manifest, deps.repoRoot);
        const encryption = createSopsEncryptionBackend(sops);
        const source = composeSecretSource(storage, encryption, manifest);
        const result = await diffEngine.diffCells(ns, envA, envB, source);

        // Mask values by default — only reveal when client explicitly requests it
        if (req.query.showValues !== "true") {
          for (const row of result.rows) {
            if (row.valueA !== null)
              row.valueA = "\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF";
            if (row.valueB !== null)
              row.valueB = "\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF";
          }
        }

        res.json(result);
      } catch {
        res.status(500).json({ error: "Failed to compute diff", code: "DIFF_ERROR" });
      }
    },
  );

  // GET /api/lint/:namespace
  router.get("/lint/:namespace", async (req: Request<{ namespace: string }>, res: Response) => {
    try {
      const manifest = loadManifest();
      const { namespace } = req.params;

      const nsExists = manifest.namespaces.some((n) => n.name === namespace);
      if (!nsExists) {
        res.status(404).json({
          error: `Namespace '${namespace}' not found in manifest.`,
          code: "NOT_FOUND",
        });
        return;
      }

      const lintSource = composeSecretSource(
        new FilesystemStorageBackend(manifest, deps.repoRoot),
        createSopsEncryptionBackend(sops),
        manifest,
      );
      const lintRunner = new LintRunner(matrix, schemaValidator, lintSource);
      const result = await lintRunner.run(manifest, deps.repoRoot);
      const filtered = result.issues.filter((issue) => {
        const issueNs = issue.file.split("/")[0];
        return issueNs === namespace;
      });
      res.json({ issues: filtered, fileCount: result.fileCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run lint";
      res.status(500).json({ error: message, code: "LINT_ERROR" });
    }
  });

  // GET /api/namespaces/:ns/schema — fetch the schema attached to a namespace.
  // Returns { attached, path, schema } where:
  //   attached = false → namespace exists but no schema is wired up; schema is
  //                      a blank { keys: {} } so the editor can start from
  //                      something writable.
  //   attached = true  → schema was loaded from disk at `path`.
  router.get("/namespaces/:ns/schema", (req: Request<{ ns: string }>, res: Response) => {
    setNoCacheHeaders(res);
    try {
      const manifest = loadManifest();
      const { ns } = req.params;
      if (!isSafeNamespaceParam(ns)) {
        res.status(400).json({ error: "Invalid namespace.", code: "INVALID_NAMESPACE" });
        return;
      }
      const nsDef = manifest.namespaces.find((n) => n.name === ns);
      if (!nsDef) {
        res.status(404).json({ error: `Namespace '${ns}' not found.`, code: "NOT_FOUND" });
        return;
      }
      if (!nsDef.schema) {
        res.json({ namespace: ns, attached: false, path: null, schema: { keys: {} } });
        return;
      }
      if (!isSafeSchemaRelPath(nsDef.schema)) {
        res.status(400).json({
          error: `Schema path '${nsDef.schema}' attached to '${ns}' is not a safe relative path.`,
          code: "SCHEMA_PATH_INVALID",
        });
        return;
      }
      const absPath = resolvePathWithinRoot(deps.repoRoot, nsDef.schema);
      if (!absPath) {
        res.status(400).json({
          error: `Schema path '${nsDef.schema}' attached to '${ns}' resolves outside the repository root.`,
          code: "SCHEMA_PATH_INVALID",
        });
        return;
      }
      if (!fs.existsSync(absPath)) {
        res.status(500).json({
          error: `Schema file '${nsDef.schema}' is attached to '${ns}' but does not exist on disk.`,
          code: "SCHEMA_MISSING",
        });
        return;
      }
      const schema = schemaValidator.loadSchema(absPath);
      res.json({ namespace: ns, attached: true, path: nsDef.schema, schema });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read schema";
      res.status(500).json({ error: message, code: "SCHEMA_READ_ERROR" });
    }
  });

  // PUT /api/namespaces/:ns/schema — write the schema for a namespace.
  // Body: { schema: NamespaceSchema, path?: string }. If the namespace has no
  // attached schema yet, this endpoint creates the file at `path` (defaulting
  // to schemas/<ns>.yaml) and attaches it via StructureManager — the same
  // round-trip the CLI uses, so manifest formatting stays consistent.
  router.put("/namespaces/:ns/schema", async (req: Request<{ ns: string }>, res: Response) => {
    setNoCacheHeaders(res);
    try {
      const manifest = loadManifest();
      const { ns } = req.params;
      if (!isSafeNamespaceParam(ns)) {
        res.status(400).json({ error: "Invalid namespace.", code: "INVALID_NAMESPACE" });
        return;
      }
      const body = req.body as { schema?: unknown; path?: unknown };

      const nsDef = manifest.namespaces.find((n) => n.name === ns);
      if (!nsDef) {
        res.status(404).json({ error: `Namespace '${ns}' not found.`, code: "NOT_FOUND" });
        return;
      }

      let validated: NamespaceSchema;
      try {
        validated = validateIncomingSchema(body.schema);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Invalid schema payload.",
          code: "INVALID_SCHEMA",
        });
        return;
      }

      const requestedRelPath =
        typeof body.path === "string" && body.path.length > 0 ? body.path : null;
      if (requestedRelPath !== null && !isSafeSchemaRelPath(requestedRelPath)) {
        res.status(400).json({
          error: "Schema path must be a safe relative path.",
          code: "SCHEMA_PATH_INVALID",
        });
        return;
      }
      const relPath = nsDef.schema ?? requestedRelPath ?? `schemas/${ns}.yaml`;
      if (!isSafeSchemaRelPath(relPath)) {
        res.status(400).json({
          error: "Schema path must be a safe relative path.",
          code: "SCHEMA_PATH_INVALID",
        });
        return;
      }
      const absPath = resolvePathWithinRoot(deps.repoRoot, relPath);
      if (!absPath) {
        res.status(400).json({
          error: "Schema path must resolve within the repository root.",
          code: "SCHEMA_PATH_INVALID",
        });
        return;
      }

      writeSchema(deps.repoRoot, relPath, validated);

      if (!nsDef.schema) {
        await structureManager.editNamespace(ns, { schema: relPath }, manifest, deps.repoRoot);
      }

      res.json({ namespace: ns, attached: true, path: relPath, schema: validated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to write schema";
      res.status(500).json({ error: message, code: "SCHEMA_WRITE_ERROR" });
    }
  });

  // GET /api/lint
  router.get("/lint", async (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const lintSource = composeSecretSource(
        new FilesystemStorageBackend(manifest, deps.repoRoot),
        createSopsEncryptionBackend(sops),
        manifest,
      );
      const lintRunner = new LintRunner(matrix, schemaValidator, lintSource);
      const result = await lintRunner.run(manifest, deps.repoRoot);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run lint";
      res.status(500).json({ error: message, code: "LINT_ERROR" });
    }
  });

  // POST /api/lint/fix
  router.post("/lint/fix", async (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const lintSource = composeSecretSource(
        new FilesystemStorageBackend(manifest, deps.repoRoot),
        createSopsEncryptionBackend(sops),
        manifest,
      );
      const lintRunner = new LintRunner(matrix, schemaValidator, lintSource);
      const result = await lintRunner.fix(manifest, deps.repoRoot);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run lint fix";
      res.status(500).json({ error: message, code: "LINT_FIX_ERROR" });
    }
  });

  function policyFilePath(): string {
    return path.join(deps.repoRoot, CLEF_POLICY_FILENAME);
  }

  // GET /api/policy — resolved rotation policy + source.  Returns the built-in
  // default when .clef/policy.yaml is absent (PolicyParser.load handles this
  // — no throw on missing file).
  router.get("/policy", (_req: Request, res: Response) => {
    try {
      const policyPath = policyFilePath();
      const source = fs.existsSync(policyPath) ? "file" : "default";
      const policy = new PolicyParser().load(policyPath);
      res.json({
        policy,
        source,
        path: CLEF_POLICY_FILENAME,
        rawYaml: YAML.stringify(policy),
      });
    } catch (err) {
      if (err instanceof PolicyValidationError) {
        res.status(422).json({ error: err.message, code: "POLICY_INVALID" });
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to load policy";
      res.status(500).json({ error: message, code: "POLICY_LOAD_ERROR" });
    }
  });

  // GET /api/policy/check — rotation status per matrix file, the same data
  // `clef policy check --json` produces.  Mirrors the CLI's include flags so
  // scan + lint are not re-run from this endpoint.
  router.get("/policy/check", async (_req: Request, res: Response) => {
    try {
      const result = await runCompliance({
        runner: deps.runner,
        repoRoot: deps.repoRoot,
        sopsPath: deps.sopsPath,
        ageKey: deps.ageKey,
        ageKeyFile: deps.ageKeyFile,
        include: { rotation: true, scan: false, lint: false },
      });
      const unknownMetadata = result.document.files.filter((f) => !f.last_modified_known).length;
      res.json({
        files: result.document.files,
        summary: {
          total_files: result.document.summary.total_files,
          compliant: result.document.summary.compliant,
          rotation_overdue: result.document.summary.rotation_overdue,
          unknown_metadata: unknownMetadata,
        },
        policy: result.document.policy_snapshot,
        source: fs.existsSync(policyFilePath()) ? "file" : "default",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to evaluate policy";
      res.status(500).json({ error: message, code: "POLICY_CHECK_ERROR" });
    }
  });

  // POST /api/git/commit
  router.post("/git/commit", async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message: string };

      if (!message || typeof message !== "string") {
        res.status(400).json({
          error: "Request body must include a 'message' string.",
          code: "BAD_REQUEST",
        });
        return;
      }

      // Stage all modified encrypted files and metadata files
      const status = await git.getStatus(deps.repoRoot);
      const clefFiles = [...status.staged, ...status.unstaged, ...status.untracked].filter(
        (f) => f.endsWith(".enc.yaml") || f.endsWith(".enc.json") || f.endsWith(".clef-meta.yaml"),
      );

      if (clefFiles.length === 0) {
        res.status(400).json({
          error: "No changes to commit",
          code: "NOTHING_TO_COMMIT",
        });
        return;
      }

      await git.stageFiles(clefFiles, deps.repoRoot);
      const hash = await git.commit(message, deps.repoRoot);
      res.json({ hash });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to commit";
      res.status(500).json({ error: message, code: "GIT_ERROR" });
    }
  });

  // GET /api/git/status
  router.get("/git/status", async (_req: Request, res: Response) => {
    try {
      const status = await git.getStatus(deps.repoRoot);
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get git status";
      res.status(500).json({ error: message, code: "GIT_ERROR" });
    }
  });

  // GET /api/git/diff
  router.get("/git/diff", async (_req: Request, res: Response) => {
    setNoCacheHeaders(res);
    try {
      const diff = await git.getDiff(deps.repoRoot);
      res.json({ diff });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not get diff";
      res.status(500).json({ error: message, code: "GIT_DIFF_ERROR" });
    }
  });

  // GET /api/git/log/:ns/:env
  router.get(
    "/git/log/:ns/:env",
    async (req: Request<{ ns: string; env: string }>, res: Response) => {
      try {
        const manifest = loadManifest();
        const { ns, env } = req.params;

        const nsExists = manifest.namespaces.some((n) => n.name === ns);
        const envExists = manifest.environments.some((e) => e.name === env);

        if (!nsExists || !envExists) {
          res.status(404).json({
            error: `Namespace '${ns}' or environment '${env}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }

        const filePath = manifest.file_pattern
          .replace("{namespace}", ns)
          .replace("{environment}", env);
        const log = await git.getLog(filePath, deps.repoRoot);
        res.json({ log });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not get log";
        res.status(500).json({ error: message, code: "GIT_LOG_ERROR" });
      }
    },
  );

  // POST /api/scan
  router.post("/scan", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { severity, paths } = req.body as { severity?: string; paths?: string[] };
      const result = await scanRunner.scan(deps.repoRoot, manifest, {
        severity: severity === "high" ? "high" : "all",
        paths: paths && paths.length > 0 ? paths : undefined,
      });
      lastScanResult = result;
      lastScanAt = new Date().toISOString();
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      res.status(500).json({ error: message, code: "SCAN_ERROR" });
    }
  });

  // GET /api/scan/status — last scan result for this session
  router.get("/scan/status", (_req: Request, res: Response) => {
    res.json({ lastRun: lastScanResult, lastRunAt: lastScanAt });
  });

  // POST /api/editor/open — open a file in the OS default editor
  router.post("/editor/open", async (req: Request, res: Response) => {
    try {
      const { file } = req.body as { file?: string };
      if (!file || typeof file !== "string") {
        res
          .status(400)
          .json({ error: "Request body must include a 'file' string.", code: "BAD_REQUEST" });
        return;
      }
      const resolved = path.resolve(deps.repoRoot, file);
      if (!resolved.startsWith(deps.repoRoot + path.sep) && resolved !== deps.repoRoot) {
        res.status(400).json({
          error: "File path must be within the repository.",
          code: "BAD_REQUEST",
        });
        return;
      }

      const editor = process.env.EDITOR || (process.env.TERM_PROGRAM === "vscode" ? "code" : "");
      if (!editor) {
        res.status(500).json({
          error: "No editor configured. Set the EDITOR environment variable.",
          code: "NO_EDITOR",
        });
        return;
      }
      await deps.runner.run(editor, [file], { cwd: deps.repoRoot });
      res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open editor";
      res.status(500).json({ error: message, code: "EDITOR_ERROR" });
    }
  });

  // POST /api/import/preview — dry run import
  router.post("/import/preview", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { target, content, format, overwriteKeys } = req.body as {
        target: string;
        content: string;
        format?: ImportFormat;
        overwriteKeys?: string[];
      };

      if (!target || typeof content !== "string") {
        res.status(400).json({
          error: "Request body must include 'target' and 'content'.",
          code: "BAD_REQUEST",
        });
        return;
      }

      const parts = target.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        res.status(400).json({
          error: "Invalid target format. Use 'namespace/environment'.",
          code: "BAD_REQUEST",
        });
        return;
      }

      const importSource = composeSecretSource(
        new FilesystemStorageBackend(manifest, deps.repoRoot),
        createSopsEncryptionBackend(sops),
        manifest,
      );
      const importRunner = new ImportRunner(importSource, tx);
      const result = await importRunner.import(target, null, content, manifest, deps.repoRoot, {
        format,
        dryRun: true,
      });

      // Classify keys using overwriteKeys from the request
      const overwriteSet = new Set(overwriteKeys ?? []);
      const wouldImport = result.imported.filter((k: string) => !overwriteSet.has(k));
      const wouldOverwrite = result.imported.filter((k: string) => overwriteSet.has(k));
      const wouldSkip = result.skipped.map((k: string) => ({ key: k, reason: "already exists" }));

      res.json({
        wouldImport,
        wouldSkip,
        wouldOverwrite,
        warnings: result.warnings,
        totalKeys: result.imported.length + result.skipped.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preview failed";
      res.status(500).json({ error: message, code: "IMPORT_PREVIEW_ERROR" });
    }
  });

  // POST /api/import/apply — run actual import
  router.post("/import/apply", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { target, content, format, keys, overwriteKeys } = req.body as {
        target: string;
        content: string;
        format?: ImportFormat;
        keys: string[];
        overwriteKeys?: string[];
      };

      if (!target || typeof content !== "string") {
        res.status(400).json({
          error: "Request body must include 'target' and 'content'.",
          code: "BAD_REQUEST",
        });
        return;
      }

      if (!Array.isArray(keys)) {
        res
          .status(400)
          .json({ error: "Request body must include 'keys' array.", code: "BAD_REQUEST" });
        return;
      }

      const parts = target.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        res.status(400).json({
          error: "Invalid target format. Use 'namespace/environment'.",
          code: "BAD_REQUEST",
        });
        return;
      }

      if (keys.length === 0) {
        res.json({ imported: [], skipped: [], failed: [] });
        return;
      }

      const importSource = composeSecretSource(
        new FilesystemStorageBackend(manifest, deps.repoRoot),
        createSopsEncryptionBackend(sops),
        manifest,
      );
      const importRunner = new ImportRunner(importSource, tx);
      const result = await importRunner.import(target, null, content, manifest, deps.repoRoot, {
        format,
        keys,
        overwrite: (overwriteKeys ?? []).length > 0,
      });

      res.json({
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message, code: "IMPORT_APPLY_ERROR" });
    }
  });

  // GET /api/recipients
  router.get("/recipients", async (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const recipientManager = new RecipientManager(buildSourceFor(manifest), matrix, tx);
      const recipients = await recipientManager.list(manifest, deps.repoRoot);
      const cells = matrix.resolveMatrix(manifest, deps.repoRoot);
      const totalFiles = cells.filter((c) => c.exists).length;
      res.json({ recipients, totalFiles });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list recipients";
      res.status(500).json({ error: message, code: "RECIPIENTS_ERROR" });
    }
  });

  // GET /api/recipients/validate?key=age1...
  router.get("/recipients/validate", (req: Request, res: Response) => {
    const key = req.query.key as string;
    if (!key) {
      res.status(400).json({ valid: false, error: "Missing 'key' query parameter." });
      return;
    }
    const result = validateAgePublicKey(key);
    res.json(result);
  });

  // POST /api/recipients/add
  router.post("/recipients/add", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { key, label } = req.body as { key: string; label?: string };
      const recipientManager = new RecipientManager(buildSourceFor(manifest), matrix, tx);
      const result = await recipientManager.add(key, label, manifest, deps.repoRoot);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add recipient";
      res.status(500).json({ error: message, code: "RECIPIENTS_ADD_ERROR" });
    }
  });

  // POST /api/recipients/remove
  router.post("/recipients/remove", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { key } = req.body as { key: string };
      const recipientManager = new RecipientManager(buildSourceFor(manifest), matrix, tx);
      const result = await recipientManager.remove(key, manifest, deps.repoRoot);
      const cells = matrix.resolveMatrix(manifest, deps.repoRoot);
      const targets = cells.filter((c) => c.exists).map((c) => `${c.namespace}/${c.environment}`);
      res.json({ ...result, rotationReminder: targets });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove recipient";
      res.status(500).json({ error: message, code: "RECIPIENTS_REMOVE_ERROR" });
    }
  });

  // GET /api/service-identities
  router.get("/service-identities", (_req: Request, res: Response) => {
    try {
      setNoCacheHeaders(res);
      const manifest = loadManifest();
      const identities = manifest.service_identities ?? [];

      const result = identities.map((si) => {
        const environments: Record<
          string,
          { type: string; publicKey?: string; kms?: unknown; protected?: boolean }
        > = {};
        for (const [envName, envConfig] of Object.entries(si.environments)) {
          const env = manifest.environments.find((e) => e.name === envName);
          if (envConfig.kms) {
            environments[envName] = {
              type: "kms",
              kms: envConfig.kms,
              protected: env?.protected ?? false,
            };
          } else {
            environments[envName] = {
              type: "age",
              publicKey: envConfig.recipient,
              protected: env?.protected ?? false,
            };
          }
        }
        return {
          name: si.name,
          description: si.description,
          namespaces: si.namespaces,
          environments,
          packOnly: si.pack_only ?? false,
        };
      });

      res.json({ identities: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load service identities";
      res.status(500).json({ error: message, code: "SERVICE_IDENTITY_ERROR" });
    }
  });

  // POST /api/service-identities — create a new service identity
  router.post("/service-identities", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { name, description, namespaces, kmsEnvConfigs, sharedRecipient, packOnly } =
        req.body as {
          name: string;
          description?: string;
          namespaces: string[];
          kmsEnvConfigs?: Record<string, { provider: string; keyId: string }>;
          sharedRecipient?: boolean;
          packOnly?: boolean;
        };

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required.", code: "BAD_REQUEST" });
        return;
      }
      if (!Array.isArray(namespaces) || namespaces.length === 0) {
        res
          .status(400)
          .json({ error: "namespaces must be a non-empty array.", code: "BAD_REQUEST" });
        return;
      }

      // Validate and cast KMS configs — provider must be one of the allowed values
      let typedKmsConfigs: Record<string, KmsConfig> | undefined;
      if (kmsEnvConfigs && Object.keys(kmsEnvConfigs).length > 0) {
        typedKmsConfigs = {};
        for (const [envName, cfg] of Object.entries(kmsEnvConfigs)) {
          if (!VALID_KMS_PROVIDERS.includes(cfg.provider as (typeof VALID_KMS_PROVIDERS)[number])) {
            res.status(400).json({
              error: `Invalid KMS provider '${cfg.provider}' for environment '${envName}'. Must be aws, gcp, or azure.`,
              code: "BAD_REQUEST",
            });
            return;
          }
          typedKmsConfigs[envName] = {
            provider: cfg.provider as (typeof VALID_KMS_PROVIDERS)[number],
            keyId: cfg.keyId,
          };
        }
      }

      const serviceIdManager = new ServiceIdentityManager(buildSourceFor(manifest), matrix, tx);
      const result = await serviceIdManager.create(
        name,
        namespaces,
        description ?? "",
        manifest,
        deps.repoRoot,
        {
          kmsEnvConfigs: typedKmsConfigs,
          sharedRecipient: sharedRecipient === true,
          packOnly: packOnly === true,
        },
      );

      setNoCacheHeaders(res);
      res.json({
        identity: result.identity,
        privateKeys: result.privateKeys,
        sharedRecipient: result.sharedRecipient,
        packOnly: result.identity.pack_only ?? false,
      });

      // Best-effort: clear references to private key strings (V8 may retain copies)
      zeroStringRecord(result.privateKeys);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create service identity";
      res.status(500).json({ error: message, code: "SERVICE_IDENTITY_ERROR" });
    }
  });

  // DELETE /api/service-identities/:name
  router.delete("/service-identities/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const manifest = loadManifest();
      if (!manifest.service_identities?.find((si) => si.name === name)) {
        res.status(404).json({ error: `Service identity '${name}' not found.`, code: "NOT_FOUND" });
        return;
      }
      const serviceIdManager = new ServiceIdentityManager(buildSourceFor(manifest), matrix, tx);
      await serviceIdManager.delete(name, manifest, deps.repoRoot);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete service identity";
      res.status(500).json({ error: message, code: "SERVICE_IDENTITY_ERROR" });
    }
  });

  // PATCH /api/service-identities/:name — update environment backends to KMS
  router.patch("/service-identities/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { kmsEnvConfigs } = req.body as {
        kmsEnvConfigs?: Record<string, { provider: string; keyId: string }>;
      };
      if (!kmsEnvConfigs || Object.keys(kmsEnvConfigs).length === 0) {
        res
          .status(400)
          .json({ error: "kmsEnvConfigs must be a non-empty object.", code: "BAD_REQUEST" });
        return;
      }
      const manifest = loadManifest();
      const typedKmsConfigs: Record<string, KmsConfig> = {};
      for (const [envName, cfg] of Object.entries(kmsEnvConfigs)) {
        if (cfg.provider !== "aws" && cfg.provider !== "gcp" && cfg.provider !== "azure") {
          res.status(400).json({
            error: `Invalid KMS provider '${cfg.provider}' for environment '${envName}'. Must be aws, gcp, or azure.`,
            code: "BAD_REQUEST",
          });
          return;
        }
        typedKmsConfigs[envName] = { provider: cfg.provider, keyId: cfg.keyId };
      }
      const serviceIdManager = new ServiceIdentityManager(buildSourceFor(manifest), matrix, tx);
      await serviceIdManager.updateEnvironments(name, typedKmsConfigs, manifest, deps.repoRoot);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update service identity";
      res.status(500).json({ error: message, code: "SERVICE_IDENTITY_ERROR" });
    }
  });

  // POST /api/service-identities/:name/rotate — rotate age key(s)
  router.post("/service-identities/:name/rotate", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { environment } = req.body as { environment?: string };
      const manifest = loadManifest();
      const serviceIdManager = new ServiceIdentityManager(buildSourceFor(manifest), matrix, tx);
      const privateKeys = await serviceIdManager.rotateKey(
        name,
        manifest,
        deps.repoRoot,
        environment,
      );
      setNoCacheHeaders(res);
      res.json({ privateKeys });

      // Best-effort: clear references to private key strings (V8 may retain copies)
      zeroStringRecord(privateKeys);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rotate service identity key";
      res.status(500).json({ error: message, code: "SERVICE_IDENTITY_ERROR" });
    }
  });

  // ── Manifest Structure (namespaces + environments) ─────────────────
  //
  // Each endpoint maps to a StructureManager method. Errors from the manager
  // are mapped to HTTP status codes:
  //   400 — invalid input (missing/wrong-type body field, invalid identifier)
  //   404 — name not found in the manifest
  //   409 — name collision (entity already exists, or rename target taken)
  //   412 — refusal precondition (protected env, last namespace/env, orphaned SI)
  //   500 — anything else (filesystem, sops, transaction failure)

  /**
   * Map a thrown error from StructureManager to an HTTP status. The manager
   * throws plain `Error` instances with descriptive messages — we sniff the
   * message text to pick the right status. Brittle but contained: every
   * sniff matches a string the manager itself produces.
   */
  function structureErrorStatus(err: unknown): { status: number; code: string } {
    const message = err instanceof Error ? err.message : "";
    if (/not found/.test(message)) return { status: 404, code: "NOT_FOUND" };
    if (/already exists/.test(message)) return { status: 409, code: "CONFLICT" };
    if (/Invalid (namespace|environment) name/.test(message))
      return { status: 400, code: "BAD_REQUEST" };
    if (/is protected|last (namespace|environment)|only scope/.test(message))
      return { status: 412, code: "PRECONDITION_FAILED" };
    return { status: 500, code: "STRUCTURE_ERROR" };
  }

  // POST /api/namespaces — add a new namespace and scaffold cells
  router.post("/namespaces", async (req: Request, res: Response) => {
    try {
      const { name, description, schema } = req.body as {
        name?: string;
        description?: string;
        schema?: string;
      };
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required.", code: "BAD_REQUEST" });
        return;
      }
      const manifest = loadManifest();
      await structureManager.addNamespace(name, { description, schema }, manifest, deps.repoRoot);
      res.status(201).json({ name, description: description ?? "", schema });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to add namespace";
      res.status(status).json({ error: message, code });
    }
  });

  // PATCH /api/namespaces/:name — edit description, schema, or rename
  router.patch("/namespaces/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { rename, description, schema } = req.body as {
        rename?: string;
        description?: string;
        schema?: string;
      };
      if (rename === undefined && description === undefined && schema === undefined) {
        res.status(400).json({
          error: "At least one of rename, description, or schema is required.",
          code: "BAD_REQUEST",
        });
        return;
      }
      const manifest = loadManifest();
      await structureManager.editNamespace(
        name,
        { rename, description, schema },
        manifest,
        deps.repoRoot,
      );
      res.json({ name: rename ?? name, previousName: rename ? name : undefined });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to edit namespace";
      res.status(status).json({ error: message, code });
    }
  });

  // DELETE /api/namespaces/:name — remove namespace and cascade through SIs
  router.delete("/namespaces/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const manifest = loadManifest();
      await structureManager.removeNamespace(name, manifest, deps.repoRoot);
      res.json({ ok: true });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to remove namespace";
      res.status(status).json({ error: message, code });
    }
  });

  // POST /api/environments — add a new environment and scaffold cells
  router.post("/environments", async (req: Request, res: Response) => {
    try {
      const {
        name,
        description,
        protected: isProtected,
      } = req.body as {
        name?: string;
        description?: string;
        protected?: boolean;
      };
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required.", code: "BAD_REQUEST" });
        return;
      }
      const manifest = loadManifest();
      await structureManager.addEnvironment(
        name,
        { description, protected: isProtected },
        manifest,
        deps.repoRoot,
      );
      res
        .status(201)
        .json({ name, description: description ?? "", protected: isProtected ?? false });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to add environment";
      res.status(status).json({ error: message, code });
    }
  });

  // PATCH /api/environments/:name — edit description, protected, or rename
  router.patch("/environments/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const {
        rename,
        description,
        protected: isProtected,
      } = req.body as {
        rename?: string;
        description?: string;
        protected?: boolean;
      };
      if (rename === undefined && description === undefined && isProtected === undefined) {
        res.status(400).json({
          error: "At least one of rename, description, or protected is required.",
          code: "BAD_REQUEST",
        });
        return;
      }
      const manifest = loadManifest();
      await structureManager.editEnvironment(
        name,
        { rename, description, protected: isProtected },
        manifest,
        deps.repoRoot,
      );
      res.json({ name: rename ?? name, previousName: rename ? name : undefined });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to edit environment";
      res.status(status).json({ error: message, code });
    }
  });

  // DELETE /api/environments/:name — remove env and cascade through SIs
  router.delete("/environments/:name", async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const manifest = loadManifest();
      await structureManager.removeEnvironment(name, manifest, deps.repoRoot);
      res.json({ ok: true });
    } catch (err) {
      const { status, code } = structureErrorStatus(err);
      const message = err instanceof Error ? err.message : "Failed to remove environment";
      res.status(status).json({ error: message, code });
    }
  });

  // ── Backend Migration ──────────────────────────────────────────────

  router.get("/backend-config", (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const global = manifest.sops;
      const environments = manifest.environments.map((env) => ({
        name: env.name,
        protected: env.protected === true,
        effective: resolveBackendConfig(manifest, env.name),
        hasOverride: env.sops !== undefined,
      }));
      res.json({ global, environments });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load backend config";
      res.status(500).json({ error: message, code: "BACKEND_CONFIG_ERROR" });
    }
  });

  router.post("/migrate-backend/preview", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { target, environment, confirmed } = req.body;

      if (!target || !target.backend) {
        res.status(400).json({ error: "Missing target backend", code: "BAD_REQUEST" });
        return;
      }

      // Protected environment check
      const impactedEnvs = environment
        ? manifest.environments.filter((e) => e.name === environment)
        : manifest.environments;
      const protectedEnvs = impactedEnvs.filter((e) => e.protected);
      if (protectedEnvs.length > 0 && !confirmed) {
        res.status(409).json({
          error: "Protected environment requires confirmation",
          code: "PROTECTED_ENV",
          protected: true,
        });
        return;
      }

      const events: MigrationProgressEvent[] = [];
      const backendMigrator = new BackendMigrator(buildSourceFor, matrix, tx);
      const result = await backendMigrator.migrate(
        manifest,
        deps.repoRoot,
        { target, environment, dryRun: true },
        (event) => events.push(event),
      );

      res.json({ success: !result.rolledBack, result, events });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Migration preview failed";
      res.status(500).json({ error: message, code: "MIGRATION_ERROR" });
    }
  });

  router.post("/migrate-backend/apply", async (req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
      const { target, environment, confirmed } = req.body;

      if (!target || !target.backend) {
        res.status(400).json({ error: "Missing target backend", code: "BAD_REQUEST" });
        return;
      }

      // Protected environment check
      const impactedEnvs = environment
        ? manifest.environments.filter((e) => e.name === environment)
        : manifest.environments;
      const protectedEnvs = impactedEnvs.filter((e) => e.protected);
      if (protectedEnvs.length > 0 && !confirmed) {
        res.status(409).json({
          error: "Protected environment requires confirmation",
          code: "PROTECTED_ENV",
          protected: true,
        });
        return;
      }

      const events: MigrationProgressEvent[] = [];
      const backendMigrator = new BackendMigrator(buildSourceFor, matrix, tx);
      const result = await backendMigrator.migrate(
        manifest,
        deps.repoRoot,
        { target, environment, dryRun: false },
        (event) => events.push(event),
      );

      res.json({ success: !result.rolledBack, result, events });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Migration failed";
      res.status(500).json({ error: message, code: "MIGRATION_ERROR" });
    }
  });

  // ── Destructive Reset ───────────────────────────────────────────────
  //
  // Disaster-recovery endpoint. Abandons the current encrypted contents of
  // a scope (env / namespace / cell) and re-scaffolds fresh placeholders,
  // optionally switching to a new SOPS backend in the same transaction.
  // The UI gates this with a typed-confirmation modal — there is no
  // server-side `confirmed` field because every other destructive endpoint
  // (DELETE namespaces, DELETE environments) follows the same pattern of
  // letting the UI carry the confirmation responsibility.

  router.post("/reset", async (req: Request, res: Response) => {
    try {
      const { scope, backend, key, keys } = req.body as {
        scope?: ResetScope;
        backend?: BackendType;
        key?: string;
        keys?: string[];
      };

      if (!scope || typeof scope !== "object" || !("kind" in scope)) {
        res.status(400).json({
          error: "Reset requires a scope. Provide { kind: 'env'|'namespace'|'cell', ... }.",
          code: "BAD_REQUEST",
        });
        return;
      }

      const manifest = loadManifest();

      // Surface a clean 4xx for unknown scope before any destructive work.
      // ResetManager re-validates internally as defence in depth.
      try {
        validateResetScope(scope, manifest);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid reset scope";
        res.status(404).json({ error: message, code: "NOT_FOUND" });
        return;
      }

      const resetManager = new ResetManager(matrix, buildSourceFor, schemaValidator, tx);
      const result = await resetManager.reset(
        { scope, backend, key, keys },
        manifest,
        deps.repoRoot,
      );
      res.json({ success: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reset failed";
      // Validation-style errors that ResetManager throws after the scope
      // check passes — bad backend/key combination, scope matches zero
      // cells. Map these to 400 so the UI can render them as user errors
      // rather than server errors.
      const isUserError = /requires a key|does not take a key|matches zero cells/.test(message);
      const status = isUserError ? 400 : 500;
      const code = isUserError ? "BAD_REQUEST" : "RESET_ERROR";
      res.status(status).json({ error: message, code });
    }
  });

  // ── Sync ─────────────────────────────────────────────────────────────

  // POST /api/sync/preview — dry-run: compute what sync would do
  router.post("/sync/preview", async (req: Request, res: Response) => {
    try {
      const { namespace } = req.body as { namespace?: string };
      const manifest = loadManifest();

      if (namespace) {
        const nsExists = manifest.namespaces.some((n) => n.name === namespace);
        if (!nsExists) {
          res.status(404).json({
            error: `Namespace '${namespace}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }
      }

      const syncManager = new SyncManager(matrix, buildSourceFor(manifest), tx);
      const plan = await syncManager.plan(manifest, deps.repoRoot, { namespace });
      res.json(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync preview failed";
      res.status(500).json({ error: message, code: "SYNC_ERROR" });
    }
  });

  // POST /api/sync — execute sync: scaffold missing keys with random pending values
  router.post("/sync", async (req: Request, res: Response) => {
    try {
      const { namespace } = req.body as { namespace?: string };
      const manifest = loadManifest();

      if (namespace) {
        const nsExists = manifest.namespaces.some((n) => n.name === namespace);
        if (!nsExists) {
          res.status(404).json({
            error: `Namespace '${namespace}' not found in manifest.`,
            code: "NOT_FOUND",
          });
          return;
        }
      }

      const syncManager = new SyncManager(matrix, buildSourceFor(manifest), tx);
      const result = await syncManager.sync(manifest, deps.repoRoot, { namespace });
      res.json({ success: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      res.status(500).json({ error: message, code: "SYNC_ERROR" });
    }
  });

  // ── Envelope debugger (paste-only, server-side keys) ─────────────────
  registerEnvelopeRoutes(router, { ageKeyFile: deps.ageKeyFile, ageKey: deps.ageKey });

  function dispose(): void {
    lastScanResult = null;
    lastScanAt = null;
  }

  // Attach dispose to the router for cleanup
  (router as Router & { dispose: () => void }).dispose = dispose;

  return router;
}
