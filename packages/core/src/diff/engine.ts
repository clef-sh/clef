/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as path from "path";
import { ClefManifest, DiffResult, DiffRow, DiffStatus } from "../types";
import { SopsClient } from "../sops/client";

/**
 * Compares decrypted values between two environments or two arbitrary key/value maps.
 *
 * @example
 * ```ts
 * const engine = new DiffEngine();
 * const result = await engine.diffFiles("app", "staging", "production", manifest, sopsClient, repoRoot);
 * ```
 */
export class DiffEngine {
  /**
   * Compare two in-memory value maps and produce a sorted diff result.
   *
   * Rows are sorted with missing and changed keys first, identical keys last.
   *
   * @param valuesA - Decrypted values from environment A.
   * @param valuesB - Decrypted values from environment B.
   * @param envA - Name of environment A.
   * @param envB - Name of environment B.
   * @param namespace - Namespace label included in the result (optional).
   */
  diff(
    valuesA: Record<string, string>,
    valuesB: Record<string, string>,
    envA: string,
    envB: string,
    namespace: string = "",
  ): DiffResult {
    const allKeys = new Set([...Object.keys(valuesA), ...Object.keys(valuesB)]);
    const rows: DiffRow[] = [];

    for (const key of allKeys) {
      const inA = key in valuesA;
      const inB = key in valuesB;

      let status: DiffStatus;
      if (inA && inB) {
        status = valuesA[key] === valuesB[key] ? "identical" : "changed";
      } else if (inA && !inB) {
        status = "missing_b";
      } else {
        status = "missing_a";
      }

      rows.push({
        key,
        valueA: inA ? valuesA[key] : null,
        valueB: inB ? valuesB[key] : null,
        status,
      });
    }

    // Sort: missing and changed first, then identical
    rows.sort((a, b) => {
      const order: Record<DiffStatus, number> = {
        missing_a: 0,
        missing_b: 0,
        changed: 1,
        identical: 2,
      };
      return order[a.status] - order[b.status];
    });

    return { namespace, envA, envB, rows };
  }

  /**
   * Decrypt two matrix cells and diff their values.
   *
   * @param namespace - Namespace containing both cells.
   * @param envA - Name of environment A.
   * @param envB - Name of environment B.
   * @param manifest - Parsed manifest used to resolve file paths.
   * @param sopsClient - SOPS client used to decrypt both files.
   * @param repoRoot - Absolute path to the repository root.
   * @throws {@link SopsDecryptionError} If either file cannot be decrypted.
   */
  async diffFiles(
    namespace: string,
    envA: string,
    envB: string,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<DiffResult> {
    const fileA = path.join(
      repoRoot,
      manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", envA),
    );
    const fileB = path.join(
      repoRoot,
      manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", envB),
    );

    const [decryptedA, decryptedB] = await Promise.all([
      sopsClient.decrypt(fileA),
      sopsClient.decrypt(fileB),
    ]);

    return this.diff(decryptedA.values, decryptedB.values, envA, envB, namespace);
  }
}
