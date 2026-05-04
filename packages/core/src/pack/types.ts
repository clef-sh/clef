import type { ClefManifest, FileEncryptionBackend, SubprocessRunner } from "../types";
import type { KmsProvider } from "../kms";
import type { PackResult } from "../artifact/types";
import type { SecretSource } from "../source/types";

/**
 * Shared services a PackBackend may use. A backend is free to ignore any
 * field it does not need.
 */
export interface PackServices {
  /**
   * Plaintext-cell access to the matrix. Backends call `source.readCell`
   * (typically via the shared `resolveIdentitySecrets` helper) to fetch
   * decrypted values for an identity's scoped namespaces × environment.
   * Encryption substrate is opaque to the backend.
   */
  source: SecretSource;
  /**
   * @deprecated Legacy file-encryption surface kept alive while published
   * plugin packages (e.g. `@clef-sh/pack-aws-parameter-store@0.1.x`) still
   * reference it. Bundled CLI + UI no longer populate this field after
   * Phase 5k; new plugins should consume `source` instead. Phase 7
   * cleanup deletes this once published plugins catch up.
   */
  encryption?: FileEncryptionBackend;
  /** KMS provider, already constructed. Undefined when the manifest does not require one. */
  kms?: KmsProvider;
  /** For subprocess access (git, external CLIs). Prefer this over child_process. */
  runner: SubprocessRunner;
}

/**
 * Input to `PackBackend.pack`. Fields are the intersection of what all
 * conceivable backends need; anything backend-specific lives in
 * `backendOptions` and is typed and validated by the backend itself.
 *
 * Implementations must not read `process.env`, log decrypted values, or
 * call `process.exit` — a `PackRequest` may be constructed by any caller
 * (CLI, IaC synth-time hook, test), not just the `clef pack` command.
 */
export interface PackRequest {
  /** Service identity name from the manifest. */
  identity: string;
  /** Target environment name. */
  environment: string;
  /** Parsed manifest. */
  manifest: ClefManifest;
  /** Absolute path to the clef repo root. */
  repoRoot: string;
  /** Shared services the backend may use. */
  services: PackServices;
  /** Optional TTL in seconds. Backends that do not support it should ignore. */
  ttl?: number;
  /** Backend-specific options; shape is the backend's private concern. */
  backendOptions: Record<string, unknown>;
}

/**
 * Result of a `PackBackend.pack` call. Extends the existing `PackResult`
 * with the backend identifier and a freeform details map for per-backend
 * diagnostics.
 */
export interface BackendPackResult extends PackResult {
  /** Identifier of the backend that produced this result (e.g. `"clef-native"`). */
  backend: string;
  /**
   * Freeform per-backend diagnostic detail (e.g. secret ARN, bucket key,
   * commit SHA). Values must be JSON-serializable.
   */
  details?: Record<string, string | number | boolean | null>;
}

/**
 * Contract for a pack destination. A backend turns a (identity, environment)
 * pair into whatever its target system requires — a local JSON file for
 * `clef-native`, a Vault KV write for a future vault backend, and so on.
 */
export interface PackBackend {
  /** Stable backend identifier (e.g. `"clef-native"`, `"aws-secrets"`, `"vault"`). */
  readonly id: string;
  /** Short human description, used by `clef pack --help` and diagnostics. */
  readonly description: string;
  /**
   * Validate and normalize backend-specific options. Throw with a precise
   * error message on invalid input. Called before `pack`.
   */
  validateOptions?(raw: Record<string, unknown>): void;
  /**
   * Perform the pack. Must not log plaintext secrets, must not write
   * plaintext to disk, and must not depend on process-global state.
   */
  pack(req: PackRequest): Promise<BackendPackResult>;
}

/** Factory signature used by `PackBackendRegistry.register`. */
export type PackBackendFactory = () => PackBackend | Promise<PackBackend>;
