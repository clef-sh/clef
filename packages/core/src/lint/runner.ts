import * as path from "path";
import {
  ClefManifest,
  LintIssue,
  LintResult,
  resolveRecipientsForEnvironment,
  ServiceIdentityDefinition,
} from "../types";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { EncryptionBackend } from "../types";
import { getPendingKeys } from "../pending/metadata";

/**
 * Runs matrix completeness, schema validation, SOPS integrity, and key-drift checks.
 *
 * @example
 * ```ts
 * const runner = new LintRunner(matrixManager, schemaValidator, sopsClient);
 * const result = await runner.run(manifest, repoRoot);
 * ```
 */
export class LintRunner {
  constructor(
    private readonly matrixManager: MatrixManager,
    private readonly schemaValidator: SchemaValidator,
    private readonly sopsClient: EncryptionBackend,
  ) {}

  /**
   * Lint the entire matrix: check missing files, schema errors, SOPS integrity,
   * single-recipient warnings, and cross-environment key drift.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
  async run(manifest: ClefManifest, repoRoot: string): Promise<LintResult> {
    const issues: LintIssue[] = [];
    const cells = this.matrixManager.resolveMatrix(manifest, repoRoot);
    let fileCount = 0;
    let pendingCount = 0;

    // Category 1: Matrix completeness
    const missingCells = cells.filter((c) => !c.exists);
    for (const cell of missingCells) {
      issues.push({
        severity: "error",
        category: "matrix",
        file: cell.filePath,
        message: `Missing encrypted file for ${cell.namespace}/${cell.environment}.`,
        fixCommand: `clef init`,
      });
    }

    const existingCells = cells.filter((c) => c.exists);
    fileCount = existingCells.length;

    // Build a map of keys per namespace to detect cross-env drift
    const namespaceKeys: Record<string, Record<string, Set<string>>> = {};

    for (const cell of existingCells) {
      // Category 3: SOPS integrity
      try {
        const isValid = await this.sopsClient.validateEncryption(cell.filePath);
        if (!isValid) {
          issues.push({
            severity: "error",
            category: "sops",
            file: cell.filePath,
            message: `File is missing valid SOPS encryption metadata.`,
            fixCommand: `sops encrypt -i ${cell.filePath}`,
          });
          continue;
        }
      } catch {
        issues.push({
          severity: "error",
          category: "sops",
          file: cell.filePath,
          message: `Could not validate SOPS metadata. The file may be corrupted.`,
        });
        continue;
      }

      // Decrypt for schema and key-drift checks
      try {
        const decrypted = await this.sopsClient.decrypt(cell.filePath);
        const keys = Object.keys(decrypted.values);

        // Track keys per namespace/environment
        if (!namespaceKeys[cell.namespace]) {
          namespaceKeys[cell.namespace] = {};
        }
        namespaceKeys[cell.namespace][cell.environment] = new Set(keys);

        // Check SOPS metadata for single-recipient warning
        if (decrypted.metadata.recipients.length <= 1) {
          issues.push({
            severity: "info",
            category: "sops",
            file: cell.filePath,
            message: `File is encrypted with only ${decrypted.metadata.recipients.length} recipient(s). Consider adding a backup key.`,
          });
        }

        // Per-environment recipient drift check
        const envRecipients = resolveRecipientsForEnvironment(manifest, cell.environment);
        if (envRecipients) {
          const expectedKeys = new Set(
            envRecipients.map((r) => (typeof r === "string" ? r : r.key)),
          );
          const actualKeys = new Set(decrypted.metadata.recipients);
          for (const expected of expectedKeys) {
            if (!actualKeys.has(expected)) {
              issues.push({
                severity: "warning",
                category: "sops",
                file: cell.filePath,
                message: `Expected recipient '${expected.slice(0, 4)}…${expected.slice(-8)}' is missing from encrypted file.`,
                fixCommand: `clef recipients add ${expected} -e ${cell.environment}`,
              });
            }
          }
          for (const actual of actualKeys) {
            if (!expectedKeys.has(actual)) {
              issues.push({
                severity: "warning",
                category: "sops",
                file: cell.filePath,
                message: `Unexpected recipient '${actual.slice(0, 4)}…${actual.slice(-8)}' found in encrypted file.`,
                fixCommand: `clef recipients remove ${actual} -e ${cell.environment}`,
              });
            }
          }
        }

        // Category 2: Schema validation
        const ns = manifest.namespaces.find((n) => n.name === cell.namespace);
        if (ns?.schema) {
          const schemaPath = path.join(repoRoot, ns.schema);
          try {
            const schema = this.schemaValidator.loadSchema(schemaPath);
            const result = this.schemaValidator.validate(decrypted.values, schema);

            for (const err of result.errors) {
              issues.push({
                severity: "error",
                category: "schema",
                file: cell.filePath,
                key: err.key,
                message: err.message,
                fixCommand: `clef set ${cell.namespace}/${cell.environment} ${err.key} <value>`,
              });
            }

            for (const warn of result.warnings) {
              issues.push({
                severity: "warning",
                category: "schema",
                file: cell.filePath,
                key: warn.key,
                message: warn.message,
              });
            }
          } catch {
            issues.push({
              severity: "warning",
              category: "schema",
              file: cell.filePath,
              message: `Could not load schema '${ns.schema}' for validation.`,
            });
          }
        } else {
          // No schema — flag keys with no schema as info
          for (const key of keys) {
            issues.push({
              severity: "info",
              category: "schema",
              file: cell.filePath,
              key,
              message: `Key '${key}' has no schema definition. Consider adding a schema for namespace '${cell.namespace}'.`,
            });
          }
        }

        // Check for pending keys
        try {
          const pendingKeys = await getPendingKeys(cell.filePath);
          pendingCount += pendingKeys.length;
          for (const pendingKey of pendingKeys) {
            issues.push({
              severity: "warning",
              category: "schema",
              file: cell.filePath,
              key: pendingKey,
              message: `Value is a random placeholder \u2014 replace with the real secret.`,
              fixCommand: `clef set ${cell.namespace}/${cell.environment} ${pendingKey}`,
            });
          }
        } catch {
          // Metadata unreadable — skip pending check
        }
      } catch {
        issues.push({
          severity: "error",
          category: "sops",
          file: cell.filePath,
          message: `Failed to decrypt file. Ensure you have the correct decryption key.`,
        });
      }
    }

    // Detect cross-environment key drift
    for (const [nsName, envKeys] of Object.entries(namespaceKeys)) {
      const allKeys = new Set<string>();
      for (const keys of Object.values(envKeys)) {
        for (const k of keys) allKeys.add(k);
      }

      for (const [envName, keys] of Object.entries(envKeys)) {
        for (const key of allKeys) {
          if (!keys.has(key)) {
            const presentIn = Object.entries(envKeys)
              .filter(([, ks]) => ks.has(key))
              .map(([e]) => e);
            const cell = existingCells.find(
              (c) => c.namespace === nsName && c.environment === envName,
            );
            if (cell) {
              issues.push({
                severity: "warning",
                category: "matrix",
                file: cell.filePath,
                key,
                message: `Key '${key}' is missing in ${envName} but present in ${presentIn.join(", ")}.`,
                fixCommand: `clef set ${nsName}/${envName} ${key} <value>`,
              });
            }
          }
        }
      }
    }

    // Service identity drift checks
    if (manifest.service_identities && manifest.service_identities.length > 0) {
      const siIssues = await this.lintServiceIdentities(
        manifest.service_identities,
        manifest,
        repoRoot,
        existingCells,
      );
      issues.push(...siIssues);
    }

    return { issues, fileCount: fileCount + missingCells.length, pendingCount };
  }

  /**
   * Lint service identity configurations for drift issues.
   */
  private async lintServiceIdentities(
    identities: ServiceIdentityDefinition[],
    manifest: ClefManifest,
    _repoRoot: string,
    existingCells: { namespace: string; environment: string; filePath: string }[],
  ): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const declaredEnvNames = new Set(manifest.environments.map((e) => e.name));
    const declaredNsNames = new Set(manifest.namespaces.map((ns) => ns.name));

