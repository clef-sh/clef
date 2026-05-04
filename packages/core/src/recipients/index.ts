import * as path from "path";
import { ClefManifest } from "../types";
import type { CellRef, Rotatable, SecretSource } from "../source/types";
import { MatrixManager } from "../matrix/manager";
import { validateAgePublicKey, keyPreview } from "./validator";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";
import { TransactionManager } from "../tx";

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
 * Manages age recipient keys in the manifest and re-encrypts matrix files on
 * add/remove. Both `add` and `remove` run inside a single TransactionManager
 * commit — any failure rolls back ALL re-encrypted files plus the manifest
 * via `git reset --hard` rather than the previous in-method rollback dance.
 *
 * @example
 * ```ts
 * const tx = new TransactionManager(new GitIntegration(runner));
 * const manager = new RecipientManager(sopsClient, matrixManager, tx);
 * const result = await manager.add("age1...", "Alice", manifest, repoRoot);
 * ```
 */
export class RecipientManager {
  constructor(
    private readonly source: SecretSource & Rotatable,
    private readonly matrixManager: MatrixManager,
    private readonly tx: TransactionManager,
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

    // Preflight: refuse if the recipient is already present (no transaction needed yet).
    const initialDoc = readManifestYaml(repoRoot);
    const initialEntries = environment
      ? getEnvironmentRecipientsArray(initialDoc, environment)
      : getRecipientsArray(initialDoc);
    const initialKeys = initialEntries.map((e) => parseRecipientEntry(e).key);
    if (initialKeys.includes(normalizedKey)) {
      throw new Error(`Recipient '${keyPreview(normalizedKey)}' is already present.`);
    }

    // Compute affected cells (manifest + every existing matrix cell, scoped
    // to the chosen environment if any).
    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
    const cells = environment ? allCells.filter((c) => c.environment === environment) : allCells;
    const reEncryptedFiles: string[] = [];

    await this.tx.run(repoRoot, {
      description: environment
        ? `clef recipients add ${keyPreview(normalizedKey)} -e ${environment}`
        : `clef recipients add ${keyPreview(normalizedKey)}`,
      paths: [...cells.map((c) => path.relative(repoRoot, c.filePath)), CLEF_MANIFEST_FILENAME],
      mutate: async () => {
        // Update manifest first so a re-encrypt failure rolls back via the
        // git reset, not via a manual write.
        const doc = readManifestYaml(repoRoot);
        const recipients = environment
          ? ensureEnvironmentRecipientsArray(doc, environment)
          : ensureRecipientsArray(doc);
        if (label) {
          recipients.push({ key: normalizedKey, label });
        } else {
          recipients.push(normalizedKey);
        }
        writeManifestYaml(repoRoot, doc);

        for (const cell of cells) {
          const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };
          await this.source.rotate(ref, { addAge: normalizedKey });
          reEncryptedFiles.push(cell.filePath);
        }
      },
    });

    // Re-read the manifest to build the final recipient list (includes the
    // new entry). Reading from disk also ensures we reflect the post-commit
    // state, not just our in-memory view.
    const updatedDoc = readManifestYaml(repoRoot);
    const updatedEntries = environment
      ? getEnvironmentRecipientsArray(updatedDoc, environment)
      : getRecipientsArray(updatedDoc);
    const finalRecipients = updatedEntries.map((e) => toRecipient(parseRecipientEntry(e)));

    return {
      added: toRecipient({ key: normalizedKey, label }),
      recipients: finalRecipients,
      reEncryptedFiles,
      failedFiles: [],
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

    // Preflight: locate the recipient and refuse early if it's not present.
    const initialDoc = readManifestYaml(repoRoot);
    const initialEntries = environment
      ? getEnvironmentRecipientsArray(initialDoc, environment)
      : getRecipientsArray(initialDoc);
    const parsed = initialEntries.map((e) => parseRecipientEntry(e));
    const matchIndex = parsed.findIndex((p) => p.key === trimmedKey);
    if (matchIndex === -1) {
      throw new Error(`Recipient '${keyPreview(trimmedKey)}' is not in the manifest.`);
    }
    const removedEntry = parsed[matchIndex];

    const allCells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
    const cells = environment ? allCells.filter((c) => c.environment === environment) : allCells;
    const reEncryptedFiles: string[] = [];

    await this.tx.run(repoRoot, {
      description: environment
        ? `clef recipients remove ${keyPreview(trimmedKey)} -e ${environment}`
        : `clef recipients remove ${keyPreview(trimmedKey)}`,
      paths: [...cells.map((c) => path.relative(repoRoot, c.filePath)), CLEF_MANIFEST_FILENAME],
      mutate: async () => {
        const doc = readManifestYaml(repoRoot);
        const recipients = environment
          ? ensureEnvironmentRecipientsArray(doc, environment)
          : ensureRecipientsArray(doc);
        const idx = recipients
          .map((e) => parseRecipientEntry(e).key)
          .findIndex((k) => k === trimmedKey);
        recipients.splice(idx, 1);
        writeManifestYaml(repoRoot, doc);

        for (const cell of cells) {
          const ref: CellRef = { namespace: cell.namespace, environment: cell.environment };
          await this.source.rotate(ref, { rmAge: trimmedKey });
          reEncryptedFiles.push(cell.filePath);
        }
      },
    });

    const updatedDoc = readManifestYaml(repoRoot);
    const updatedEntries = environment
      ? getEnvironmentRecipientsArray(updatedDoc, environment)
      : getRecipientsArray(updatedDoc);
    const finalRecipients = updatedEntries.map((e) => toRecipient(parseRecipientEntry(e)));

    return {
      removed: toRecipient(removedEntry),
      recipients: finalRecipients,
      reEncryptedFiles,
      failedFiles: [],
      warnings: [
        "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
      ],
    };
  }
}
