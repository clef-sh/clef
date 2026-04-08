import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import {
  BackendType,
  ClefManifest,
  EncryptionBackend,
  EnvironmentSopsOverride,
  MatrixCell,
  SopsMetadata,
} from "../types";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";

export interface MigrationTarget {
  backend: BackendType;
  /** Key identifier: ARN, resource ID, URL, or fingerprint. Undefined for age. */
  key?: string;
}

export interface MigrationOptions {
  target: MigrationTarget;
  /** Scope migration to a single environment. */
  environment?: string;
  /** Preview changes without modifying files. */
  dryRun?: boolean;
  /** Skip post-migration verification. */
  skipVerify?: boolean;
}

export interface MigrationResult {
  migratedFiles: string[];
  skippedFiles: string[];
  rolledBack: boolean;
  error?: string;
  verifiedFiles: string[];
  warnings: string[];
}

export interface MigrationProgressEvent {
  type: "skip" | "migrate" | "verify" | "info" | "warn";
  file?: string;
  message: string;
}

// ── Key-field mapping ───────────────────────────────────────────────────────

const BACKEND_KEY_FIELDS: Record<BackendType, keyof EnvironmentSopsOverride | undefined> = {
  age: undefined,
  awskms: "aws_kms_arn",
  gcpkms: "gcp_kms_resource_id",
  azurekv: "azure_kv_url",
  pgp: "pgp_fingerprint",
  cloud: undefined,
};

const ALL_KEY_FIELDS = Object.values(BACKEND_KEY_FIELDS).filter(
  (v): v is keyof EnvironmentSopsOverride => v !== undefined,
);

function metadataMatchesTarget(meta: SopsMetadata, target: MigrationTarget): boolean {
  if (meta.backend !== target.backend) return false;
  if (!target.key) return true;
  return meta.recipients.includes(target.key);
}

// ── BackendMigrator ─────────────────────────────────────────────────────────

export class BackendMigrator {
  private readonly decryptBackend: EncryptionBackend;
  private readonly encryptBackend: EncryptionBackend;

  /**
   * @param encryption - Backend used for both decrypt and encrypt (standard case).
   * @param matrixManager - Matrix resolver.
   * @param targetEncryption - Optional separate backend for encrypt. Use when migrating
   *   from cloud (decrypt via keyservice) to another backend (encrypt via local credentials).
   */
  constructor(
    encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
    targetEncryption?: EncryptionBackend,
  ) {
    this.decryptBackend = encryption;
    this.encryptBackend = targetEncryption ?? encryption;
  }

