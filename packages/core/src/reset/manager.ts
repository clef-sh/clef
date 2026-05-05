import * as path from "path";
import { BackendType, ClefManifest, MatrixCell } from "../types";
import type { CellRef, SecretSource } from "../source/types";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";
import { generateRandomValue } from "../pending/metadata";
import { TransactionManager } from "../tx";
import { BACKEND_KEY_FIELDS, buildSopsOverride } from "../migration/backend";

/**
 * Target scope for a reset operation. The CLI command refuses a naked
 * `clef reset` with no scope — the user must name what they're destroying.
 */
export type ResetScope =
  | { kind: "env"; name: string }
  | { kind: "namespace"; name: string }
  | { kind: "cell"; namespace: string; environment: string };

export interface ResetOptions {
  scope: ResetScope;
  /**
   * If provided, switch the affected environments to this backend as part
   * of the reset. Written as a per-env SOPS override so other environments
   * are unaffected. When omitted, reset uses whatever backend the manifest
   * currently specifies.
   */
  backend?: BackendType;
  /**
   * Key identifier for KMS backends (ARN, resource ID, URL, fingerprint).
   * Required when `backend` is `awskms`, `gcpkms`, `azurekv`, or `pgp`.
   */
  key?: string;
  /**
   * Explicit key names to scaffold as pending random placeholders. Used
   * when the affected namespace has no schema. Ignored when a schema is
   * present — the schema's keys are authoritative.
   */
  keys?: string[];
}

export interface ResetResult {
  scaffoldedCells: string[];
  pendingKeysByCell: Record<string, string[]>;
  backendChanged: boolean;
  affectedEnvironments: string[];
}

/**
 * Destructive recovery command. Abandons the current encrypted contents of
 * matrix cells in a target scope and scaffolds fresh empty/placeholder cells
 * using the current manifest backend (or a new one supplied via options).
 *
 * Critical property: this command does NOT attempt to decrypt anything. It
 * exists precisely for the case where decryption is impossible (lost age
 * key, nuked KMS key, deleted cloud env). The scaffold path only needs
 * encrypt access to whatever backend the manifest resolves for each env —
 * which can be freshly provided via `options.backend` + `options.key` as
 * part of the same transaction.
 *
 * Placeholder strategy:
 *   - If the affected namespace has a schema, every schema key is scaffolded
 *     with a random value and marked pending. User runs `clef set` to refill.
 *   - If no schema and `options.keys` is provided, that key list is used.
 *   - Otherwise an empty cell (`{}`) is scaffolded.
 *
 * Transaction: the manifest update (when switching backends) and every
 * cell re-scaffold run inside one TransactionManager commit. Any failure
 * rolls back the manifest AND the cell writes via `git reset --hard`.
 */
export class ResetManager {
  constructor(
    private readonly matrixManager: MatrixManager,
    /**
     * Factory rather than a single instance because reset can swap the
     * SOPS backend mid-transaction (`opts.backend`).  The encryption
     * layer of a composed source is bound to a manifest at construction,
     * so writing cells under the *new* backend requires a fresh source.
     * Callers pass `(m) => composeSecretSource(storage(m), enc, m)` (or
     * equivalent) so the manager can recompose after the manifest swap.
     */
    private readonly buildSource: (manifest: ClefManifest) => SecretSource,
    private readonly schemaValidator: SchemaValidator,
    private readonly tx: TransactionManager,
  ) {}

