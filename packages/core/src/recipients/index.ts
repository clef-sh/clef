import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ClefManifest, EncryptionBackend } from "../types";
import { MatrixManager } from "../matrix/manager";
import { validateAgePublicKey, keyPreview } from "./validator";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";

export interface Recipient {
  key: string;
  preview: string;
  label?: string;
}

export interface RecipientsResult {
  added?: Recipient;
  removed?: Recipient;
  recipients: Recipient[];
  reEncryptedFiles: string[];
  failedFiles: string[];
  warnings: string[];
}

interface RawRecipientEntry {
  key: string;
  label?: string;
}

function parseRecipientEntry(entry: unknown): RawRecipientEntry {
  if (typeof entry === "string") {
    return { key: entry };
  }
  if (typeof entry === "object" && entry !== null) {
    const obj = entry as Record<string, unknown>;
    return {
      key: String(obj.key ?? ""),
      ...(typeof obj.label === "string" ? { label: obj.label } : {}),
    };
  }
  return { key: "" };
}

function toRecipient(entry: RawRecipientEntry): Recipient {
  return {
    key: entry.key,
    preview: keyPreview(entry.key),
    ...(entry.label ? { label: entry.label } : {}),
  };
}

function readManifestYaml(repoRoot: string): Record<string, unknown> {
  const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return YAML.parse(raw) as Record<string, unknown>;
}

function writeManifestYaml(repoRoot: string, doc: Record<string, unknown>): void {
  const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, YAML.stringify(doc), "utf-8");
}

function getRecipientsArray(doc: Record<string, unknown>): unknown[] {
  const sops = doc.sops as Record<string, unknown> | undefined;
  if (!sops) return [];
  const age = sops.age as Record<string, unknown> | undefined;
  if (!age) return [];
  const recipients = age.recipients;
  if (!Array.isArray(recipients)) return [];
  return recipients;
}

function ensureRecipientsArray(doc: Record<string, unknown>): unknown[] {
  if (!doc.sops || typeof doc.sops !== "object") {
    doc.sops = {};
  }
  const sops = doc.sops as Record<string, unknown>;
  if (!sops.age || typeof sops.age !== "object") {
    sops.age = {};
  }
  const age = sops.age as Record<string, unknown>;
  if (!Array.isArray(age.recipients)) {
    age.recipients = [];
  }
  return age.recipients as unknown[];
}

function getEnvironmentRecipientsArray(doc: Record<string, unknown>, envName: string): unknown[] {
  const environments = doc.environments as Record<string, unknown>[] | undefined;
  if (!Array.isArray(environments)) return [];
  const env = environments.find((e) => (e as Record<string, unknown>).name === envName) as
    | Record<string, unknown>
    | undefined;
  if (!env) return [];
  const recipients = env.recipients;
  if (!Array.isArray(recipients)) return [];
  return recipients;
}

function ensureEnvironmentRecipientsArray(
  doc: Record<string, unknown>,
  envName: string,
): unknown[] {
  const environments = doc.environments as Record<string, unknown>[] | undefined;
  if (!Array.isArray(environments)) {
    throw new Error(`No environments array in manifest.`);
  }
  const env = environments.find((e) => (e as Record<string, unknown>).name === envName) as
    | Record<string, unknown>
    | undefined;
  if (!env) {
    throw new Error(`Environment '${envName}' not found in manifest.`);
  }
  if (!Array.isArray(env.recipients)) {
    env.recipients = [];
  }
  return env.recipients as unknown[];
}

/**
 * Manages age recipient keys in the manifest and re-encrypts matrix files on add/remove.
 * All add/remove operations are transactional — a failure triggers a full rollback.
 *
 * @example
 * ```ts
 * const manager = new RecipientManager(runner, matrixManager);
 * const result = await manager.add("age1...", "Alice", manifest, repoRoot);
 * ```
 */
export class RecipientManager {
  constructor(
    private readonly encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
  ) {}

