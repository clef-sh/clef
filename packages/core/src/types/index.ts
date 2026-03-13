/** Supported file extensions for encrypted SOPS files managed by Clef. */
export const CLEF_SUPPORTED_EXTENSIONS = [".enc.yaml", ".enc.json"] as const;

// ── Subprocess Runner (dependency injection for sops & git) ──────────────────

/** Result returned by a subprocess invocation. */
export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Abstraction over subprocess execution used throughout the core library.
 * Inject a real implementation (`NodeSubprocessRunner`) in production and a
 * mock via `jest.fn()` in unit tests — no real subprocess calls in tests.
 */
export interface SubprocessRunner {
  run(command: string, args: string[], options?: SubprocessOptions): Promise<SubprocessResult>;
}

/** Options forwarded to the subprocess. */
export interface SubprocessOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Data to pipe to stdin. */
  stdin?: string;
  /** Additional environment variables for the child process. */
  env?: Record<string, string>;
}

// ── Manifest ────────────────────────────────────────────────────────────────

/** Parsed and validated contents of a `clef.yaml` manifest file. */
export interface ClefManifest {
  version: number;
  environments: ClefEnvironment[];
  namespaces: ClefNamespace[];
  sops: SopsConfig;
  file_pattern: string;
}

/** Per-environment SOPS backend override. */
export interface EnvironmentSopsOverride {
  backend: "age" | "awskms" | "gcpkms" | "pgp";
  aws_kms_arn?: string;
  gcp_kms_resource_id?: string;
  pgp_fingerprint?: string;
}

/** A single deployment environment declared in the manifest. */
export interface ClefEnvironment {
  name: string;
  description: string;
  /** When `true`, write operations require explicit confirmation. */
  protected?: boolean;
  /** Per-environment SOPS backend override. Falls back to global `sops` config when absent. */
  sops?: EnvironmentSopsOverride;
  /** Per-environment age recipient overrides. When set, these recipients are used instead of global. */
  recipients?: (string | { key: string; label?: string })[];
}

/**
 * Resolve the effective backend configuration for an environment.
 * Returns the per-env override if present, otherwise falls back to the global `sops` config.
 */
export function resolveBackendConfig(
  manifest: ClefManifest,
  environment: string,
): EnvironmentSopsOverride {
  const env = manifest.environments.find((e) => e.name === environment);
  if (env?.sops) return env.sops;
  return {
    backend: manifest.sops.default_backend,
    aws_kms_arn: manifest.sops.aws_kms_arn,
    gcp_kms_resource_id: manifest.sops.gcp_kms_resource_id,
    pgp_fingerprint: manifest.sops.pgp_fingerprint,
  };
}

/**
 * Resolve per-environment recipients if defined.
 * Returns the environment's `recipients` array if non-empty, otherwise `undefined`
 * (caller should fall back to global recipients).
 */
export function resolveRecipientsForEnvironment(
  manifest: ClefManifest,
  environment: string,
): (string | { key: string; label?: string })[] | undefined {
  const env = manifest.environments.find((e) => e.name === environment);
  if (env?.recipients && env.recipients.length > 0) return env.recipients;
  return undefined;
}

/** A secrets namespace declared in the manifest. */
export interface ClefNamespace {
  name: string;
  description: string;
  /** Optional path to a YAML schema file for this namespace. */
  schema?: string;
  /** Optional list of owner identifiers for this namespace. */
  owners?: string[];
}

/** SOPS encryption backend configuration from the manifest. */
export interface SopsConfig {
  default_backend: "age" | "awskms" | "gcpkms" | "pgp";
  aws_kms_arn?: string;
  gcp_kms_resource_id?: string;
  pgp_fingerprint?: string;
}

/**
 * Per-developer local config stored in `.clef/config.yaml` (gitignored).
 * Holds settings that must not be committed, such as the age private key path.
 */
export interface ClefLocalConfig {
  /** Path to the age private key file for this developer. */
  age_key_file?: string;
}

// ── Matrix ──────────────────────────────────────────────────────────────────

/** A single cell in the namespace × environment matrix. */
export interface MatrixCell {
  namespace: string;
  environment: string;
  /** Absolute path to the encrypted SOPS file for this cell. */
  filePath: string;
  /** Whether the encrypted file exists on disk. */
  exists: boolean;
}

/** An issue detected within a single matrix cell. */
export interface MatrixIssue {
  type: "missing_keys" | "schema_warning" | "sops_error";
  message: string;
  /** The affected key name, if applicable. */
  key?: string;
}

