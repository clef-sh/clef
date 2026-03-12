import * as path from "path";
import { ClefManifest, MatrixCell } from "../types";
import { SopsClient } from "../sops/client";

/**
 * Performs bulk set, delete, and copy operations across multiple environments.
 *
 * @example
 * ```ts
 * const bulk = new BulkOps();
 * await bulk.setAcrossEnvironments("app", "DATABASE_URL", { staging: "...", production: "..." }, manifest, sopsClient, repoRoot);
 * ```
 */
export class BulkOps {
  /**
   * Set a key to different values in multiple environments at once.
   *
   * @param namespace - Target namespace.
   * @param key - Secret key name to set.
   * @param values - Map of `{ environment: value }` pairs.
   * @param manifest - Parsed manifest.
   * @param sopsClient - SOPS client used to decrypt and re-encrypt each file.
   * @param repoRoot - Absolute path to the repository root.
   * @throws `Error` with details if any environment fails.
   */
  async setAcrossEnvironments(
    namespace: string,
    key: string,
    values: Record<string, string>,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<void> {
    const errors: Array<{ environment: string; error: Error }> = [];

    for (const env of manifest.environments) {
      if (!(env.name in values)) {
        continue;
      }

      const filePath = path.join(
        repoRoot,
        manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", env.name),
      );

      try {
        const decrypted = await sopsClient.decrypt(filePath);
        decrypted.values[key] = values[env.name];
        await sopsClient.encrypt(filePath, decrypted.values, manifest, env.name);
      } catch (err) {
        errors.push({ environment: env.name, error: err as Error });
      }
    }

    if (errors.length > 0) {
      const details = errors.map((e) => `  - ${e.environment}: ${e.error.message}`).join("\n");
      throw new Error(
        `Failed to set key '${key}' in ${errors.length} environment(s):\n${details}\n` +
          `Successfully updated ${Object.keys(values).length - errors.length} environment(s).`,
      );
    }
  }

  /**
   * Delete a key from every environment in a namespace.
   *
   * @param namespace - Target namespace.
   * @param key - Secret key name to delete.
   * @param manifest - Parsed manifest.
   * @param sopsClient - SOPS client.
   * @param repoRoot - Absolute path to the repository root.
   * @throws `Error` with details if any environment fails.
   */
  async deleteAcrossEnvironments(
    namespace: string,
    key: string,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<void> {
    const errors: Array<{ environment: string; error: Error }> = [];

    for (const env of manifest.environments) {
      const filePath = path.join(
        repoRoot,
        manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", env.name),
      );

      try {
        const decrypted = await sopsClient.decrypt(filePath);
        if (key in decrypted.values) {
          delete decrypted.values[key];
          await sopsClient.encrypt(filePath, decrypted.values, manifest, env.name);
        }
      } catch (err) {
        errors.push({ environment: env.name, error: err as Error });
      }
    }

    if (errors.length > 0) {
      const details = errors.map((e) => `  - ${e.environment}: ${e.error.message}`).join("\n");
      throw new Error(
        `Failed to delete key '${key}' in ${errors.length} environment(s):\n${details}`,
      );
    }
  }

  /**
   * Copy a single key's value from one matrix cell to another.
   *
   * @param key - Secret key name to copy.
   * @param fromCell - Source matrix cell.
   * @param toCell - Destination matrix cell.
   * @param sopsClient - SOPS client.
   * @param manifest - Parsed manifest.
   * @throws `Error` if the key does not exist in the source cell.
   */
  async copyValue(
    key: string,
    fromCell: MatrixCell,
    toCell: MatrixCell,
    sopsClient: SopsClient,
    manifest: ClefManifest,
  ): Promise<void> {
    const source = await sopsClient.decrypt(fromCell.filePath);

    if (!(key in source.values)) {
      throw new Error(
        `Key '${key}' does not exist in ${fromCell.namespace}/${fromCell.environment}.`,
      );
    }

    const dest = await sopsClient.decrypt(toCell.filePath);
    dest.values[key] = source.values[key];
    await sopsClient.encrypt(toCell.filePath, dest.values, manifest, toCell.environment);
  }
}
