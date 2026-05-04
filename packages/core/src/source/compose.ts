/**
 * Composition factory: wraps a `BlobStore + SopsClient + manifest` into a
 * `SecretSource` that consumers can use.
 *
 * Phase 2 implements the core `SecretSource` interface plus the three
 * cheap traits whose implementation is uniform across substrates:
 *
 *   - `Lintable` — validate-encryption + recipient-drift checks
 *   - `Rotatable` — single-cell DEK rotation via `SopsClient.rotateBlob`
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
import type { BlobStore } from "./blob-store";
import { defaultBulk } from "./default-bulk";
import { SopsClient } from "../sops/client";

/**
 * Build a `SecretSource & Lintable & Rotatable & Bulk` from a substrate
 * (`BlobStore`), the encryption layer (`SopsClient`), and the manifest.
 */
export function composeSecretSource(
  blobStore: BlobStore,
  sopsClient: SopsClient,
  manifest: ClefManifest,
): SecretSource & Lintable & Rotatable & Bulk {
  return new ComposedSecretSource(blobStore, sopsClient, manifest);
}

class ComposedSecretSource implements SecretSource, Lintable, Rotatable, Bulk {
  readonly id: string;
  readonly description: string;

  constructor(
    private readonly blobStore: BlobStore,
    private readonly sops: SopsClient,
    private readonly manifest: ClefManifest,
  ) {
    this.id = blobStore.id;
    this.description = blobStore.description;
  }

  // ── Core SecretSource ──────────────────────────────────────────────────

  async readCell(cell: CellRef): Promise<CellData> {
    const blob = await this.blobStore.readBlob(cell);
    const fmt = this.blobStore.blobFormat(cell);
    return this.sops.decryptBlob(blob, fmt);
  }

  async writeCell(cell: CellRef, values: Record<string, string>): Promise<void> {
    const fmt = this.blobStore.blobFormat(cell);
    const blob = await this.sops.encryptBlob(values, this.manifest, cell.environment, fmt);
    await this.blobStore.writeBlob(cell, blob);
  }

  async deleteCell(cell: CellRef): Promise<void> {
    await this.blobStore.deleteBlob(cell);
  }

  async cellExists(cell: CellRef): Promise<boolean> {
    return this.blobStore.blobExists(cell);
  }

  /**
   * List cell keys WITHOUT decrypting. SOPS files store key names in
   * plaintext at the top level of the YAML/JSON document — we read the
   * blob and return everything except the `sops:` metadata block.
   */
  async listKeys(cell: CellRef): Promise<string[]> {
    if (!(await this.blobStore.blobExists(cell))) return [];
    const blob = await this.blobStore.readBlob(cell);
    const parsed = YAML.parse(blob) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.keys(parsed).filter((k) => k !== "sops");
  }

  async getCellMetadata(cell: CellRef): Promise<SopsMetadata> {
    const blob = await this.blobStore.readBlob(cell);
    return this.sops.getMetadataFromBlob(blob);
  }

  async scaffoldCell(cell: CellRef, manifest: ClefManifest): Promise<void> {
    if (await this.blobStore.blobExists(cell)) return;
    const fmt = this.blobStore.blobFormat(cell);
    const blob = await this.sops.encryptBlob({}, manifest, cell.environment, fmt);
    await this.blobStore.writeBlob(cell, blob);
  }

  // ── Pending / rotation metadata ────────────────────────────────────────

  async getPendingMetadata(cell: CellRef): Promise<CellPendingMetadata> {
    return this.blobStore.readPendingMetadata(cell);
  }

  async markPending(cell: CellRef, keys: string[], setBy: string): Promise<void> {
    const meta = await this.blobStore.readPendingMetadata(cell);
    const now = new Date();
    for (const key of keys) {
      if (!meta.pending.find((p) => p.key === key)) {
        meta.pending.push({ key, since: now, setBy });
      }
    }
    await this.blobStore.writePendingMetadata(cell, meta);
  }

  async markResolved(cell: CellRef, keys: string[]): Promise<void> {
    const meta = await this.blobStore.readPendingMetadata(cell);
    meta.pending = meta.pending.filter((p) => !keys.includes(p.key));
    await this.blobStore.writePendingMetadata(cell, meta);
  }

  async recordRotation(cell: CellRef, keys: string[], rotatedBy: string): Promise<void> {
    const meta = await this.blobStore.readPendingMetadata(cell);
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
    await this.blobStore.writePendingMetadata(cell, meta);
  }

  async removeRotation(cell: CellRef, keys: string[]): Promise<void> {
    const meta = await this.blobStore.readPendingMetadata(cell);
    meta.rotations = meta.rotations.filter((r) => !keys.includes(r.key));
    await this.blobStore.writePendingMetadata(cell, meta);
  }

  // ── Lintable ───────────────────────────────────────────────────────────

  async validateEncryption(cell: CellRef): Promise<boolean> {
    if (!(await this.blobStore.blobExists(cell))) return false;
    const blob = await this.blobStore.readBlob(cell);
    return this.sops.validateEncryptionBlob(blob);
  }

  async checkRecipientDrift(cell: CellRef, expected: string[]): Promise<RecipientDriftResult> {
    const blob = await this.blobStore.readBlob(cell);
    const meta = this.sops.getMetadataFromBlob(blob);
    const actual = new Set(meta.recipients);
    const expectedSet = new Set(expected);
    return {
      missing: expected.filter((r) => !actual.has(r)),
      unexpected: meta.recipients.filter((r) => !expectedSet.has(r)),
    };
  }

  // ── Rotatable ──────────────────────────────────────────────────────────

  async rotate(cell: CellRef, newRecipient: string): Promise<void> {
    const fmt = this.blobStore.blobFormat(cell);
    const blob = await this.blobStore.readBlob(cell);
    const rotated = await this.sops.rotateBlob(blob, { addAge: newRecipient }, fmt);
    await this.blobStore.writeBlob(cell, rotated);
  }

  // ── Bulk ───────────────────────────────────────────────────────────────
  //
  // Default looped implementation. A future substrate that supports batch
  // operations (e.g. PostgresBlobStore with row-level UPDATE batching)
  // can override these by wrapping `composeSecretSource`'s output and
  // replacing just the bulk methods.

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
