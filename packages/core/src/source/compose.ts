/**
 * Composition factory: takes the two orthogonal abstractions
 * (`StorageBackend` for *where* bytes live, `EncryptionBackend` for
 * *how* they're encrypted) and the manifest, and produces a full
 * `SecretSource` that consumers use.
 *
 * Any combination of (storage, encryption) yields a working source —
 * `(filesystem, sops)`, `(postgres, sops)`, `(filesystem, custom)`,
 * `(postgres, custom)`. Plugin authors implementing either side don't
 * touch the other.
 *
 * Phase 2 surface: core `SecretSource` plus the three uniform traits:
 *
 *   - `Lintable` — validate-encryption + recipient-drift checks
 *   - `Rotatable` — single-cell DEK rotation via `EncryptionBackend.rotate`
 *   - `Bulk`     — looped fallback via the `defaultBulk` helper
 *
 * The remaining traits (`RecipientManaged`, `MergeAware`, `Migratable`,
 * `Structural`) involve cross-cell or substrate-specific bookkeeping
 * that today lives in dedicated managers (`RecipientManager`,
 * `BackendMigrator`, `SopsMergeDriver`, `StructureManager`). They land
 * incrementally in later phases as the corresponding CLI commands are
 * flipped to consume `SecretSource`. Until then, `isRecipientManaged`,
 * `isMergeAware`, `isMigratable`, `isStructural` correctly return
 * `false` on the composed source.
 */
import * as YAML from "yaml";
import type { ClefManifest, SopsMetadata } from "../types";
import type {
  Bulk,
  CellPendingMetadata,
  CellRef,
  CellData,
  Lintable,
  RecipientDriftResult,
  Rotatable,
  SecretSource,
} from "./types";
import type { StorageBackend } from "./storage-backend";
import type { EncryptionBackend, EncryptionContext } from "./encryption-backend";
import { defaultBulk } from "./default-bulk";

/**
 * Build a `SecretSource & Lintable & Rotatable & Bulk` from the two
 * orthogonal backends and the manifest.
 */
export function composeSecretSource(
  storage: StorageBackend,
  encryption: EncryptionBackend,
  manifest: ClefManifest,
): SecretSource & Lintable & Rotatable & Bulk {
  return new ComposedSecretSource(storage, encryption, manifest);
}

class ComposedSecretSource implements SecretSource, Lintable, Rotatable, Bulk {
  readonly id: string;
  readonly description: string;

  constructor(
    private readonly storage: StorageBackend,
    private readonly encryption: EncryptionBackend,
    private readonly manifest: ClefManifest,
  ) {
    this.id = `${storage.id}+${encryption.id}`;
    this.description = `${storage.description} / ${encryption.description}`;
  }

  private context(cell: CellRef): EncryptionContext {
    return {
      manifest: this.manifest,
      environment: cell.environment,
      format: this.storage.blobFormat(cell),
    };
  }

  // ── Core SecretSource ──────────────────────────────────────────────────

  async readCell(cell: CellRef): Promise<CellData> {
    const blob = await this.storage.readBlob(cell);
    return this.encryption.decrypt(blob, this.context(cell));
  }

  async writeCell(cell: CellRef, values: Record<string, string>): Promise<void> {
    const blob = await this.encryption.encrypt(values, this.context(cell));
    await this.storage.writeBlob(cell, blob);
  }

  async deleteCell(cell: CellRef): Promise<void> {
    await this.storage.deleteBlob(cell);
  }

  async cellExists(cell: CellRef): Promise<boolean> {
    return this.storage.blobExists(cell);
  }

  /**
   * List cell keys WITHOUT decrypting. SOPS files store key names in
   * plaintext at the top level of the YAML/JSON document — we read the
   * blob and return everything except the `sops:` metadata block.
   *
   * NOTE: this is currently SOPS-shaped. A future non-SOPS
   * `EncryptionBackend` whose ciphertext doesn't expose key names in
   * the clear would need its own listing strategy — likely a
   * `listKeys(blob)` method on `EncryptionBackend`. Deferred until a
   * second backend exists.
   */
  async listKeys(cell: CellRef): Promise<string[]> {
    if (!(await this.storage.blobExists(cell))) return [];
    const blob = await this.storage.readBlob(cell);
    const parsed = YAML.parse(blob) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.keys(parsed).filter((k) => k !== "sops");
  }