  async migrate(
    manifest: ClefManifest,
    repoRoot: string,
    options: MigrationOptions,
    onProgress?: (event: MigrationProgressEvent) => void,
  ): Promise<MigrationResult> {
    const { target, environment, dryRun, skipVerify } = options;

    // ── Phase 0: Validate ──────────────────────────────────────────────

    if (environment) {
      const env = manifest.environments.find((e) => e.name === environment);
      if (!env) {
        throw new Error(`Environment '${environment}' not found in manifest.`);
      }
    }

    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
    const targetCells = environment
      ? allCells.filter((c) => c.environment === environment)
      : allCells;

    if (targetCells.length === 0) {
      return {
        migratedFiles: [],
        skippedFiles: [],
        rolledBack: false,
        verifiedFiles: [],
        warnings: ["No encrypted files found to migrate."],
      };
    }

    // Classify cells: skip those already on the target backend+key
    const toMigrate: MatrixCell[] = [];
    const skippedFiles: string[] = [];

    for (const cell of targetCells) {
      const meta = await this.decryptBackend.getMetadata(cell.filePath);
      if (metadataMatchesTarget(meta, target)) {
        skippedFiles.push(cell.filePath);
        onProgress?.({
          type: "skip",
          file: cell.filePath,
          message: `${cell.namespace}/${cell.environment}: already on ${target.backend}, skipping`,
        });
      } else {
        toMigrate.push(cell);
      }
    }

    if (toMigrate.length === 0) {
      return {
        migratedFiles: [],
        skippedFiles,
        rolledBack: false,
        verifiedFiles: [],
        warnings: ["All files already use the target backend and key. Nothing to migrate."],
      };
    }

    // ── Phase 1: Dry run ───────────────────────────────────────────────

    if (dryRun) {
      const warnings: string[] = [];
      for (const cell of toMigrate) {
        onProgress?.({
          type: "info",
          file: cell.filePath,
          message: `Would migrate ${cell.namespace}/${cell.environment} to ${target.backend}`,
        });
      }
      if (environment) {
        warnings.push(
          `Would add per-environment backend override for '${environment}' → ${target.backend}`,
        );
      } else {
        warnings.push(`Would update global default_backend → ${target.backend}`);
      }
      this.checkAgeRecipientsWarning(manifest, target, environment, warnings);
      return {
        migratedFiles: [],
        skippedFiles,
        rolledBack: false,
        verifiedFiles: [],
        warnings,
      };
    }

    // ── Phase 2: Backup ────────────────────────────────────────────────

    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const manifestBackup = fs.readFileSync(manifestPath, "utf-8");

    const fileBackups = new Map<string, string>();

    // ── Phase 3: Update manifest ───────────────────────────────────────

    const doc = readManifestYaml(repoRoot);
    this.updateManifestDoc(doc, target, environment);
    writeManifestYaml(repoRoot, doc);

    const updatedManifest = YAML.parse(YAML.stringify(doc)) as ClefManifest;

    // ── Phase 4: Decrypt & re-encrypt ──────────────────────────────────

    const migratedFiles: string[] = [];

    for (const cell of toMigrate) {
      try {
        fileBackups.set(cell.filePath, fs.readFileSync(cell.filePath, "utf-8"));

        onProgress?.({
          type: "migrate",
          file: cell.filePath,
          message: `Migrating ${cell.namespace}/${cell.environment}...`,
        });

        const decrypted = await this.decryptBackend.decrypt(cell.filePath);
        await this.encryptBackend.encrypt(
          cell.filePath,
          decrypted.values,
          updatedManifest,
          cell.environment,
        );

        migratedFiles.push(cell.filePath);
      } catch (err) {
        // Rollback everything
        this.rollback(manifestPath, manifestBackup, fileBackups);

        const errorMsg = err instanceof Error ? err.message : String(err);
        onProgress?.({
          type: "warn",
          file: cell.filePath,
          message: `Migration failed: ${errorMsg}. All changes rolled back.`,
        });

        return {
          migratedFiles: [],
          skippedFiles,
          rolledBack: true,
          error: `Failed on ${cell.namespace}/${cell.environment}: ${errorMsg}`,
          verifiedFiles: [],
          warnings: ["All changes have been rolled back."],
        };
      }
    }

    // ── Phase 5: Verify ────────────────────────────────────────────────

    const verifiedFiles: string[] = [];
    const warnings: string[] = [];

    if (!skipVerify) {
      for (const cell of toMigrate) {
        try {
          onProgress?.({
            type: "verify",
            file: cell.filePath,
            message: `Verifying ${cell.namespace}/${cell.environment}...`,
          });
          await this.encryptBackend.decrypt(cell.filePath);
          verifiedFiles.push(cell.filePath);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          warnings.push(
            `Verification failed for ${cell.namespace}/${cell.environment}: ${errorMsg}`,
          );
        }
      }
    }

    this.checkAgeRecipientsWarning(manifest, target, environment, warnings);

    return { migratedFiles, skippedFiles, rolledBack: false, verifiedFiles, warnings };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private updateManifestDoc(
    doc: Record<string, unknown>,
    target: MigrationTarget,
    environment?: string,
  ): void {
    const keyField = BACKEND_KEY_FIELDS[target.backend];

    if (environment) {
      // Per-environment override
      const environments = doc.environments as Record<string, unknown>[];
      const envDoc = environments.find(
        (e) => (e as { name: string }).name === environment,
      ) as Record<string, unknown>;

      const sopsOverride: Record<string, unknown> = { backend: target.backend };
      if (keyField && target.key) {
        sopsOverride[keyField] = target.key;
      }
      envDoc.sops = sopsOverride;
    } else {
      // Global default
      const sops = doc.sops as Record<string, unknown>;
      sops.default_backend = target.backend;

      // Clear all key fields, then set the new one
      for (const field of ALL_KEY_FIELDS) {
        delete sops[field];
      }
      if (keyField && target.key) {
        sops[keyField] = target.key;
      }
    }

    // Remove the cloud config block if no environment still uses the cloud backend
    if (doc.cloud && target.backend !== "cloud") {
      const sops = doc.sops as Record<string, unknown>;
      const environments = doc.environments as Record<string, unknown>[];
      const defaultIsCloud = sops.default_backend === "cloud";
      const anyEnvIsCloud = environments.some((e) => {
        const envSops = e.sops as Record<string, unknown> | undefined;
        return envSops?.backend === "cloud";
      });

      if (!defaultIsCloud && !anyEnvIsCloud) {
        delete doc.cloud;
      }
    }
  }

  private rollback(
    manifestPath: string,
    manifestBackup: string,
    fileBackups: Map<string, string>,
  ): void {
    // Restore encrypted files
    for (const [filePath, backup] of fileBackups) {
      fs.writeFileSync(filePath, backup, "utf-8");
    }
    // Restore manifest
    fs.writeFileSync(manifestPath, manifestBackup, "utf-8");
  }

  private checkAgeRecipientsWarning(
    manifest: ClefManifest,
    target: MigrationTarget,
    environment: string | undefined,
    warnings: string[],
  ): void {
    if (target.backend === "age") return;

    const hasRecipients = environment
      ? manifest.environments.find((e) => e.name === environment)?.recipients?.length
      : manifest.environments.some((e) => e.recipients?.length);

    if (hasRecipients) {
      warnings.push(
        "Per-environment age recipients are no longer used for encryption on the migrated environments. " +
          "Consider removing them from clef.yaml if they are no longer needed.",
      );
    }
  }
}
