/**
 * `SecretSource` is the high-level cell-storage seam consumed by every
 * non-source-specific consumer (CLI commands, UI server, pack backends).
 * Methods take and return plaintext at this boundary; encryption is a
 * lower-layer concern that does not appear in this contract.
 *
 * Architecture (introduced in Phase 2):
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  SecretSource    plaintext cells, what consumers see │
 *   ├─────────────────────────────────────────────────────┤
 *   │  SopsClient      uniform encryption (KMS/age via     │
 *   │                  the SOPS subprocess)                │
 *   ├─────────────────────────────────────────────────────┤
 *   │  BlobStore       opaque ciphertext bytes by CellRef  │
 *   └─────────────────────────────────────────────────────┘
 *
 * The bundled `GitSopsSource` is composed from `FilesystemBlobStore +
 * SopsClient + manifest`. A future third-party source plugs in by
 * implementing `BlobStore` (a small, encryption-free interface) — the
 * encryption layer is provided uniformly by clef. Plugin authors do
 * not implement encryption primitives.
 *
 * The optional capability traits (`Lintable`, `Rotatable`, etc.)
 * declare functionality some sources can offer and others cannot.
 * SOPS-backed traits (lint/rotate/recipients/migrate) are uniform
 * across every source because they live at the SopsClient layer.
 * Substrate-shaped traits (`MergeAware`, `Structural`) are decided by
 * the BlobStore. Consumers use the type guards in `./guards` for
 * runtime detection; CLI commands and UI routes that require an
 * unsupported capability fail fast with
 * `SourceCapabilityUnsupportedError` (see `./errors`).
 */
import type { ClefManifest, SopsMetadata } from "../types";
import type { Recipient, RecipientsResult } from "../recipients";
import type { MigrationOptions, MigrationResult, MigrationTarget } from "../migration/backend";
import type { MergeResult } from "../merge/driver";
import type { CellMetadata as PendingCellMetadata } from "../pending/metadata";
import type { AddNamespaceOptions, AddEnvironmentOptions } from "../structure/manager";
import type { RotateOptions } from "./encryption-backend";

export type { RotateOptions };

/** Identifies a cell in the namespace × environment matrix. */
export interface CellRef {
  namespace: string;
  environment: string;
}

/** Result of decrypting / loading a cell's contents. */
export interface CellData {
  values: Record<string, string>;
  /**
   * Source-reported metadata. For `git-sops` this carries the SOPS
   * envelope fields (recipients, lastModified, backend, version).
   * Sources with no native equivalent populate sensible defaults.
   */
  metadata: SopsMetadata;
}

/**
 * Pending and rotation metadata for a cell. Mirrors the existing
 * `.clef-meta.yaml` data model so the only thing that changes is *where*
 * the metadata lives — file sidecar (git-sops) vs. database row
 * (postgres) etc.
 */
export type CellPendingMetadata = PendingCellMetadata;

/**
 * Boolean capability descriptor returned by `describeCapabilities` and
 * surfaced to UI clients via `GET /api/capabilities`. Field names match
 * the trait identifier so adding a new trait means adding one boolean.
 */
export interface SourceCapabilities {
  lint: boolean;
  rotate: boolean;
  recipients: boolean;
  merge: boolean;
  migrate: boolean;
  bulk: boolean;
  structural: boolean;
}

/**
 * Core contract every source must implement. Operations are cell-level
 * — callers never need to know about file paths, table names, or any
 * other substrate detail.
 *
 * Methods throw `ClefError` (or one of its subclasses such as
 * `SopsDecryptionError` / `SopsKeyNotFoundError`) on failure. Sources
 * are expected to translate substrate-specific errors into the Clef
 * hierarchy so CLI/UI consumers can render uniform error messages.
 */
export interface SecretSource {
  /** Stable source identifier (e.g. `"git-sops"`, `"postgres"`). */
  readonly id: string;
  /** Short human-readable description, used in `clef doctor` output. */
  readonly description: string;

  /** Decrypt / load the cell's values and metadata. */
  readCell(cell: CellRef): Promise<CellData>;
  /**
   * Replace the cell's values atomically. Implementations must ensure
   * a failure mid-write does not leave partial values visible.
   */
  writeCell(cell: CellRef, values: Record<string, string>): Promise<void>;
  /** Remove the cell entirely (or its scaffolded equivalent). */
  deleteCell(cell: CellRef): Promise<void>;
  /** Whether the cell currently has stored data. */
  cellExists(cell: CellRef): Promise<boolean>;
  /**
   * List the keys present in the cell. Sources that can answer this
   * without decrypting (git-sops reads `data.*` keys from the SOPS
   * file) should do so for performance; otherwise a default
   * implementation can decrypt and return `Object.keys`.
   */
  listKeys(cell: CellRef): Promise<string[]>;
  /** Read source-reported metadata without loading values. */
  getCellMetadata(cell: CellRef): Promise<SopsMetadata>;
  /**
   * Create a new (or empty) cell consistent with the manifest's
   * declared recipients/backend for this environment. Idempotent.
   */
  scaffoldCell(cell: CellRef, manifest: ClefManifest): Promise<void>;