  async getCellMetadata(cell: CellRef): Promise<SopsMetadata> {
    const blob = await this.storage.readBlob(cell);
    return this.encryption.getMetadata(blob);
  }

  async scaffoldCell(cell: CellRef, manifest: ClefManifest): Promise<void> {
    if (await this.storage.blobExists(cell)) return;
    const blob = await this.encryption.encrypt(
      {},
      {
        manifest,
        environment: cell.environment,
        format: this.storage.blobFormat(cell),
      },
    );
    await this.storage.writeBlob(cell, blob);
  }

  // ── Pending / rotation metadata ────────────────────────────────────────

  async getPendingMetadata(cell: CellRef): Promise<CellPendingMetadata> {
    return this.storage.readPendingMetadata(cell);
  }

  async markPending(cell: CellRef, keys: string[], setBy: string): Promise<void> {
    const meta = await this.storage.readPendingMetadata(cell);
    const now = new Date();
    for (const key of keys) {
      if (!meta.pending.find((p) => p.key === key)) {
        meta.pending.push({ key, since: now, setBy });
      }
    }
    await this.storage.writePendingMetadata(cell, meta);
  }

  async markResolved(cell: CellRef, keys: string[]): Promise<void> {
    const meta = await this.storage.readPendingMetadata(cell);
    meta.pending = meta.pending.filter((p) => !keys.includes(p.key));
    await this.storage.writePendingMetadata(cell, meta);
  }

  async recordRotation(cell: CellRef, keys: string[], rotatedBy: string): Promise<void> {
    const meta = await this.storage.readPendingMetadata(cell);
    const now = new Date();
    for (const key of keys) {
      const existing = meta.rotations.find((r) => r.key === key);
      if (existing) {
        existing.lastRotatedAt = now;
        existing.rotatedBy = rotatedBy;
        existing.rotationCount += 1;
      } else {
        meta.rotations.push({ key, lastRotatedAt: now, rotatedBy, rotationCount: 1 });
      }
    }
    await this.storage.writePendingMetadata(cell, meta);
  }

  async removeRotation(cell: CellRef, keys: string[]): Promise<void> {
    const meta = await this.storage.readPendingMetadata(cell);
    meta.rotations = meta.rotations.filter((r) => !keys.includes(r.key));
    await this.storage.writePendingMetadata(cell, meta);
  }

  // ── Lintable ───────────────────────────────────────────────────────────

  async validateEncryption(cell: CellRef): Promise<boolean> {
    if (!(await this.storage.blobExists(cell))) return false;
    const blob = await this.storage.readBlob(cell);
    return this.encryption.validateEncryption(blob);
  }

  async checkRecipientDrift(cell: CellRef, expected: string[]): Promise<RecipientDriftResult> {
    const blob = await this.storage.readBlob(cell);
    const meta = this.encryption.getMetadata(blob);
    const actual = new Set(meta.recipients);
    const expectedSet = new Set(expected);
    return {
      missing: expected.filter((r) => !actual.has(r)),
      unexpected: meta.recipients.filter((r) => !expectedSet.has(r)),
    };
  }

  // ── Rotatable ──────────────────────────────────────────────────────────

  async rotate(cell: CellRef, newRecipient: string): Promise<void> {
    const blob = await this.storage.readBlob(cell);
    const rotated = await this.encryption.rotate(
      blob,
      { addAge: newRecipient },
      this.context(cell),
    );
    await this.storage.writeBlob(cell, rotated);
  }

  // ── Bulk ───────────────────────────────────────────────────────────────
  //
  // Default looped implementation. A future StorageBackend that supports
  // batch operations (e.g. PostgresStorageBackend with row-level UPDATE
  // batching) can override these by wrapping `composeSecretSource`'s
  // output and replacing just the bulk methods.

  bulkSet = (
    namespace: string,
    key: string,
    valuesByEnv: Record<string, string>,
    manifest: ClefManifest,
  ): Promise<void> => defaultBulk(this).bulkSet(namespace, key, valuesByEnv, manifest);

  bulkDelete = (namespace: string, key: string, manifest: ClefManifest): Promise<void> =>
    defaultBulk(this).bulkDelete(namespace, key, manifest);

  copyValue = (key: string, from: CellRef, to: CellRef, manifest: ClefManifest): Promise<void> =>
    defaultBulk(this).copyValue(key, from, to, manifest);
}
