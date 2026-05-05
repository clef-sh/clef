import * as path from "path";
import { ClefManifest } from "../types";
import type { CellRef, SecretSource } from "../source/types";
import { MatrixManager } from "../matrix/manager";
import { TransactionManager } from "../tx";
import { generateRandomValue } from "../pending/metadata";

export interface SyncOptions {
  /** Target namespace, or undefined to sync all namespaces. */
  namespace?: string;
  /** Compute the plan but skip the transaction. */
  dryRun?: boolean;
}

export interface SyncCellPlan {
  namespace: string;
  environment: string;
  filePath: string;
  missingKeys: string[];
  isProtected: boolean;
}

export interface SyncPlan {
  cells: SyncCellPlan[];
  totalKeys: number;
  hasProtectedEnvs: boolean;
}

export interface SyncResult {
  modifiedCells: string[];
  scaffoldedKeys: Record<string, string[]>;
  totalKeysScaffolded: number;
}

/**
 * Fills gaps in the namespace × environment matrix by scaffolding missing
 * keys with random pending values.
 *
 * For a given namespace, computes the union of all keys across every
 * environment, then adds any absent keys to the environments where they
 * are missing. Each new key gets a cryptographically random placeholder
 * and is marked pending so the user knows to replace it before deploying.
 *
 * Detection reads plaintext key names via the source — no decryption
 * needed for the discovery pass. Mutation reads, merges, writes, and
 * marks pending inside a single {@link TransactionManager} commit.
 */
export class SyncManager {
  constructor(
    private readonly matrixManager: MatrixManager,
    private readonly source: SecretSource,
    private readonly tx: TransactionManager,
  ) {}

  /**
   * Compute what sync would do without mutating anything.
   */
  async plan(manifest: ClefManifest, repoRoot: string, opts: SyncOptions): Promise<SyncPlan> {
    if (opts.namespace) {
      const exists = manifest.namespaces.some((n) => n.name === opts.namespace);
      if (!exists) {
        throw new Error(`Namespace '${opts.namespace}' not found in manifest.`);
      }
    }

    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot);
    const existingCells = allCells.filter((c) => c.exists);

    // Filter to target namespace(s)
    const targetCells = opts.namespace
      ? existingCells.filter((c) => c.namespace === opts.namespace)
      : existingCells;

    // Group keys by namespace
    const keysByNsEnv: Record<string, Record<string, Set<string>>> = {};
    for (const cell of targetCells) {
      const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };
      let keys: string[];
      try {
        keys = await this.source.listKeys(ref);
      } catch {
        continue;
      }
      if (!keysByNsEnv[cell.namespace]) keysByNsEnv[cell.namespace] = {};
      keysByNsEnv[cell.namespace][cell.environment] = new Set(keys);
    }

    // Compute union per namespace and identify gaps
    const cells: SyncCellPlan[] = [];
    let totalKeys = 0;
    let hasProtectedEnvs = false;

    for (const [nsName, envKeys] of Object.entries(keysByNsEnv)) {
      const allKeys = new Set<string>();
      for (const keys of Object.values(envKeys)) {
        for (const k of keys) allKeys.add(k);
      }

      for (const cell of targetCells) {
        if (cell.namespace !== nsName) continue;
        const cellKeys = envKeys[cell.environment];
        if (!cellKeys) continue;

        const missing = [...allKeys].filter((k) => !cellKeys.has(k));
        if (missing.length === 0) continue;

        const isProtected = this.matrixManager.isProtectedEnvironment(manifest, cell.environment);
        if (isProtected) hasProtectedEnvs = true;

        cells.push({
          namespace: cell.namespace,
          environment: cell.environment,
          filePath: cell.filePath,
          missingKeys: missing.sort(),
          isProtected,
        });
        totalKeys += missing.length;
      }
    }

    return { cells, totalKeys, hasProtectedEnvs };
  }

  /**
   * Execute the sync: scaffold missing keys with random pending values.
   *
   * Returns immediately (no-op) when the plan has nothing to do.
   * When `dryRun` is set, returns a result with zero modifications —
   * the caller can inspect the plan via {@link plan} separately.
   */
  async sync(
    manifest: ClefManifest,
    repoRoot: string,
    opts: SyncOptions = {},
  ): Promise<SyncResult> {
    const syncPlan = await this.plan(manifest, repoRoot, opts);

    if (opts.dryRun || syncPlan.totalKeys === 0) {
      return { modifiedCells: [], scaffoldedKeys: {}, totalKeysScaffolded: 0 };
    }

    const txPaths: string[] = [];
    for (const cell of syncPlan.cells) {
      const rel = path.relative(repoRoot, cell.filePath);
      txPaths.push(rel);
      txPaths.push(rel.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml"));
    }

    const modifiedCells: string[] = [];
    const scaffoldedKeys: Record<string, string[]> = {};

    const nsLabel = opts.namespace ?? "all";
    const envCount = new Set(syncPlan.cells.map((c) => c.environment)).size;

    await this.tx.run(repoRoot, {
      description: `clef sync ${nsLabel}: ${syncPlan.totalKeys} key(s) across ${envCount} environment(s)`,
      paths: txPaths,
      mutate: async () => {
        for (const cell of syncPlan.cells) {
          const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };
          const decrypted = await this.source.readCell(ref);
          for (const key of cell.missingKeys) {
            decrypted.values[key] = generateRandomValue();
          }
          await this.source.writeCell(ref, decrypted.values);
          await this.source.markPending(ref, cell.missingKeys, "clef sync");

          const cellLabel = `${cell.namespace}/${cell.environment}`;
          modifiedCells.push(cellLabel);
          scaffoldedKeys[cellLabel] = cell.missingKeys;
        }
      },
    });

    return {
      modifiedCells,
      scaffoldedKeys,
      totalKeysScaffolded: syncPlan.totalKeys,
    };
  }
}