  /**
   * List all age recipients declared in the manifest.
   *
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   * @param environment - Optional environment name to list per-env recipients.
   */
  async list(manifest: ClefManifest, repoRoot: string, environment?: string): Promise<Recipient[]> {
    if (environment) {
      const env = manifest.environments.find((e) => e.name === environment);
      if (!env) {
        throw new Error(`Environment '${environment}' not found in manifest.`);
      }
    }
    const doc = readManifestYaml(repoRoot);
    const entries = environment
      ? getEnvironmentRecipientsArray(doc, environment)
      : getRecipientsArray(doc);
    return entries.map((entry) => toRecipient(parseRecipientEntry(entry)));
  }

  /**
   * Add a new age recipient and re-encrypt all existing matrix files.
   * Rolls back the manifest and any already-re-encrypted files on failure.
   *
   * @param key - age public key to add (`age1...`).
   * @param label - Optional human-readable label for the recipient.
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   * @param environment - Optional environment name to scope the operation.
   * @throws `Error` If the key is invalid or already present.
   */
  async add(
    key: string,
    label: string | undefined,
    manifest: ClefManifest,
    repoRoot: string,
    environment?: string,
  ): Promise<RecipientsResult> {
    const validation = validateAgePublicKey(key);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    const normalizedKey = validation.key!;

    if (environment) {
      const env = manifest.environments.find((e) => e.name === environment);
      if (!env) {
        throw new Error(`Environment '${environment}' not found in manifest.`);
      }
    }

    // Read current manifest
    const doc = readManifestYaml(repoRoot);
    const currentEntries = environment
      ? getEnvironmentRecipientsArray(doc, environment)
      : getRecipientsArray(doc);
    const currentKeys = currentEntries.map((e) => parseRecipientEntry(e).key);

    if (currentKeys.includes(normalizedKey)) {
      throw new Error(`Recipient '${keyPreview(normalizedKey)}' is already present.`);
    }

    // Save backup of manifest for rollback
    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const manifestBackup = fs.readFileSync(manifestPath, "utf-8");

    // Add new recipient to manifest
    const recipients = environment
      ? ensureEnvironmentRecipientsArray(doc, environment)
      : ensureRecipientsArray(doc);
    if (label) {
      recipients.push({ key: normalizedKey, label });
    } else {
      recipients.push(normalizedKey);
    }
    writeManifestYaml(repoRoot, doc);

    // Re-encrypt matching files
    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
    const cells = environment ? allCells.filter((c) => c.environment === environment) : allCells;
    const reEncryptedFiles: string[] = [];
    const failedFiles: string[] = [];
    const fileBackups = new Map<string, string>();

    for (const cell of cells) {
      try {
        // Save file backup before re-encryption
        fileBackups.set(cell.filePath, fs.readFileSync(cell.filePath, "utf-8"));

        await this.encryption.addRecipient(cell.filePath, normalizedKey);

        reEncryptedFiles.push(cell.filePath);
      } catch {
        failedFiles.push(cell.filePath);

        // Rollback: restore manifest
        fs.writeFileSync(manifestPath, manifestBackup, "utf-8");

        // Rollback: restore previously re-encrypted files
        for (const reEncryptedFile of reEncryptedFiles) {
          const backup = fileBackups.get(reEncryptedFile);
          if (backup) {
            fs.writeFileSync(reEncryptedFile, backup, "utf-8");
          }
        }

        // Re-read the restored manifest for the result
        const restoredDoc = readManifestYaml(repoRoot);
        const restoredEntries = environment
          ? getEnvironmentRecipientsArray(restoredDoc, environment)
          : getRecipientsArray(restoredDoc);
        const restoredRecipients = restoredEntries.map((e) => toRecipient(parseRecipientEntry(e)));

        return {
          added: toRecipient({ key: normalizedKey, label }),
          recipients: restoredRecipients,
          reEncryptedFiles: [],
          failedFiles,
          warnings: ["Rollback completed: manifest and re-encrypted files have been restored."],
        };
      }
    }

    // Build final recipient list
    const updatedDoc = readManifestYaml(repoRoot);
    const updatedEntries = environment
      ? getEnvironmentRecipientsArray(updatedDoc, environment)
      : getRecipientsArray(updatedDoc);
    const finalRecipients = updatedEntries.map((e) => toRecipient(parseRecipientEntry(e)));

    return {
      added: toRecipient({ key: normalizedKey, label }),
      recipients: finalRecipients,
      reEncryptedFiles,
      failedFiles,
      warnings: [],
    };
  }

