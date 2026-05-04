import * as path from "path";
import { ClefManifest, MatrixCell } from "../types";
import { FileEncryptionBackend } from "../types";
import { TransactionManager } from "../tx";

/**
 * Performs bulk set, delete, and copy operations across multiple environments.
 *
 * Each public method wraps its work in a single TransactionManager commit so
 * any cell-write failure rolls back ALL writes via `git reset --hard`. The
 * previous "collect errors and continue" behavior is gone — bulk ops are now
 * all-or-nothing.
 *
 * @example
 * ```ts
 * const tx = new TransactionManager(new GitIntegration(runner));
 * const bulk = new BulkOps(tx);
 * await bulk.setAcrossEnvironments("app", "DATABASE_URL", { staging: "...", production: "..." }, manifest, sopsClient, repoRoot);
 * ```
 */
export class BulkOps {
  constructor(private readonly tx: TransactionManager) {}

  /**
   * Set a key to different values in multiple environments at once.
   *
   * @param namespace - Target namespace.
   * @param key - Secret key name to set.
   * @param values - Map of `{ environment: value }` pairs.
   * @param manifest - Parsed manifest.
   * @param sopsClient - SOPS client used to decrypt and re-encrypt each file.
   * @param repoRoot - Absolute path to the repository root.
   * @throws Whatever the underlying encrypt throws — the transaction rolls back.
   */
  async setAcrossEnvironments(
    namespace: string,
    key: string,
    values: Record<string, string>,
    manifest: ClefManifest,
    sopsClient: FileEncryptionBackend,
    repoRoot: string,
  ): Promise<void> {
    const targets = manifest.environments
      .filter((env) => env.name in values)
      .map((env) => ({
        env: env.name,
        filePath: path.join(
          repoRoot,
          manifest.file_pattern
            .replace("{namespace}", namespace)
            .replace("{environment}", env.name),
        ),
      }));

    if (targets.length === 0) return;

    await this.tx.run(repoRoot, {
      description: `clef set: ${namespace}/${key} across ${targets.length} env(s)`,
      paths: targets.map((t) => path.relative(repoRoot, t.filePath)),
      mutate: async () => {
        for (const target of targets) {
          const decrypted = await sopsClient.decrypt(target.filePath);
          decrypted.values[key] = values[target.env];
          await sopsClient.encrypt(target.filePath, decrypted.values, manifest, target.env);
        }
      },
    });
  }

  /**
   * Delete a key from every environment in a namespace.
   *
   * @param namespace - Target namespace.
   * @param key - Secret key name to delete.
   * @param manifest - Parsed manifest.
   * @param sopsClient - SOPS client.
   * @param repoRoot - Absolute path to the repository root.
   */
  async deleteAcrossEnvironments(
    namespace: string,
    key: string,
    manifest: ClefManifest,
    sopsClient: FileEncryptionBackend,
    repoRoot: string,
  ): Promise<void> {
    const targets = manifest.environments.map((env) => ({
      env: env.name,
      filePath: path.join(
        repoRoot,
        manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", env.name),
      ),
    }));

    await this.tx.run(repoRoot, {
      description: `clef delete: ${namespace}/${key} from ${targets.length} env(s)`,
      paths: targets.map((t) => path.relative(repoRoot, t.filePath)),
      mutate: async () => {
        for (const target of targets) {
          const decrypted = await sopsClient.decrypt(target.filePath);
          if (key in decrypted.values) {
            delete decrypted.values[key];
            await sopsClient.encrypt(target.filePath, decrypted.values, manifest, target.env);
          }
        }
      },
    });
  }

  /**
   * Copy a single key's value from one matrix cell to another.
   *
   * @param key - Secret key name to copy.
   * @param fromCell - Source matrix cell.
   * @param toCell - Destination matrix cell.
   * @param sopsClient - SOPS client.
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   * @throws `Error` if the key does not exist in the source cell.
   */
  async copyValue(
    key: string,
    fromCell: MatrixCell,
    toCell: MatrixCell,
    sopsClient: FileEncryptionBackend,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    const source = await sopsClient.decrypt(fromCell.filePath);

    if (!(key in source.values)) {
      throw new Error(
        `Key '${key}' does not exist in ${fromCell.namespace}/${fromCell.environment}.`,
      );
    }

    await this.tx.run(repoRoot, {
      description: `clef copy: ${key} from ${fromCell.namespace}/${fromCell.environment} to ${toCell.namespace}/${toCell.environment}`,
      paths: [path.relative(repoRoot, toCell.filePath)],
      mutate: async () => {
        const dest = await sopsClient.decrypt(toCell.filePath);
        dest.values[key] = source.values[key];
        await sopsClient.encrypt(toCell.filePath, dest.values, manifest, toCell.environment);
      },
    });
  }
}