/** Decrypted status summary for one matrix cell. */
export interface MatrixStatus {
  cell: MatrixCell;
  /** Number of keys in the decrypted file. */
  keyCount: number;
  /** Number of keys currently marked as pending placeholders. */
  pendingCount: number;
  /** Timestamp from SOPS metadata, or `null` if unavailable. */
  lastModified: Date | null;
  issues: MatrixIssue[];
}

// ── Schema ──────────────────────────────────────────────────────────────────

/** A namespace schema loaded from a YAML schema file. */
export interface NamespaceSchema {
  keys: Record<string, SchemaKey>;
}

/** Definition for a single key in a namespace schema. */
export interface SchemaKey {
  type: "string" | "integer" | "boolean";
  required: boolean;
  /** Regex pattern the value must match (strings only). */
  pattern?: string;
  default?: unknown;
  description?: string;
  /** Maximum numeric value (integers only). */
  max?: number;
}

/** A hard validation error produced by `SchemaValidator.validate`. */
export interface ValidationError {
  key: string;
  message: string;
  rule: "required" | "type" | "pattern";
}

/** A soft validation warning produced by `SchemaValidator.validate`. */
export interface ValidationWarning {
  key: string;
  message: string;
  rule: "undeclared" | "max_exceeded";
}

/** Result of validating a set of decrypted values against a namespace schema. */
export interface ValidationResult {
  /** `true` when there are no errors (warnings are allowed). */
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ── Diff ────────────────────────────────────────────────────────────────────

/** Status of a single key when diffing two environments. */
export type DiffStatus = "changed" | "identical" | "missing_a" | "missing_b";

/** One row in a diff result representing a single key comparison. */
export interface DiffRow {
  key: string;
  /** Value from environment A, or `null` if the key is absent. */
  valueA: string | null;
  /** Value from environment B, or `null` if the key is absent. */
  valueB: string | null;
  status: DiffStatus;
}

/** The full diff result for a namespace across two environments. */
export interface DiffResult {
  namespace: string;
  envA: string;
  envB: string;
  rows: DiffRow[];
}

// ── Lint ─────────────────────────────────────────────────────────────────────

/** Severity level of a lint issue. */
export type LintSeverity = "error" | "warning" | "info";

/** Category of a lint issue. */
export type LintCategory = "matrix" | "schema" | "sops";

/** A single issue reported by `LintRunner`. */
export interface LintIssue {
  severity: LintSeverity;
  category: LintCategory;
  /** Path to the affected encrypted file. */
  file: string;
  /** The affected key name, if applicable. */
  key?: string;
  message: string;
  /** CLI command that can auto-fix this issue, if one exists. */
  fixCommand?: string;
}

/** Aggregate result from a full lint run. */
export interface LintResult {
  issues: LintIssue[];
  /** Total number of matrix files checked (including missing ones). */
  fileCount: number;
  /** Total number of keys marked as pending placeholders across all files. */
  pendingCount: number;
}

// ── Git ─────────────────────────────────────────────────────────────────────

/** A single git commit. */
export interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
}

/** Parsed output of `git status --porcelain`. */
export interface GitStatus {
  /** Files with staged (index) changes. */
  staged: string[];
  /** Files with unstaged (work-tree) changes. */
  unstaged: string[];
  untracked: string[];
}

// ── SOPS ────────────────────────────────────────────────────────────────────

/** The in-memory result of decrypting a SOPS-encrypted file. Plaintext never touches disk. */
export interface DecryptedFile {
  /** Flat key/value map of all decrypted secrets. */
  values: Record<string, string>;
  metadata: SopsMetadata;
}

/** SOPS metadata extracted from an encrypted file without decrypting its values. */
export interface SopsMetadata {
  backend: "age" | "awskms" | "gcpkms" | "pgp";
  /** List of recipient identifiers (age public keys, KMS ARNs, PGP fingerprints). */
  recipients: string[];
  lastModified: Date;
}

/**
 * Backend-agnostic interface for all encryption/decryption operations.
 *
 * `SopsClient` is the canonical implementation. Consumers should depend on this
 * interface rather than the concrete class so the encryption backend can be
 * replaced without touching call sites.
 */
export interface EncryptionBackend {
  /** Decrypt a file and return its values and metadata. */
  decrypt(filePath: string): Promise<DecryptedFile>;
  /** Encrypt a key/value map and write it to a file. */
  encrypt(
    filePath: string,
    values: Record<string, string>,
    manifest: ClefManifest,
    environment?: string,
  ): Promise<void>;
  /** Rotate encryption by adding a new recipient key. */
  reEncrypt(filePath: string, newKey: string): Promise<void>;
  /** Add an age recipient to an encrypted file (rotate + add-age). */
  addRecipient(filePath: string, key: string): Promise<void>;
  /** Remove an age recipient from an encrypted file (rotate + rm-age). */
  removeRecipient(filePath: string, key: string): Promise<void>;
  /** Check whether a file has valid encryption metadata. */
  validateEncryption(filePath: string): Promise<boolean>;
  /** Extract encryption metadata without decrypting. */
  getMetadata(filePath: string): Promise<SopsMetadata>;
}