    for (const si of identities) {
      // Namespace references
      for (const ns of si.namespaces) {
        if (!declaredNsNames.has(ns)) {
          issues.push({
            severity: "error",
            category: "service-identity",
            file: "clef.yaml",
            message: `Service identity '${si.name}' references non-existent namespace '${ns}'.`,
          });
        }
      }

      // Environment coverage
      for (const envName of declaredEnvNames) {
        if (!(envName in si.environments)) {
          issues.push({
            severity: "error",
            category: "service-identity",
            file: "clef.yaml",
            message: `Service identity '${si.name}' is missing environment '${envName}'.`,
            fixCommand: `clef service rotate ${si.name} --environment ${envName}`,
          });
        }
      }

      // Recipient registration on scoped files
      for (const cell of existingCells) {
        const envConfig = si.environments[cell.environment];
        if (!envConfig) continue;

        if (si.namespaces.includes(cell.namespace)) {
          try {
            const metadata = await this.sopsClient.getMetadata(cell.filePath);
            if (!metadata.recipients.includes(envConfig.recipient)) {
              issues.push({
                severity: "warning",
                category: "service-identity",
                file: cell.filePath,
                message: `Service identity '${si.name}' recipient is not registered in ${cell.namespace}/${cell.environment}.`,
                fixCommand: `clef service create ${si.name} --namespaces ${si.namespaces.join(",")}`,
              });
            }
          } catch {
            // Cannot read metadata — skip
          }
        } else {
          try {
            const metadata = await this.sopsClient.getMetadata(cell.filePath);
            if (metadata.recipients.includes(envConfig.recipient)) {
              issues.push({
                severity: "warning",
                category: "service-identity",
                file: cell.filePath,
                message: `Service identity '${si.name}' recipient found in ${cell.namespace}/${cell.environment} but namespace is not in scope.`,
              });
            }
          } catch {
            // Cannot read metadata — skip
          }
        }
      }
    }

    return issues;
  }

  /**
   * Auto-fix safe issues (scaffold missing matrix files), then re-run lint.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
  async fix(manifest: ClefManifest, repoRoot: string): Promise<LintResult> {
    // Auto-fix safe issues: scaffold missing files
    const missingCells = this.matrixManager.detectMissingCells(manifest, repoRoot);

    for (const cell of missingCells) {
      await this.matrixManager.scaffoldCell(cell, this.sopsClient, manifest);
    }

    // Re-run lint after fixes
    return this.run(manifest, repoRoot);
  }
}
