import * as fs from "fs";
import * as path from "path";
import { ClefManifest, MatrixCell, MatrixIssue, MatrixStatus } from "../types";
import { SopsClient } from "../sops/client";
import { getPendingKeys } from "../pending/metadata";

export class MatrixManager {
  resolveMatrix(manifest: ClefManifest, repoRoot: string): MatrixCell[] {
    const cells: MatrixCell[] = [];

    for (const ns of manifest.namespaces) {
      for (const env of manifest.environments) {
        const relativePath = manifest.file_pattern
          .replace("{namespace}", ns.name)
          .replace("{environment}", env.name);
        const filePath = path.join(repoRoot, relativePath);

        cells.push({
          namespace: ns.name,
          environment: env.name,
          filePath,
          exists: fs.existsSync(filePath),
        });
      }
    }

    return cells;
  }

  detectMissingCells(manifest: ClefManifest, repoRoot: string): MatrixCell[] {
    return this.resolveMatrix(manifest, repoRoot).filter((cell) => !cell.exists);
  }

  async scaffoldCell(cell: MatrixCell, sopsClient: SopsClient): Promise<void> {
    const dir = path.dirname(cell.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create an empty encrypted YAML file via SOPS
    // We write an empty YAML object through sops encrypt
    const emptyManifest: ClefManifest = {
      version: 1,
      environments: [{ name: cell.environment, description: "" }],
      namespaces: [{ name: cell.namespace, description: "" }],
      sops: { default_backend: "age" },
      file_pattern: "",
    };

    await sopsClient.encrypt(cell.filePath, {}, emptyManifest);
  }

  async getMatrixStatus(
    manifest: ClefManifest,
    repoRoot: string,
    sopsClient: SopsClient,
  ): Promise<MatrixStatus[]> {
    const cells = this.resolveMatrix(manifest, repoRoot);
    const statuses: MatrixStatus[] = [];

    for (const cell of cells) {
      if (!cell.exists) {
        statuses.push({
          cell,
          keyCount: 0,
          pendingCount: 0,
          lastModified: null,
          issues: [
            {
              type: "missing_keys",
              message: `File '${cell.filePath}' does not exist. Run 'clef init' to scaffold missing files.`,
            },
          ],
        });
        continue;
      }

      // Read pending count from metadata (plaintext, no decryption needed)
      let pendingCount = 0;
      try {
        const pending = await getPendingKeys(cell.filePath);
        pendingCount = pending.length;
      } catch {
        // Metadata file missing or unreadable — 0 pending
      }

      try {
        const decrypted = await sopsClient.decrypt(cell.filePath);
        const keyCount = Object.keys(decrypted.values).length;
        const lastModified = decrypted.metadata.lastModified;
        const issues: MatrixIssue[] = [];

        // Check for key count discrepancies within the namespace
        const siblingCells = cells.filter(
          (c) => c.namespace === cell.namespace && c.environment !== cell.environment && c.exists,
        );

        for (const sibling of siblingCells) {
          try {
            const siblingDecrypted = await sopsClient.decrypt(sibling.filePath);
            const siblingKeys = Object.keys(siblingDecrypted.values);
            const currentKeys = Object.keys(decrypted.values);
            const missingKeys = siblingKeys.filter((k) => !currentKeys.includes(k));

            for (const mk of missingKeys) {
              issues.push({
                type: "missing_keys",
                message: `Key '${mk}' exists in ${sibling.environment} but is missing here.`,
                key: mk,
              });
            }
          } catch {
            // Cannot decrypt sibling — skip comparison
          }
        }

        statuses.push({ cell, keyCount, pendingCount, lastModified, issues });
      } catch {
        statuses.push({
          cell,
          keyCount: 0,
          pendingCount: 0,
          lastModified: null,
          issues: [
            {
              type: "sops_error",
              message: `Could not decrypt '${cell.filePath}'. Check your key configuration.`,
            },
          ],
        });
      }
    }

    return statuses;
  }

  isProtectedEnvironment(manifest: ClefManifest, environment: string): boolean {
    const env = manifest.environments.find((e) => e.name === environment);
    return env?.protected === true;
  }
}
