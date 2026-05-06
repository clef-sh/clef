/**
 * `StorageBackend` is the substrate-level plugin-author surface for *where*
 * ciphertext bytes live. It is one of two orthogonal abstractions composed
 * into a `SecretSource`:
 *
 *   - `StorageBackend`    — substrate (filesystem, postgres, S3, ...)
 *   - `EncryptionBackend` — encryption (SOPS, age-direct, custom, ...)
 *
 * Both vary independently. Any combination — `(filesystem, sops)`,
 * `(postgres, sops)`, `(filesystem, custom)`, `(postgres, custom)` —
 * produces a working `SecretSource` via `composeSecretSource(storage,
 * encryption, manifest)`.
 *
 * Implementations have **zero** knowledge of encryption, recipients, KMS,
 * or age. They store and retrieve opaque bytes by `CellRef` and a small
 * metadata sidecar; plugin authors never re-implement encryption.
 *
 * Format of the bytes:
 *   - Whatever the paired `EncryptionBackend` produces and consumes
 *     (SOPS YAML/JSON for `sops`; could be anything for a custom backend).
 *   - The `StorageBackend` does not parse the bytes; it stores and
 *     retrieves them verbatim.
 *
 * Atomicity:
 *   - `writeBlob` MUST be atomic from the caller's perspective. A torn
 *     write would leave the cell in an undecryptable state. Filesystem
 *     impls use temp-file + rename; database impls use a transaction.
 */
import type { CellRef, CellPendingMetadata } from "./types";

export interface StorageBackend {
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
   * Format hint for the cell's bytes. Forwarded to the paired
   * `EncryptionBackend` so it can pick the right input/output type. The
   * filesystem substrate derives this from the file extension; other
   * substrates pick a fixed format.
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
