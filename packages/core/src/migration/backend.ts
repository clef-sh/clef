import * as path from "path";
import * as YAML from "yaml";
import {
  BackendType,
  ClefManifest,
  FileEncryptionBackend,
  EnvironmentSopsOverride,
  MatrixCell,
  SopsMetadata,
} from "../types";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";
import { TransactionManager } from "../tx";

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

/**
 * Maps a SOPS backend to the manifest field that holds its key identifier.
 * `undefined` for backends that don't take a key (age).
 *
 * Exported so other backend-aware commands (clef reset, etc.) can
 * honour the same field layout without duplicating the mapping.
 */
export const BACKEND_KEY_FIELDS: Record<BackendType, keyof EnvironmentSopsOverride | undefined> = {
  age: undefined,
  awskms: "aws_kms_arn",
  gcpkms: "gcp_kms_resource_id",
  azurekv: "azure_kv_url",
  pgp: "pgp_fingerprint",
  hsm: "pkcs11_uri",
};

const ALL_KEY_FIELDS = Object.values(BACKEND_KEY_FIELDS).filter(
  (v): v is keyof EnvironmentSopsOverride => v !== undefined,
);

/**
 * Build a per-environment SOPS override block.
 * Shared by BackendMigrator and ResetManager so the key-field mapping
 * lives in one place.
 */
export function buildSopsOverride(
  backend: BackendType,
  key: string | undefined,
): EnvironmentSopsOverride {
  const override: EnvironmentSopsOverride = { backend };
  const keyField = BACKEND_KEY_FIELDS[backend];
  if (keyField && key) {
    (override as unknown as Record<string, unknown>)[keyField] = key;
  }
  return override;
}

function metadataMatchesTarget(meta: SopsMetadata, target: MigrationTarget): boolean {
  if (meta.backend !== target.backend) return false;
  if (!target.key) return true;
  return meta.recipients.includes(target.key);
}

// ── BackendMigrator ─────────────────────────────────────────────────────────

export class BackendMigrator {
  private readonly decryptBackend: FileEncryptionBackend;
  private readonly encryptBackend: FileEncryptionBackend;

  /**
   * @param encryption - Backend used for both decrypt and encrypt (standard case).
   * @param matrixManager - Matrix resolver.
   * @param tx - Transaction manager that wraps the migration in a single git commit
   *   so a partial failure rolls back ALL files + the manifest via `git reset --hard`.
   * @param targetEncryption - Optional separate backend for encrypt. Use when migrating
   *   from cloud (decrypt via keyservice) to another backend (encrypt via local credentials).
   */
  constructor(
    encryption: FileEncryptionBackend,
    private readonly matrixManager: MatrixManager,
    private readonly tx: TransactionManager,
    targetEncryption?: FileEncryptionBackend,
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

    // Warnings computed up-front so they survive the rollback return path.
    // The new manifest validator hard-rejects writes that mix per-env age
    // recipients with a non-age backend, which means the post-mutate
    // warning we used to emit could be hidden by an opaque rollback. The
    // user needs the actionable message ("remove recipients from
    // clef.yaml") even when the migration fails.
    const preMigrationWarnings: string[] = [];
    this.checkAgeRecipientsWarning(manifest, target, environment, preMigrationWarnings);

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
      // Avoid duplicating the pre-migration warnings we already collected
      // (they were emitted unconditionally above so the rollback path can
      // include them). For dry-run, the same set is the right answer.
      warnings.push(...preMigrationWarnings);
      return {
        migratedFiles: [],
        skippedFiles,
        rolledBack: false,
        verifiedFiles: [],
        warnings,
      };
    }

    // ── Phase 2: Migrate inside a transaction ─────────────────────────
    //
    // The transaction wraps both the manifest update and every cell
    // re-encrypt. A failure mid-loop triggers `git reset --hard` to the
    // pre-migration state, which is what the previous in-method
    // backup/rollback machinery did by hand.

    const migratedFiles: string[] = [];
    let migrationFailed = false;
    let migrationError: Error | undefined;

    try {
      await this.tx.run(repoRoot, {
        description: environment
          ? `clef migrate-backend ${target.backend}: ${environment}`
          : `clef migrate-backend ${target.backend}`,
        paths: [
          ...toMigrate.map((c) => path.relative(repoRoot, c.filePath)),
          CLEF_MANIFEST_FILENAME,
        ],
        mutate: async () => {
          const doc = readManifestYaml(repoRoot);
          this.updateManifestDoc(doc, target, environment);
          writeManifestYaml(repoRoot, doc);

          const updatedManifest = YAML.parse(YAML.stringify(doc)) as ClefManifest;

          for (const cell of toMigrate) {
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
          }
        },
      });
    } catch (err) {
      migrationFailed = true;
      migrationError = err as Error;
      onProgress?.({
        type: "warn",
        message: `Migration failed: ${migrationError.message}. All changes rolled back.`,
      });
    }

    if (migrationFailed) {
      return {
        migratedFiles: [],
        skippedFiles,
        rolledBack: true,
        error: migrationError!.message,
        verifiedFiles: [],
        // Surface pre-migration warnings even on rollback. The new manifest
        // validator can reject the write (e.g. per-env recipients vs.
        // non-age backend), and without these warnings the user only sees
        // an opaque "rolled back" message — not the actionable hint about
        // what to clean up first.
        warnings: ["All changes have been rolled back.", ...preMigrationWarnings],
      };
    }

    // ── Phase 3: Verify ────────────────────────────────────────────────

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

    // Pre-migration warnings already include the age-recipients hint —
    // merge them in here so the success path keeps parity with dry-run
    // and rollback (all three return the same advisory text).
    warnings.push(...preMigrationWarnings);

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

      envDoc.sops = buildSopsOverride(target.backend, target.key);
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
