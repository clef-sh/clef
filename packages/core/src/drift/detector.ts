import * as path from "path";
import { ManifestParser, CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { MatrixManager } from "../matrix/manager";
import { readSopsKeyNames } from "../sops/keys";
import { DriftIssue, DriftResult } from "../types";

/**
 * Compares key sets across two local Clef repositories without decryption.
 *
 * SOPS files store key names in plaintext — only values are encrypted.
 * This means drift detection works without the `sops` binary or any
 * decryption keys. The detector reads `.enc.yaml` files as plain YAML,
 * strips the `sops` metadata key, and compares the remaining top-level
 * keys across all environments from both repos within each shared namespace.
 */
export class DriftDetector {
  private parser = new ManifestParser();
  private matrix = new MatrixManager();

  /**
   * Compare key sets between two Clef repos.
   *
   * @param localRoot - Path to the first (local) Clef repository.
   * @param remoteRoot - Path to the second (remote/other) Clef repository.
   * @param namespaceFilter - Optional list of namespace names to scope comparison.
   * @returns Drift result with any issues found.
   */
  detect(localRoot: string, remoteRoot: string, namespaceFilter?: string[]): DriftResult {
    const localManifest = this.parser.parse(path.join(localRoot, CLEF_MANIFEST_FILENAME));
    const remoteManifest = this.parser.parse(path.join(remoteRoot, CLEF_MANIFEST_FILENAME));

    const localCells = this.matrix.resolveMatrix(localManifest, localRoot);
    const remoteCells = this.matrix.resolveMatrix(remoteManifest, remoteRoot);

    const localEnvNames = localManifest.environments.map((e) => e.name);
    const remoteEnvNames = remoteManifest.environments.map((e) => e.name);

    // Find shared namespaces
    const localNsNames = new Set(localManifest.namespaces.map((n) => n.name));
    const remoteNsNames = new Set(remoteManifest.namespaces.map((n) => n.name));
    let sharedNamespaces = [...localNsNames].filter((n) => remoteNsNames.has(n));

    if (namespaceFilter && namespaceFilter.length > 0) {
      const filterSet = new Set(namespaceFilter);
      sharedNamespaces = sharedNamespaces.filter((n) => filterSet.has(n));
    }

    const issues: DriftIssue[] = [];
    let namespacesClean = 0;

    // Compute shared environments so drift detection only compares environments
    // present in both repos. Without this, an environment that exists in only
    // one repo would cause false-positive "missing key" reports.
    const remoteEnvSet = new Set(remoteEnvNames);
    const sharedEnvSet = new Set(localEnvNames.filter((e) => remoteEnvSet.has(e)));

    for (const ns of sharedNamespaces) {
      const localKeyEnvs = this.collectKeyEnvs(localCells, ns, sharedEnvSet);
      const remoteKeyEnvs = this.collectKeyEnvs(remoteCells, ns, sharedEnvSet);

      let nsClean = true;

      const reportDrift = (
        sourceMap: Map<string, Set<string>>,
        targetMap: Map<string, Set<string>>,
        direction: string,
      ) => {
        for (const [key, sourceEnvs] of sourceMap) {
          const targetEnvs = targetMap.get(key);
          const missingFrom = [...sourceEnvs].filter((e) => !targetEnvs?.has(e)).sort();
          if (missingFrom.length > 0) {
            nsClean = false;
            issues.push({
              namespace: ns,
              key,
              presentIn: [...sourceEnvs].sort(),
              missingFrom,
              message: `Key '${key}' in namespace '${ns}' exists in ${direction} [${[...sourceEnvs].sort().join(", ")}] but is missing from [${missingFrom.join(", ")}]`,
            });
          }
        }
      };

      reportDrift(remoteKeyEnvs, localKeyEnvs, "remote");
      reportDrift(localKeyEnvs, remoteKeyEnvs, "local");

      if (nsClean) namespacesClean++;
    }

    return {
      issues,
      namespacesCompared: sharedNamespaces.length,
      namespacesClean,
      localEnvironments: localEnvNames,
      remoteEnvironments: remoteEnvNames,
    };
  }

  private collectKeyEnvs(
    cells: { namespace: string; environment: string; filePath: string; exists: boolean }[],
    ns: string,
    sharedEnvSet: Set<string>,
  ): Map<string, Set<string>> {
    const keyEnvs = new Map<string, Set<string>>();
    for (const cell of cells) {
      if (cell.namespace !== ns || !sharedEnvSet.has(cell.environment)) continue;
      const keys = readSopsKeyNames(cell.filePath);
      if (keys === null) continue;
      for (const key of keys) {
        if (!keyEnvs.has(key)) keyEnvs.set(key, new Set());
        keyEnvs.get(key)!.add(cell.environment);
      }
    }
    return keyEnvs;
  }
}