  async reset(opts: ResetOptions, manifest: ClefManifest, repoRoot: string): Promise<ResetResult> {
    validateResetScope(opts.scope, manifest);
    validateBackendKeyCombination(opts.backend, opts.key);

    const targetCells = this.resolveCells(opts.scope, manifest, repoRoot);
    if (targetCells.length === 0) {
      throw new Error(
        `Reset scope ${describeScope(opts.scope)} matches zero cells. Check the scope name.`,
      );
    }

    const affectedEnvs = Array.from(new Set(targetCells.map((c) => c.environment))).sort();
    const affectedNamespaces = Array.from(new Set(targetCells.map((c) => c.namespace)));

    // Resolve the per-namespace key plan up front so schema load errors
    // surface before we open a transaction and before the confirmation
    // screen is passed. Also avoids re-loading the same schema for every
    // cell in a namespace-spanning reset.
    const keyPlan = this.resolveKeyPlan(affectedNamespaces, opts.keys, manifest, repoRoot);

    // Tx paths must only include files we'll actually create — `git add`
    // errors on a pathspec that doesn't match anything in the worktree.
    // The manifest is only touched when switching backends; the
    // .clef-meta.yaml sibling is only written when the cell has pending
    // keys; the cell file itself is always rewritten.
    const txPaths: string[] = [];
    if (opts.backend) {
      txPaths.push(CLEF_MANIFEST_FILENAME);
    }
    for (const cell of targetCells) {
      txPaths.push(path.relative(repoRoot, cell.filePath));
      const cellKeys = keyPlan.get(cell.namespace) ?? [];
      if (cellKeys.length > 0) {
        txPaths.push(
          path.relative(repoRoot, cell.filePath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")),
        );
      }
    }

    // Mutable local manifest reference so the scaffold loop sees the new
    // backend after the manifest update inside mutate.
    let effectiveManifest = manifest;
    const scaffoldedCells: string[] = [];
    const pendingKeysByCell: Record<string, string[]> = {};

    await this.tx.run(repoRoot, {
      description: describeResetCommit(opts, affectedEnvs, targetCells.length),
      paths: txPaths,
      mutate: async () => {
        if (opts.backend) {
          const doc = readManifestYaml(repoRoot);
          applyBackendOverride(doc, affectedEnvs, opts.backend, opts.key);
          writeManifestYaml(repoRoot, doc);
          effectiveManifest = withBackendOverride(manifest, affectedEnvs, opts.backend, opts.key);
        }

        // Recompose the source against whichever manifest is in effect
        // (post-swap when `opts.backend` was set, otherwise the input).
        const source = this.buildSource(effectiveManifest);

        for (const cell of targetCells) {
          const keys = keyPlan.get(cell.namespace) ?? [];
          const placeholders = this.buildPlaceholders(keys);
          const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };

          await source.writeCell(ref, placeholders);

          if (keys.length > 0) {
            // Mark every scaffolded key as pending so `clef lint` and the UI
            // show the user which keys need real values.
            await source.markPending(ref, keys, "clef reset");
            pendingKeysByCell[cell.filePath] = keys;
          }
          scaffoldedCells.push(cell.filePath);
        }
      },
    });

    return {
      scaffoldedCells,
      pendingKeysByCell,
      backendChanged: opts.backend !== undefined,
      affectedEnvironments: affectedEnvs,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Resolve the scope into an explicit list of cells. Assumes the scope has
   * already been validated by `validateResetScope`. Unlike most other
   * commands, reset includes cells whether or not the file currently exists
   * on disk — "reset a namespace" also re-scaffolds any missing cells under
   * it, which is the natural interpretation of "reset everything in this
   * scope."
   */
  private resolveCells(scope: ResetScope, manifest: ClefManifest, repoRoot: string): MatrixCell[] {
    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot);
    switch (scope.kind) {
      case "env":
        return allCells.filter((c) => c.environment === scope.name);
      case "namespace":
        return allCells.filter((c) => c.namespace === scope.name);
      case "cell":
        return allCells.filter(
          (c) => c.namespace === scope.namespace && c.environment === scope.environment,
        );
    }
  }

  /**
   * Build the placeholder values for a new cell from a pre-resolved key list.
   * The list is computed once per namespace by `resolveKeyPlan` so schema
   * files aren't re-read for every cell in a namespace-spanning reset.
   */
  private buildPlaceholders(keyNames: string[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const keyName of keyNames) {
      values[keyName] = generateRandomValue();
    }
    return values;
  }

  /**
   * Decide the scaffold key list for each affected namespace exactly once.
   *
   * - Namespace has a schema → every schema key (schema errors propagate;
   *   a corrupt schema is a configuration problem, not a silent fallback).
   * - No schema and `--keys` provided → that list.
   * - Otherwise → empty, user fills via `clef set`.
   */
  private resolveKeyPlan(
    namespaces: string[],
    explicitKeys: string[] | undefined,
    manifest: ClefManifest,
    repoRoot: string,
  ): Map<string, string[]> {
    const plan = new Map<string, string[]>();
    for (const namespace of namespaces) {
      const nsDef = manifest.namespaces.find((n) => n.name === namespace);
      if (nsDef?.schema) {
        const schema = this.schemaValidator.loadSchema(path.join(repoRoot, nsDef.schema));
        plan.set(namespace, Object.keys(schema.keys));
        continue;
      }
      plan.set(namespace, explicitKeys && explicitKeys.length > 0 ? [...explicitKeys] : []);
    }
    return plan;
  }
}

/** Human-readable description of a reset scope for commit messages and errors. */
export function describeScope(scope: ResetScope): string {
  switch (scope.kind) {
    case "env":
      return `env ${scope.name}`;
    case "namespace":
      return `namespace ${scope.name}`;
    case "cell":
      return `${scope.namespace}/${scope.environment}`;
  }
}

/**
 * Validate a reset scope against the manifest. Exported so the CLI can
 * reject a bad scope *before* prompting for destructive confirmation —
 * otherwise the user is asked to confirm destroying something, types "y",
 * and only then finds out the name was wrong. The ResetManager re-uses
 * this as the authoritative check at the top of `reset()`.
 */
export function validateResetScope(
  scope: ResetScope,
  manifest: { environments: { name: string }[]; namespaces: { name: string }[] },
): void {
  switch (scope.kind) {
    case "env":
      if (!manifest.environments.some((e) => e.name === scope.name)) {
        throw new Error(
          `Environment '${scope.name}' not found in manifest. ` +
            `Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
        );
      }
      return;
    case "namespace":
      if (!manifest.namespaces.some((n) => n.name === scope.name)) {
        throw new Error(
          `Namespace '${scope.name}' not found in manifest. ` +
            `Available: ${manifest.namespaces.map((n) => n.name).join(", ")}`,
        );
      }
      return;
    case "cell":
      if (!manifest.namespaces.some((n) => n.name === scope.namespace)) {
        throw new Error(`Namespace '${scope.namespace}' not found in manifest.`);
      }
      if (!manifest.environments.some((e) => e.name === scope.environment)) {
        throw new Error(`Environment '${scope.environment}' not found in manifest.`);
      }
      return;
  }
}

function validateBackendKeyCombination(
  backend: BackendType | undefined,
  key: string | undefined,
): void {
  if (!backend) return;
  const keyField = BACKEND_KEY_FIELDS[backend];
  if (keyField && !key) {
    throw new Error(`Backend '${backend}' requires a key. Pass --key <keyId>.`);
  }
  if (!keyField && key) {
    throw new Error(`Backend '${backend}' does not take a key.`);
  }
}

function describeResetCommit(opts: ResetOptions, envs: string[], cellCount: number): string {
  const scopeLabel = describeScope(opts.scope);
  const backendLabel = opts.backend ? `: switch ${envs.join(",")} to ${opts.backend}` : "";
  return `clef reset ${scopeLabel}${backendLabel} (${cellCount} cell${cellCount === 1 ? "" : "s"})`;
}

/**
 * Mutate a manifest YAML doc in place to set a per-env backend override
 * on every environment in `envNames`. Matches the shape BackendMigrator
 * uses for its non-destructive migration path.
 */
function applyBackendOverride(
  doc: Record<string, unknown>,
  envNames: string[],
  backend: BackendType,
  key: string | undefined,
): void {
  const environments = doc.environments as Record<string, unknown>[];

  for (const envName of envNames) {
    const envDoc = environments.find((e) => (e as { name: string }).name === envName) as
      | Record<string, unknown>
      | undefined;
    if (!envDoc) continue;
    envDoc.sops = buildSopsOverride(backend, key);
  }
}

/**
 * Return a new in-memory ClefManifest with backend overrides applied to the
 * given environments. Used so the scaffold step sees the new backend without
 * needing to re-read and re-parse the manifest from disk.
 */
function withBackendOverride(
  manifest: ClefManifest,
  envNames: string[],
  backend: BackendType,
  key: string | undefined,
): ClefManifest {
  const envSet = new Set(envNames);
  return {
    ...manifest,
    environments: manifest.environments.map((env) =>
      envSet.has(env.name) ? { ...env, sops: buildSopsOverride(backend, key) } : env,
    ),
  };
}