  /**
   * Remove an age recipient and re-encrypt all existing matrix files.
   * Rolls back on failure. Note: re-encryption removes _future_ access only;
   * rotate secret values to fully revoke access.
   *
   * @param key - age public key to remove.
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   * @param environment - Optional environment name to scope the operation.
   * @throws `Error` If the key is not in the manifest.
   */
  async remove(
    key: string,
    manifest: ClefManifest,
    repoRoot: string,
    environment?: string,
  ): Promise<RecipientsResult> {
    const trimmedKey = key.trim();

    if (environment) {
      const env = manifest.environments.find((e) => e.name === environment);
      if (!env) {
        throw new Error(`Environment '${environment}' not found in manifest.`);
      }
    }

    // Read current manifest
    const doc = readManifestYaml(repoRoot);
    const currentEntries = environment
      ? getEnvironmentRecipientsArray(doc, environment)
      : getRecipientsArray(doc);
    const parsed = currentEntries.map((e) => parseRecipientEntry(e));
    const matchIndex = parsed.findIndex((p) => p.key === trimmedKey);

    if (matchIndex === -1) {
      throw new Error(`Recipient '${keyPreview(trimmedKey)}' is not in the manifest.`);
    }

    const removedEntry = parsed[matchIndex];

    // Save backup of manifest for rollback
    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const manifestBackup = fs.readFileSync(manifestPath, "utf-8");

    // Remove recipient from manifest
    const recipients = environment
      ? ensureEnvironmentRecipientsArray(doc, environment)
      : ensureRecipientsArray(doc);
    recipients.splice(matchIndex, 1);
    writeManifestYaml(repoRoot, doc);

    // Re-encrypt matching files
    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
    const cells = environment ? allCells.filter((c) => c.environment === environment) : allCells;
    const reEncryptedFiles: string[] = [];
    const failedFiles: string[] = [];
    const fileBackups = new Map<string, string>();

    for (const cell of cells) {
      try {
        // Save file backup before re-encryption
        fileBackups.set(cell.filePath, fs.readFileSync(cell.filePath, "utf-8"));

        await this.encryption.removeRecipient(cell.filePath, trimmedKey);

        reEncryptedFiles.push(cell.filePath);
      } catch {
        failedFiles.push(cell.filePath);

        // Rollback: restore manifest
        fs.writeFileSync(manifestPath, manifestBackup, "utf-8");

        // Rollback: restore previously re-encrypted files
        for (const reEncryptedFile of reEncryptedFiles) {
          const backup = fileBackups.get(reEncryptedFile);
          if (backup) {
            fs.writeFileSync(reEncryptedFile, backup, "utf-8");
          }
        }

        // Re-read the restored manifest for the result
        const restoredDoc = readManifestYaml(repoRoot);
        const restoredEntries = environment
          ? getEnvironmentRecipientsArray(restoredDoc, environment)
          : getRecipientsArray(restoredDoc);
        const restoredRecipients = restoredEntries.map((e) => toRecipient(parseRecipientEntry(e)));

        return {
          removed: toRecipient(removedEntry),
          recipients: restoredRecipients,
          reEncryptedFiles: [],
          failedFiles,
          warnings: [
            "Rollback completed: manifest and re-encrypted files have been restored.",
            "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
          ],
        };
      }
    }

    // Build final recipient list
    const updatedDoc = readManifestYaml(repoRoot);
    const updatedEntries = environment
      ? getEnvironmentRecipientsArray(updatedDoc, environment)
      : getRecipientsArray(updatedDoc);
    const finalRecipients = updatedEntries.map((e) => toRecipient(parseRecipientEntry(e)));

    return {
      removed: toRecipient(removedEntry),
      recipients: finalRecipients,
      reEncryptedFiles,
      failedFiles,
      warnings: [
        "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
      ],
    };
  }
}
