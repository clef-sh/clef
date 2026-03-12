import * as path from "path";
import { ClefManifest, MatrixCell } from "../types";
import { SopsClient } from "../sops/client";

export class BulkOps {
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
        await sopsClient.encrypt(filePath, decrypted.values, manifest);
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
          await sopsClient.encrypt(filePath, decrypted.values, manifest);
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
    await sopsClient.encrypt(toCell.filePath, dest.values, manifest);
  }
}
