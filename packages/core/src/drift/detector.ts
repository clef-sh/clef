import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ManifestParser, CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { MatrixManager } from "../matrix/manager";
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

    for (const ns of sharedNamespaces) {
      // Collect key → environment sets across both repos
      const keyEnvs = new Map<string, Set<string>>();
      const allEnvs = new Set<string>();

      // Read keys from local cells
      const localNsCells = localCells.filter((c) => c.namespace === ns);
      for (const cell of localNsCells) {
        const keys = this.readKeysFromFile(cell.filePath);
        if (keys === null) continue;
        allEnvs.add(cell.environment);
        for (const key of keys) {
          if (!keyEnvs.has(key)) keyEnvs.set(key, new Set());
          keyEnvs.get(key)!.add(cell.environment);
        }
      }

      // Read keys from remote cells
      const remoteNsCells = remoteCells.filter((c) => c.namespace === ns);
      for (const cell of remoteNsCells) {
        const keys = this.readKeysFromFile(cell.filePath);
        if (keys === null) continue;
        allEnvs.add(cell.environment);
        for (const key of keys) {
          if (!keyEnvs.has(key)) keyEnvs.set(key, new Set());
          keyEnvs.get(key)!.add(cell.environment);
        }
      }

      // Compare: a key must exist in every environment that has a readable file
      const envList = [...allEnvs];
      let nsClean = true;

      for (const [key, envSet] of keyEnvs) {
        const missingFrom = envList.filter((e) => !envSet.has(e));
        if (missingFrom.length > 0) {
          nsClean = false;
          const presentIn = [...envSet].sort();
          issues.push({
            namespace: ns,
            key,
            presentIn,
            missingFrom: missingFrom.sort(),
            message: `Key '${key}' in namespace '${ns}' exists in [${presentIn.join(", ")}] but is missing from [${missingFrom.sort().join(", ")}]`,
          });
        }
      }

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

  /**
   * Read top-level key names from an encrypted SOPS YAML file,
   * filtering out the `sops` metadata key.
   *
   * @returns Array of key names, or `null` if the file cannot be read.
   */
  private readKeysFromFile(filePath: string): string[] | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = YAML.parse(raw);
      if (parsed === null || parsed === undefined || typeof parsed !== "object") return null;
      return Object.keys(parsed).filter((k) => k !== "sops");
    } catch {
      return null;
    }
  }
}
