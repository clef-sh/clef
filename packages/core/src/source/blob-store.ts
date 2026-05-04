/**
 * `BlobStore` is the substrate-level plugin-author surface. Implementations
 * read and write opaque ciphertext bytes (already-SOPS-encrypted) keyed by
 * `CellRef`, plus the per-cell pending/rotation metadata sidecar.
 *
 * Implementations have **zero** knowledge of encryption, recipients, KMS,
 * or age. SOPS lives one layer up in `SopsClient`; the `composeSecretSource`
 * factory wraps a `BlobStore + SopsClient + manifest` into a full
 * `SecretSource`. This split is intentional — plugin authors do not
 * re-implement encryption primitives.
 *
 * Format of the bytes:
 *   - YAML or JSON SOPS file content (per the manifest's `file_pattern`).
 *   - The `BlobStore` does not parse the bytes; it stores and retrieves
 *     them verbatim.
 *
 * Atomicity:
 *   - `writeBlob` MUST be atomic from the caller's perspective. A torn
 *     write would leave the cell in an undecryptable state. Filesystem
 *     impls use `writeFileAtomic`; database impls use a transaction.
 */
import type { CellRef, CellPendingMetadata } from "./types";

export interface BlobStore {
  /** Stable identifier for diagnostic output (e.g. `"filesystem"`, `"postgres"`). */
  readonly id: string;
  /** Short human-readable description, used in `clef doctor`. */
  readonly description: string;

  /**
   * Read the cell's ciphertext bytes. Throws if the cell does not exist —
   * callers should use `blobExists` first when absence is a valid state.
   */
  readBlob(cell: CellRef): Promise<string>;

  /** Atomically replace the cell's ciphertext bytes. Idempotent. */
  writeBlob(cell: CellRef, blob: string): Promise<void>;

  /** Remove the cell's blob. No-op if it does not exist. */
  deleteBlob(cell: CellRef): Promise<void>;

  /** Whether the cell currently has stored ciphertext. */
  blobExists(cell: CellRef): Promise<boolean>;

  /**
   * The cell's content format hint, used to set `--input-type` /
   * `--output-type` on SOPS calls. Filesystem derives this from the file
   * extension; other substrates pick a fixed format.
   */
  blobFormat(cell: CellRef): "yaml" | "json";

  /**
   * Read pending + rotation metadata for the cell. Returns an empty
   * record when no metadata exists. Never throws on missing.
   */
  readPendingMetadata(cell: CellRef): Promise<CellPendingMetadata>;

  /** Atomically replace the cell's pending + rotation metadata. */
  writePendingMetadata(cell: CellRef, meta: CellPendingMetadata): Promise<void>;
}
