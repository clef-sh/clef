export const CLEF_SUPPORTED_EXTENSIONS = [".enc.yaml", ".enc.json"] as const;

// ── Subprocess Runner (dependency injection for sops & git) ──────────────────

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SubprocessRunner {
  run(command: string, args: string[], options?: SubprocessOptions): Promise<SubprocessResult>;
}

export interface SubprocessOptions {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
}

// ── Manifest ────────────────────────────────────────────────────────────────

export interface ClefManifest {
  version: number;
  environments: ClefEnvironment[];
  namespaces: ClefNamespace[];
  sops: SopsConfig;
  file_pattern: string;
}

export interface ClefEnvironment {
  name: string;
  description: string;
  protected?: boolean;
}

export interface ClefNamespace {
  name: string;
  description: string;
  schema?: string;
  owners?: string[];
}

export interface SopsConfig {
  default_backend: "age" | "awskms" | "gcpkms" | "pgp";
  aws_kms_arn?: string;
  gcp_kms_resource_id?: string;
  pgp_fingerprint?: string;
}

export interface ClefLocalConfig {
  age_key_file?: string;
}

// ── Matrix ──────────────────────────────────────────────────────────────────

export interface MatrixCell {
  namespace: string;
  environment: string;
  filePath: string;
  exists: boolean;
}

export interface MatrixIssue {
  type: "missing_keys" | "schema_warning" | "sops_error";
  message: string;
  key?: string;
}

export interface MatrixStatus {
  cell: MatrixCell;
  keyCount: number;
  pendingCount: number;
  lastModified: Date | null;
  issues: MatrixIssue[];
}

// ── Schema ──────────────────────────────────────────────────────────────────

export interface NamespaceSchema {
  keys: Record<string, SchemaKey>;
}

export interface SchemaKey {
  type: "string" | "integer" | "boolean";
  required: boolean;
  pattern?: string;
  default?: unknown;
  description?: string;
  max?: number;
}

export interface ValidationError {
  key: string;
  message: string;
  rule: "required" | "type" | "pattern";
}

export interface ValidationWarning {
  key: string;
  message: string;
  rule: "undeclared" | "max_exceeded";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ── Diff ────────────────────────────────────────────────────────────────────

export type DiffStatus = "changed" | "identical" | "missing_a" | "missing_b";

export interface DiffRow {
  key: string;
  valueA: string | null;
  valueB: string | null;
  status: DiffStatus;
}

export interface DiffResult {
  namespace: string;
  envA: string;
  envB: string;
  rows: DiffRow[];
}

// ── Lint ─────────────────────────────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info";
export type LintCategory = "matrix" | "schema" | "sops";

export interface LintIssue {
  severity: LintSeverity;
  category: LintCategory;
  file: string;
  key?: string;
  message: string;
  fixCommand?: string;
}

export interface LintResult {
  issues: LintIssue[];
  fileCount: number;
  pendingCount: number;
}

// ── Git ─────────────────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

// ── SOPS ────────────────────────────────────────────────────────────────────

export interface DecryptedFile {
  values: Record<string, string>;
  metadata: SopsMetadata;
}

export interface SopsMetadata {
  backend: "age" | "awskms" | "gcpkms" | "pgp";
  recipients: string[];
  lastModified: Date;
}

// ── Consumption ─────────────────────────────────────────────────────────────

export interface ExecOptions {
  only?: string[];
  prefix?: string;
  noOverride?: boolean;
}

export interface ExportOptions {
  format: "env";
  noExport?: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class ClefError extends Error {
  constructor(
    message: string,
    public readonly fix?: string,
  ) {
    super(message);
    this.name = "ClefError";
  }
}

export class ManifestValidationError extends ClefError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message, field ? `Check the '${field}' field in clef.yaml` : undefined);
    this.name = "ManifestValidationError";
  }
}

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

export class SopsKeyNotFoundError extends ClefError {
  constructor(message: string) {
    super(message, "Ensure your age key file exists and SOPS_AGE_KEY_FILE is set correctly");
    this.name = "SopsKeyNotFoundError";
  }
}

export class GitOperationError extends ClefError {
  constructor(message: string, fix?: string) {
    super(message, fix ?? "Ensure you are inside a git repository");
    this.name = "GitOperationError";
  }
}

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

export class SopsMissingError extends ClefError {
  constructor(public readonly installHint: string) {
    super(
      "sops is not installed.",
      `Install it with: ${installHint}\nThen run clef doctor to verify your setup.`,
    );
    this.name = "SopsMissingError";
  }
}

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

export interface DependencyVersion {
  installed: string;
  required: string;
  satisfied: boolean;
  installHint: string;
}

export interface DependencyStatus {
  sops: DependencyVersion | null;
  git: DependencyVersion | null;
}