// ── Consumption ─────────────────────────────────────────────────────────────

/** Options for `ConsumptionClient.prepareEnvironment`. */
export interface ExecOptions {
  /** Inject only these keys (if set, all other keys are excluded). */
  only?: string[];
  /** Prepend this string to every injected environment variable name. */
  prefix?: string;
  /** When `true`, skip keys that already exist in the base environment. */
  noOverride?: boolean;
}

/** Options for `ConsumptionClient.formatExport`. */
export interface ExportOptions {
  format: "env";
  /** When `true`, omit the `export` keyword from each line. */
  noExport?: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * Base error class for all Clef errors.
 * Carries an optional `fix` hint string describing how to resolve the issue.
 */
export class ClefError extends Error {
  constructor(
    message: string,
    public readonly fix?: string,
  ) {
    super(message);
    this.name = "ClefError";
  }
}

/** Thrown when `clef.yaml` fails parsing or schema validation. */
export class ManifestValidationError extends ClefError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message, field ? `Check the '${field}' field in clef.yaml` : undefined);
    this.name = "ManifestValidationError";
  }
}

/** Thrown when SOPS decryption fails (bad key, corrupt file, etc.). */
export class SopsDecryptionError extends ClefError {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(
      message,
      filePath
        ? `Ensure you have the correct key configured to decrypt '${filePath}'`
        : "Ensure your SOPS key is configured correctly",
    );
    this.name = "SopsDecryptionError";
  }
}

/** Thrown when SOPS encryption or re-encryption fails. */
export class SopsEncryptionError extends ClefError {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(
      message,
      filePath
        ? `Check your SOPS configuration and key access for '${filePath}'`
        : "Check your SOPS configuration",
    );
    this.name = "SopsEncryptionError";
  }
}

/** Thrown when no decryption key is found in the environment. */
export class SopsKeyNotFoundError extends ClefError {
  constructor(message: string) {
    super(message, "Ensure your age key file exists and SOPS_AGE_KEY_FILE is set correctly");
    this.name = "SopsKeyNotFoundError";
  }
}

/** Thrown when a git subprocess fails. */
export class GitOperationError extends ClefError {
  constructor(message: string, fix?: string) {
    super(message, fix ?? "Ensure you are inside a git repository");
    this.name = "GitOperationError";
  }
}

/** Thrown when a namespace schema file cannot be read or parsed. */
export class SchemaLoadError extends ClefError {
  constructor(
    message: string,
    public readonly filePath?: string,
  ) {
    super(
      message,
      filePath ? `Check the schema file at '${filePath}'` : "Check your schema file syntax",
    );
    this.name = "SchemaLoadError";
  }
}

// ── Dependency errors ────────────────────────────────────────────────────────

/** Thrown when the `sops` binary is not installed. */
export class SopsMissingError extends ClefError {
  constructor(public readonly installHint: string) {
    super(
      "sops is not installed.",
      `Install it with: ${installHint}\nThen run clef doctor to verify your setup.`,
    );
    this.name = "SopsMissingError";
  }
}

/** Thrown when the installed `sops` version is older than the minimum required. */
export class SopsVersionError extends ClefError {
  constructor(
    public readonly installed: string,
    public readonly required: string,
    public readonly installHint: string,
  ) {
    super(
      `sops v${installed} is installed but Clef requires v${required} or later.`,
      `Upgrade with: ${installHint}\nThen run clef doctor to verify your setup.`,
    );
    this.name = "SopsVersionError";
  }
}

// ── Dependency check types ───────────────────────────────────────────────────

/** Version check result for a single external dependency. */
export interface DependencyVersion {
  /** Installed version string, e.g. `"3.9.1"`. */
  installed: string;
  /** Minimum required version string. */
  required: string;
  /** `true` when `installed >= required`. */
  satisfied: boolean;
  /** Platform-appropriate install/upgrade command hint. */
  installHint: string;
}

/** Combined dependency check result for all required external tools. */
export interface DependencyStatus {
  /** `null` if `sops` is not installed or version could not be parsed. */
  sops: DependencyVersion | null;
  /** `null` if `git` is not installed or version could not be parsed. */
  git: DependencyVersion | null;
}
