/**
 * `EncryptionBackend` is the substrate-agnostic encryption contract — a
 * peer abstraction to `StorageBackend`. It takes plaintext values and
 * produces opaque ciphertext bytes (and the reverse), without ever
 * touching files, paths, or storage substrate.
 *
 * Implementations:
 *   - `createSopsEncryptionBackend(sopsClient)` — SOPS via the bundled
 *     `sops` binary. The default and only first-party implementation.
 *   - Future: any byte-shaped encryption scheme (age-direct, libsodium,
 *     BYO). Plugin authors can ship one as `@clef-sh/encryption-<id>`.
 *
 * The pairing with `StorageBackend` is intentionally orthogonal:
 *
 *   composeSecretSource(storage: StorageBackend,
 *                       encryption: EncryptionBackend,
 *                       manifest: ClefManifest): SecretSource
 *
 * Any combination of (storage, encryption) yields a working source.
 *
 * Plaintext discipline:
 *   - `encrypt` and `decrypt` may hold plaintext briefly in process memory
 *     while they shell out to the encryption tool. Implementations MUST
 *     NOT write plaintext to disk, log it, or transmit it over an
 *     untrusted channel.
 *   - `rotate` is plaintext-free: it transforms ciphertext to ciphertext
 *     (re-wrapping the data encryption key against an updated recipient
 *     set) without exposing values to the calling process.
 */
import type { ClefManifest, DecryptedFile, SopsMetadata } from "../types";

/**
 * Per-call context. Carries the manifest (for recipients/backend
 * resolution), the target environment (for per-env overrides), and the
 * format hint forwarded from the `StorageBackend`.
 */
export interface EncryptionContext {
  manifest: ClefManifest;
  environment?: string;
  /** Format of the ciphertext bytes — typically passed through verbatim. */
  format: "yaml" | "json";
}

/**
 * Recipient changes applied during a rotation. All fields are optional;
 * a backend may interpret only the keys it understands (e.g. a custom
 * non-SOPS backend that ignores `addAge` if it has no concept of age).
 */
export interface RotateOptions {
  addAge?: string;
  rmAge?: string;
  addKms?: string;
  rmKms?: string;
  addGcpKms?: string;
  rmGcpKms?: string;
  addAzureKv?: string;
  rmAzureKv?: string;
  addPgp?: string;
  rmPgp?: string;
}

export interface EncryptionBackend {
  /** Stable identifier (e.g. `"sops"`). */
  readonly id: string;
  /** Short human-readable description, used in `clef doctor`. */
  readonly description: string;

  /**
   * Encrypt a plaintext value-map into ciphertext bytes. The recipient
   * set is derived from the manifest (and optional per-env override).
   */
  encrypt(values: Record<string, string>, ctx: EncryptionContext): Promise<string>;

  /**
   * Decrypt ciphertext bytes back into a plaintext value-map plus
   * encryption metadata (backend, recipients, last-modified, ...).
   */
  decrypt(blob: string, ctx: EncryptionContext): Promise<DecryptedFile>;

  /**
   * Rotate the data encryption key and/or update the recipient set on
   * an already-encrypted blob. Returns the new ciphertext. Plaintext is
   * not exposed to the calling process.
   */
  rotate(blob: string, opts: RotateOptions, ctx: EncryptionContext): Promise<string>;

  /** Inspect ciphertext metadata without decrypting. Pure parser. */
  getMetadata(blob: string): SopsMetadata;

  /** Whether `blob` is well-formed encrypted output. Never throws. */
  validateEncryption(blob: string): boolean;
}