  /** Pending + rotation metadata. */
  getPendingMetadata(cell: CellRef): Promise<CellPendingMetadata>;
  markPending(cell: CellRef, keys: string[], setBy: string): Promise<void>;
  markResolved(cell: CellRef, keys: string[]): Promise<void>;
  recordRotation(cell: CellRef, keys: string[], rotatedBy: string): Promise<void>;
  removeRotation(cell: CellRef, keys: string[]): Promise<void>;
}

// ── Optional capability traits ──────────────────────────────────────────────

/**
 * Source-specific lint checks. Portable matrix-completeness lint runs
 * over every source via the core interface and is *not* part of this
 * trait — only checks that depend on the substrate (e.g. SOPS envelope
 * integrity, recipient drift) live here.
 */
export interface Lintable {
  /** Whether the cell has valid encryption envelope metadata. */
  validateEncryption(cell: CellRef): Promise<boolean>;
  /** Compare the cell's actual recipients against the expected set. */
  checkRecipientDrift(cell: CellRef, expected: string[]): Promise<RecipientDriftResult>;
}

/** Result of `Lintable.checkRecipientDrift`. */
export interface RecipientDriftResult {
  /** Recipients expected by the manifest but absent from the cell. */
  missing: string[];
  /** Recipients present on the cell but not in the manifest. */
  unexpected: string[];
}

/**
 * Re-key a cell: rotate the data encryption key and/or update the
 * recipient set without exposing plaintext to the calling process. The
 * `RotateOptions` shape mirrors the substrate-level `EncryptionBackend`
 * — at the SOPS layer that means add/remove for any of age, AWS KMS,
 * GCP KMS, Azure KV, PGP. Backends interpret only the keys they
 * understand.
 */
export interface Rotatable {
  rotate(cell: CellRef, opts: RotateOptions): Promise<void>;
}

/**
 * Manifest-level recipient management. `add` and `remove` mutate both
 * the manifest declaration and re-encrypt every affected cell — the
 * trait bundles these because list/add/remove are useless apart.
 */
export interface RecipientManaged {
  listRecipients(manifest: ClefManifest, environment?: string): Promise<Recipient[]>;
  addRecipient(req: AddRecipientRequest): Promise<RecipientsResult>;
  removeRecipient(req: RemoveRecipientRequest): Promise<RecipientsResult>;
}

export interface AddRecipientRequest {
  key: string;
  label?: string;
  environment?: string;
  manifest: ClefManifest;
}

export interface RemoveRecipientRequest {
  key: string;
  environment?: string;
  manifest: ClefManifest;
}

/** Three-way merge + git driver/hook installation. */
export interface MergeAware {
  mergeCells(base: CellRef, ours: CellRef, theirs: CellRef): Promise<MergeResult>;
  installMergeDriver(repoRoot: string): Promise<void>;
  uninstallMergeDriver(repoRoot: string): Promise<void>;
  installHooks(repoRoot: string): Promise<void>;
  uninstallHooks(repoRoot: string): Promise<void>;
}

/** Re-encrypt every cell to a new SOPS backend (e.g. age → awskms). */
export interface Migratable {
  migrateBackend(target: MigrationTarget, opts: MigrationOptions): Promise<MigrationResult>;
}

/**
 * Batch operations across the matrix. Sources that can do these in a
 * single round-trip (e.g. one SQL transaction) should implement the
 * trait directly; otherwise consumers wrap a `SecretSource` in
 * `defaultBulk` for a correct-but-slow looped fallback.
 */
export interface Bulk {
  bulkSet(
    namespace: string,
    key: string,
    valuesByEnv: Record<string, string>,
    manifest: ClefManifest,
  ): Promise<void>;
  bulkDelete(namespace: string, key: string, manifest: ClefManifest): Promise<void>;
  copyValue(key: string, from: CellRef, to: CellRef, manifest: ClefManifest): Promise<void>;
}

/**
 * Namespace + environment CRUD. On a file-based source this cascades
 * to file/folder renames; on a DB source it's a metadata table update.
 */
export interface Structural {
  addNamespace(name: string, opts: AddNamespaceOptions, manifest: ClefManifest): Promise<void>;
  removeNamespace(name: string, manifest: ClefManifest): Promise<void>;
  renameNamespace(from: string, to: string, manifest: ClefManifest): Promise<void>;
  addEnvironment(name: string, opts: AddEnvironmentOptions, manifest: ClefManifest): Promise<void>;
  removeEnvironment(name: string, manifest: ClefManifest): Promise<void>;
  renameEnvironment(from: string, to: string, manifest: ClefManifest): Promise<void>;
}

export type { AddNamespaceOptions, AddEnvironmentOptions };

// The plugin-author surface (`BlobStore`) and the composition factory
// that wraps a `BlobStore + SopsClient + manifest` into a full
// `SecretSource` are introduced in Phase 2. Plugin authors will not
// implement `SecretSource` directly — they implement `BlobStore` and
// let clef provide the encryption layer.
