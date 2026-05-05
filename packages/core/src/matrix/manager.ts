import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ClefManifest, MatrixCell, MatrixIssue, MatrixStatus } from "../types";
import { getPendingKeys } from "../pending/metadata";
import { readSopsKeyNames } from "../sops/keys";

/**
 * Resolves and manages the namespace × environment matrix of encrypted files.
 *
 * @example
 * ```ts
 * const manager = new MatrixManager();
 * const cells = manager.resolveMatrix(manifest, repoRoot);
 * ```
 */
export class MatrixManager {
  /**
   * Build the full grid of {@link MatrixCell} objects from the manifest.
   * Each cell reflects whether its encrypted file exists on disk.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
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

  /**
   * Return only the cells whose encrypted files do not yet exist on disk.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
  detectMissingCells(manifest: ClefManifest, repoRoot: string): MatrixCell[] {
    return this.resolveMatrix(manifest, repoRoot).filter((cell) => !cell.exists);
  }

  /**
   * Read each cell and return key counts, pending counts, and cross-environment issues.
   *
   * Keys are read from the plaintext YAML structure directly — no
   * decryption needed. A future backend that doesn't expose key names
   * without decryption would need its own implementation.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
  async getMatrixStatus(manifest: ClefManifest, repoRoot: string): Promise<MatrixStatus[]> {
    const cells = this.resolveMatrix(manifest, repoRoot);
    const statuses: MatrixStatus[] = [];

    // First pass: read key names from plaintext YAML (no decryption)
    const cellKeys = new Map<string, string[]>();
    for (const cell of cells) {
      if (cell.exists) {
        cellKeys.set(cell.filePath, this.readKeyNames(cell.filePath));
      }
    }

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

      const keys = cellKeys.get(cell.filePath) ?? [];
      const keyCount = keys.length;
      const lastModified = this.readLastModified(cell.filePath);
      const issues: MatrixIssue[] = [];

      // Cross-environment key drift (using plaintext key names, no decrypt)
      const siblingCells = cells.filter(
        (c) => c.namespace === cell.namespace && c.environment !== cell.environment && c.exists,
      );
      for (const sibling of siblingCells) {
        const siblingKeys = cellKeys.get(sibling.filePath) ?? [];
        const missingKeys = siblingKeys.filter((k) => !keys.includes(k));
        for (const mk of missingKeys) {
          issues.push({
            type: "missing_keys",
            message: `Key '${mk}' exists in ${sibling.environment} but is missing here.`,
            key: mk,
          });
        }
      }

      statuses.push({ cell, keyCount, pendingCount, lastModified, issues });
    }

    return statuses;
  }

  /**
   * Read top-level key names from a SOPS file without decryption.
   * SOPS stores key names in plaintext — only values are encrypted.
   */
  private readKeyNames(filePath: string): string[] {
    return readSopsKeyNames(filePath) ?? [];
  }

  /**
   * Read the lastModified timestamp from SOPS metadata without decryption.
   */
  private readLastModified(filePath: string): Date | null {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      const sops = parsed?.sops as Record<string, unknown> | undefined;
      if (sops?.lastmodified) return new Date(String(sops.lastmodified));
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check whether an environment has the `protected` flag set in the manifest.
   *
   * @param manifest - Parsed manifest.
   * @param environment - Environment name to check.
   */
  isProtectedEnvironment(manifest: ClefManifest, environment: string): boolean {
    const env = manifest.environments.find((e) => e.name === environment);
    return env?.protected === true;
  }
}
