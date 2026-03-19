import * as path from "path";
import { Router, Request, Response } from "express";
import {
  ManifestParser,
  MatrixManager,
  SopsClient,
  DiffEngine,
  LintRunner,
  SchemaValidator,
  GitIntegration,
  BulkOps,
  ScanRunner,
  SubprocessRunner,
  ClefManifest,
  ScanResult,
  getPendingKeys,
  markResolved,
  markPendingWithRetry,
  generateRandomValue,
  ImportRunner,
  RecipientManager,
  validateAgePublicKey,
} from "@clef-sh/core";
import type { ImportFormat } from "@clef-sh/core";

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
  // Wrap the runner so sops subprocesses always run from the repo root.
  // This ensures sops finds .sops.yaml via working-directory discovery,
  // even when the server process CWD differs (e.g. e2e / CI environments).
  const sopsRunner: SubprocessRunner = {
    run: (cmd, args, opts) =>
      deps.runner.run(cmd, args, { ...opts, cwd: opts?.cwd ?? deps.repoRoot }),
  };
  const sops = new SopsClient(sopsRunner, deps.ageKeyFile, deps.ageKey, deps.sopsPath);
  const diffEngine = new DiffEngine();
  const schemaValidator = new SchemaValidator();
  const lintRunner = new LintRunner(matrix, schemaValidator, sops);
  const git = new GitIntegration(deps.runner);
  const scanRunner = new ScanRunner(deps.runner);
  const recipientManager = new RecipientManager(sops, matrix);
  const bulkOps = new BulkOps();

  // In-session scan cache
  let lastScanResult: ScanResult | null = null;
  let lastScanAt: string | null = null;

  function loadManifest(): ClefManifest {
    const manifestPath = `${deps.repoRoot}/clef.yaml`;
    return parser.parse(manifestPath);
  }

  function setNoCacheHeaders(res: Response): void {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
  }

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
        const { value, random, confirmed } = req.body as {
          value?: string;
          random?: boolean;
          confirmed?: boolean;
        };

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

        const filePath = `${deps.repoRoot}/${manifest.file_pattern.replace("{namespace}", ns).replace("{environment}", env)}`;
        const decrypted = await sops.decrypt(filePath);

        if (random) {
          // Generate random value server-side and mark as pending
          const randomValue = generateRandomValue();
          const previousValue = decrypted.values[key];
          decrypted.values[key] = randomValue;
          await sops.encrypt(filePath, decrypted.values, manifest, env);

          try {
            await markPendingWithRetry(filePath, [key], "clef ui");
          } catch {
            // Both retry attempts failed — roll back the encrypt
            try {
              if (previousValue !== undefined) {
                decrypted.values[key] = previousValue;
              } else {
                delete decrypted.values[key];
              }
              await sops.encrypt(filePath, decrypted.values, manifest, env);
            } catch {
              // Rollback also failed — return 500 with context
              return res.status(500).json({
                error: "Partial failure",
                message:
                  "Value was encrypted but pending state could not be recorded. " +
                  "Rollback also failed. The key may have a random placeholder value. " +
                  "Check the file manually.",
                code: "PARTIAL_FAILURE",
              });
            }
            return res.status(500).json({
              error: "Pending state could not be recorded",
              message: "The operation was rolled back. No changes were made.",
              code: "PENDING_FAILURE",
            });
          }

          res.json({ success: true, key, pending: true });
        } else {
          decrypted.values[key] = String(value);
          await sops.encrypt(filePath, decrypted.values, manifest, env);

          // Validate against schema if defined (B1)
          const nsDef = manifest.namespaces.find((n) => n.name === ns);
          if (nsDef?.schema) {
            try {
              const schema = schemaValidator.loadSchema(path.join(deps.repoRoot, nsDef.schema));
              const result = schemaValidator.validate({ [key]: String(value) }, schema);
              const violations = [...result.errors, ...result.warnings];
              if (violations.length > 0) {
                // Resolve pending state if the key was pending
                try {
                  await markResolved(filePath, [key]);
                } catch {
                  // Metadata update failed — non-fatal
                }
                return res.json({
                  success: true,
                  key,
                  warnings: violations.map((v) => v.message),
                });
              }
            } catch {
              // Schema load failed — skip validation, not fatal
            }
          }

          // Resolve pending state if the key was pending
          try {
            await markResolved(filePath, [key]);
          } catch {
            // Metadata update failed — non-fatal
          }

          res.json({ success: true, key });
        }
      } catch {
        res.status(500).json({ error: "Failed to set value", code: "SET_ERROR" });
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
        const { confirmed } = (req.body ?? {}) as { confirmed?: boolean };

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

        const filePath = `${deps.repoRoot}/${manifest.file_pattern.replace("{namespace}", ns).replace("{environment}", env)}`;
        const decrypted = await sops.decrypt(filePath);

        if (!(key in decrypted.values)) {
          res.status(404).json({
            error: `Key '${key}' not found in ${ns}/${env}.`,
            code: "KEY_NOT_FOUND",
          });
          return;
        }

        delete decrypted.values[key];
        await sops.encrypt(filePath, decrypted.values, manifest, env);

        // Clean up pending metadata if it exists
        try {
          await markResolved(filePath, [key]);
        } catch {
          // Best effort — orphaned metadata is annoying but not dangerous
        }

        res.json({ success: true, key });
      } catch {
        res.status(500).json({ error: "Failed to delete key", code: "DELETE_ERROR" });
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

      await bulkOps.copyValue(key, fromCell, toCell, sops, manifest);
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

        const result = await diffEngine.diffFiles(ns, envA, envB, manifest, sops, deps.repoRoot);
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

  // GET /api/lint
  router.get("/lint", async (_req: Request, res: Response) => {
    try {
      const manifest = loadManifest();
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
      const result = await lintRunner.fix(manifest, deps.repoRoot);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run lint fix";
      res.status(500).json({ error: message, code: "LINT_FIX_ERROR" });
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

      const importRunner = new ImportRunner(sops);
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

      const importRunner = new ImportRunner(sops);
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
      const result = await recipientManager.remove(key, manifest, deps.repoRoot);
      const cells = matrix.resolveMatrix(manifest, deps.repoRoot);
      const targets = cells.filter((c) => c.exists).map((c) => `${c.namespace}/${c.environment}`);
      res.json({ ...result, rotationReminder: targets });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove recipient";
      res.status(500).json({ error: message, code: "RECIPIENTS_REMOVE_ERROR" });
    }
  });

  function dispose(): void {
    lastScanResult = null;
    lastScanAt = null;
  }

  // Attach dispose to the router for cleanup
  (router as Router & { dispose: () => void }).dispose = dispose;

  return router;
}
