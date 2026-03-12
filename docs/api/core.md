# @clef-sh/core API Reference

`@clef-sh/core` is the core library for Clef. It provides manifest parsing, matrix management,
SOPS encryption/decryption, schema validation, diffing, linting, and more. All classes use
dependency injection via the `SubprocessRunner` interface for testability.

## Installation

```bash
npm install @clef-sh/core
```

## Classes

### ManifestParser

Parses and validates `clef.yaml` manifest files.

```ts
class ManifestParser {
  parse(filePath: string): ClefManifest;
  validate(input: unknown): ClefManifest;
  watch(filePath: string, onChange: (manifest: ClefManifest) => void): () => void;
}
```

| Method     | Description                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `parse`    | Read and validate a `clef.yaml` file from disk.                                                               |
| `validate` | Validate an already-parsed object against the manifest schema.                                                |
| `watch`    | Watch a manifest file for changes and invoke a callback on each valid parse. Returns an unsubscribe function. |

---

### ScanRunner

Scans repository files for plaintext secrets using pattern matching and entropy detection.

```ts
class ScanRunner {
  constructor(runner: SubprocessRunner);
  scan(repoRoot: string, manifest: ClefManifest, options?: ScanOptions): Promise<ScanResult>;
}
```

| Method | Description                                                             |
| ------ | ----------------------------------------------------------------------- |
| `scan` | Scan tracked files for secret-like values and unencrypted matrix files. |

---

### MatrixManager

Resolves and manages the namespace x environment matrix of encrypted files.

```ts
class MatrixManager {
  resolveMatrix(manifest: ClefManifest, repoRoot: string): MatrixCell[];
  detectMissingCells(manifest: ClefManifest, repoRoot: string): MatrixCell[];
  scaffoldCell(cell: MatrixCell, sopsClient: SopsClient): Promise<void>;
  getMatrixStatus(
    manifest: ClefManifest,
    repoRoot: string,
    sopsClient: SopsClient,
  ): Promise<MatrixStatus[]>;
  isProtectedEnvironment(manifest: ClefManifest, environment: string): boolean;
}
```

| Method                   | Description                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `resolveMatrix`          | Build the full grid of matrix cells from the manifest.               |
| `detectMissingCells`     | Return only cells whose encrypted files do not exist on disk.        |
| `scaffoldCell`           | Create an empty encrypted SOPS file for a missing cell.              |
| `getMatrixStatus`        | Decrypt each cell and return key counts, pending counts, and issues. |
| `isProtectedEnvironment` | Check whether an environment has the `protected` flag set.           |

---

### SchemaValidator

Loads namespace schemas and validates decrypted key/value maps against them.

```ts
class SchemaValidator {
  loadSchema(filePath: string): NamespaceSchema;
  validate(values: Record<string, string>, schema: NamespaceSchema): ValidationResult;
}
```

| Method       | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `loadSchema` | Read and parse a YAML schema file from disk.                |
| `validate`   | Validate a set of decrypted values against a loaded schema. |

---

### DiffEngine

Compares decrypted values between two environments or two arbitrary key/value maps.

```ts
class DiffEngine {
  diff(
    valuesA: Record<string, string>,
    valuesB: Record<string, string>,
    envA: string,
    envB: string,
    namespace?: string,
  ): DiffResult;
  diffFiles(
    namespace: string,
    envA: string,
    envB: string,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<DiffResult>;
}
```

| Method      | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `diff`      | Compare two in-memory value maps and produce a sorted diff result. |
| `diffFiles` | Decrypt two matrix cells and diff their values.                    |

---

### BulkOps

Performs bulk set, delete, and copy operations across multiple environments.

```ts
class BulkOps {
  setAcrossEnvironments(
    namespace: string,
    key: string,
    values: Record<string, string>,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<void>;
  deleteAcrossEnvironments(
    namespace: string,
    key: string,
    manifest: ClefManifest,
    sopsClient: SopsClient,
    repoRoot: string,
  ): Promise<void>;
  copyValue(
    key: string,
    fromCell: MatrixCell,
    toCell: MatrixCell,
    sopsClient: SopsClient,
    manifest: ClefManifest,
  ): Promise<void>;
}
```

| Method                     | Description                                                     |
| -------------------------- | --------------------------------------------------------------- |
| `setAcrossEnvironments`    | Set a key to different values in multiple environments at once. |
| `deleteAcrossEnvironments` | Delete a key from every environment in a namespace.             |
| `copyValue`                | Copy a single key's value from one matrix cell to another.      |

---

### GitIntegration

Wraps git operations (stage, commit, log, diff, status, hook installation).

```ts
class GitIntegration {
  constructor(runner: SubprocessRunner);
  stageFiles(filePaths: string[], repoRoot: string): Promise<void>;
  commit(message: string, repoRoot: string): Promise<string>;
  getLog(filePath: string, repoRoot: string, limit?: number): Promise<GitCommit[]>;
  getDiff(repoRoot: string): Promise<string>;
  getStatus(repoRoot: string): Promise<GitStatus>;
  installPreCommitHook(repoRoot: string): Promise<void>;
}
```

| Method                 | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `stageFiles`           | Stage one or more file paths with `git add`.                               |
| `commit`               | Create a commit with the given message. Returns the commit hash.           |
| `getLog`               | Retrieve recent commits for a specific file (default limit: 20).           |
| `getDiff`              | Get the staged diff (`git diff --cached`).                                 |
| `getStatus`            | Parse `git status --porcelain` into staged, unstaged, and untracked lists. |
| `installPreCommitHook` | Write and chmod the Clef pre-commit hook into `.git/hooks/`.               |

---

### SopsClient

Wraps the `sops` binary for encryption, decryption, re-encryption, and metadata extraction.

```ts
class SopsClient {
  constructor(runner: SubprocessRunner, ageKeyFile?: string);
  decrypt(filePath: string): Promise<DecryptedFile>;
  encrypt(filePath: string, values: Record<string, string>, manifest: ClefManifest): Promise<void>;
  reEncrypt(filePath: string, newKey: string): Promise<void>;
  validateEncryption(filePath: string): Promise<boolean>;
  getMetadata(filePath: string): Promise<SopsMetadata>;
}
```

The optional `ageKeyFile` parameter sets `SOPS_AGE_KEY_FILE` in the environment passed to every `sops` subprocess call, but only when no age key environment variable is already set in the process environment.

| Method               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `decrypt`            | Decrypt a SOPS file and return its values and metadata.                            |
| `encrypt`            | Encrypt a key/value map and write it to an encrypted file.                         |
| `reEncrypt`          | Rotate encryption by adding a new age recipient key.                               |
| `validateEncryption` | Check whether a file contains valid SOPS metadata.                                 |
| `getMetadata`        | Extract SOPS metadata (backend, recipients, last modified) from an encrypted file. |

---

### LintRunner

Runs matrix completeness, schema validation, SOPS integrity, and key-drift checks.

```ts
class LintRunner {
  constructor(
    matrixManager: MatrixManager,
    schemaValidator: SchemaValidator,
    sopsClient: SopsClient,
  );
  run(manifest: ClefManifest, repoRoot: string): Promise<LintResult>;
  fix(manifest: ClefManifest, repoRoot: string): Promise<LintResult>;
}
```

| Method | Description                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| `run`  | Lint the entire matrix: check missing files, schema errors, SOPS integrity, and cross-environment key drift. |
| `fix`  | Auto-fix safe issues (scaffold missing files), then re-run lint.                                             |

---

### ConsumptionClient

Prepares decrypted secrets for consumption via environment injection or shell export.

```ts
class ConsumptionClient {
  prepareEnvironment(
    decryptedFile: DecryptedFile,
    baseEnv: Record<string, string | undefined>,
    options?: ExecOptions,
  ): Record<string, string>;
  formatExport(
    decryptedFile: DecryptedFile,
    format: ExportOptions["format"],
    noExport: boolean,
  ): string;
}
```

| Method               | Description                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `prepareEnvironment` | Merge decrypted values into a base environment, respecting `--only`, `--prefix`, and `--no-override`. |
| `formatExport`       | Format decrypted values as shell export statements for stdout.                                        |

---

### ImportRunner

Imports secrets from `.env`, JSON, or YAML files into encrypted matrix cells.

```ts
class ImportRunner {
  constructor(sopsClient: SopsClient);
  import(
    target: string,
    sourcePath: string | null,
    content: string,
    manifest: ClefManifest,
    repoRoot: string,
    options: ImportOptions,
  ): Promise<ImportResult>;
}
```

| Method   | Description                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------- |
| `import` | Parse a source file and import its key/value pairs into a target `namespace/environment` cell. |

---

### RecipientManager

Manages age recipient keys in the manifest and re-encrypts matrix files on add/remove.

```ts
class RecipientManager {
  constructor(runner: SubprocessRunner, matrixManager: MatrixManager);
  list(manifest: ClefManifest, repoRoot: string): Promise<Recipient[]>;
  add(
    key: string,
    label: string | undefined,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<RecipientsResult>;
  remove(key: string, manifest: ClefManifest, repoRoot: string): Promise<RecipientsResult>;
}
```

| Method   | Description                                                                     |
| -------- | ------------------------------------------------------------------------------- |
| `list`   | List all age recipients from the manifest.                                      |
| `add`    | Add a new age recipient and re-encrypt all matrix files. Rolls back on failure. |
| `remove` | Remove an age recipient and re-encrypt all matrix files. Rolls back on failure. |

## Functions

### Scanner utilities

```ts
function shannonEntropy(str: string): number;
```

Calculate Shannon entropy (bits per character) of a string.

```ts
function isHighEntropy(value: string, threshold?: number, minLength?: number): boolean;
```

Return `true` if a string exceeds the entropy threshold (default 4.5 bits/char, minimum 20 chars).

```ts
function matchPatterns(line: string, lineNumber: number, filePath: string): ScanMatch[];
```

Match a line against all known secret patterns. Returns one `ScanMatch` per hit.

```ts
function redactValue(value: string): string;
```

Redact a matched value -- show at most the first 4 characters, mask the rest.

```ts
function loadIgnoreRules(repoRoot: string): ClefIgnoreRules;
```

Load `.clefignore` rules from the repo root. Returns empty rules if the file does not exist.

```ts
function shouldIgnoreFile(filePath: string, rules: ClefIgnoreRules): boolean;
```

Return `true` if a file path should be ignored per `.clefignore` rules.

```ts
function shouldIgnoreMatch(match: ScanMatch, rules: ClefIgnoreRules): boolean;
```

Return `true` if a scan match should be suppressed per `.clefignore` pattern rules.

```ts
function parseIgnoreContent(content: string): ClefIgnoreRules;
```

Parse raw `.clefignore` content into structured rules.

### Dependency checking

```ts
function checkDependency(
  name: "sops" | "git",
  runner: SubprocessRunner,
): Promise<DependencyVersion | null>;
```

Check a single dependency. Returns `null` if the binary is not found. Never throws.

```ts
function checkAll(runner: SubprocessRunner): Promise<DependencyStatus>;
```

Check both dependencies (`sops`, `git`) in parallel.

```ts
function assertSops(runner: SubprocessRunner): Promise<void>;
```

Assert that `sops` is installed and meets the minimum version. Throws `SopsMissingError` or
`SopsVersionError`.

### Age key generation

```ts
function generateAgeIdentity(): Promise<AgeIdentity>;
```

Generate a new age key pair using the `age-encryption` npm package. Returns the private key
(`AGE-SECRET-KEY-1...` format) and the derived public key (`age1...` bech32 format).

```ts
function formatAgeKeyFile(privateKey: string, publicKey: string): string;
```

Format an age private key and public key into the standard key file format with a timestamp
comment, ready to write to disk.

### Pending metadata

```ts
function metadataPath(encryptedFilePath: string): string;
```

Derive the `.clef-meta.yaml` path from an `.enc.yaml` path.

```ts
function loadMetadata(filePath: string): Promise<PendingMetadata>;
```

Load pending-key metadata for an encrypted file. Returns empty metadata if missing.

```ts
function saveMetadata(filePath: string, metadata: PendingMetadata): Promise<void>;
```

Write pending-key metadata to disk.

```ts
function markPending(filePath: string, keys: string[], setBy: string): Promise<void>;
```

Mark one or more keys as pending (placeholder value) for an encrypted file.

```ts
function markPendingWithRetry(
  filePath: string,
  keys: string[],
  setBy: string,
  retryDelayMs?: number,
): Promise<void>;
```

Same as `markPending` with one automatic retry on transient failure.

```ts
function markResolved(filePath: string, keys: string[]): Promise<void>;
```

Remove keys from the pending list after they receive real values.

```ts
function getPendingKeys(filePath: string): Promise<string[]>;
```

Return the list of keys that are still pending for a file.

```ts
function isPending(filePath: string, key: string): Promise<boolean>;
```

Check whether a single key is pending.

```ts
function generateRandomValue(): string;
```

Generate a cryptographically random 64-character hex string for use as a placeholder.

### Import parsers

```ts
function parse(content: string, format: ImportFormat, filePath?: string): ParsedImport;
```

Parse content in the given format (or auto-detect) and return flat key/value pairs.

```ts
function parseDotenv(content: string): ParsedImport;
```

Parse dotenv-formatted content.

```ts
function parseJson(content: string): ParsedImport;
```

Parse a JSON object into flat key/value pairs. Non-string values are skipped with warnings.

```ts
function parseYaml(content: string): ParsedImport;
```

Parse a YAML mapping into flat key/value pairs. Non-string values are skipped with warnings.

```ts
function detectFormat(filePath: string, content: string): Exclude<ImportFormat, "auto">;
```

Auto-detect the format of a file from its extension, name, and content heuristics.

### Recipient validation

```ts
function validateAgePublicKey(input: string): AgeKeyValidation;
```

Validate that a string is a well-formed age public key (bech32, `age1` prefix).

```ts
function keyPreview(key: string): string;
```

Return a short preview of an age key (`age1...last8chars`).

## Types

### Subprocess

```ts
interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SubprocessRunner {
  run(command: string, args: string[], options?: SubprocessOptions): Promise<SubprocessResult>;
}

interface SubprocessOptions {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
}
```

### Manifest

```ts
interface ClefManifest {
  version: number;
  environments: ClefEnvironment[];
  namespaces: ClefNamespace[];
  sops: SopsConfig;
  file_pattern: string;
}

interface ClefEnvironment {
  name: string;
  description: string;
  protected?: boolean;
}

interface ClefNamespace {
  name: string;
  description: string;
  schema?: string;
  owners?: string[];
}

interface SopsConfig {
  default_backend: "age" | "awskms" | "gcpkms" | "pgp";
  aws_kms_arn?: string;
  gcp_kms_resource_id?: string;
  pgp_fingerprint?: string;
}

interface ClefLocalConfig {
  age_key_file?: string;
}
```

`ClefLocalConfig` is stored in `.clef/config.yaml` and is gitignored. It holds per-developer
settings that should not be committed, such as the path to the age private key file.

### Age

```ts
interface AgeIdentity {
  /** AGE-SECRET-KEY-1... armored private key string */
  privateKey: string;
  /** age1... bech32 public key string */
  publicKey: string;
}
```

### Matrix

```ts
interface MatrixCell {
  namespace: string;
  environment: string;
  filePath: string;
  exists: boolean;
}

interface MatrixIssue {
  type: "missing_keys" | "schema_warning" | "sops_error";
  message: string;
  key?: string;
}

interface MatrixStatus {
  cell: MatrixCell;
  keyCount: number;
  pendingCount: number;
  lastModified: Date | null;
  issues: MatrixIssue[];
}
```

### Schema

```ts
interface NamespaceSchema {
  keys: Record<string, SchemaKey>;
}

interface SchemaKey {
  type: "string" | "integer" | "boolean";
  required: boolean;
  pattern?: string;
  default?: unknown;
  description?: string;
  max?: number;
}

interface ValidationError {
  key: string;
  message: string;
  rule: "required" | "type" | "pattern";
}

interface ValidationWarning {
  key: string;
  message: string;
  rule: "undeclared" | "max_exceeded";
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

### Diff

```ts
type DiffStatus = "changed" | "identical" | "missing_a" | "missing_b";

interface DiffRow {
  key: string;
  valueA: string | null;
  valueB: string | null;
  status: DiffStatus;
}

interface DiffResult {
  namespace: string;
  envA: string;
  envB: string;
  rows: DiffRow[];
}
```

### Lint

```ts
type LintSeverity = "error" | "warning" | "info";
type LintCategory = "matrix" | "schema" | "sops";

interface LintIssue {
  severity: LintSeverity;
  category: LintCategory;
  file: string;
  key?: string;
  message: string;
  fixCommand?: string;
}

interface LintResult {
  issues: LintIssue[];
  fileCount: number;
  pendingCount: number;
}
```

### Git

```ts
interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
}

interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}
```

### SOPS

```ts
interface DecryptedFile {
  values: Record<string, string>;
  metadata: SopsMetadata;
}

interface SopsMetadata {
  backend: "age" | "awskms" | "gcpkms" | "pgp";
  recipients: string[];
  lastModified: Date;
}
```

### Consumption

```ts
interface ExecOptions {
  only?: string[];
  prefix?: string;
  noOverride?: boolean;
}

interface ExportOptions {
  format: "env";
  noExport?: boolean;
}
```

### Scanner

```ts
interface ScanMatch {
  file: string;
  line: number;
  column: number;
  matchType: "pattern" | "entropy";
  patternName?: string;
  entropy?: number;
  preview: string;
}

interface ScanResult {
  matches: ScanMatch[];
  filesScanned: number;
  filesSkipped: number;
  unencryptedMatrixFiles: string[];
  durationMs: number;
}

interface ScanOptions {
  stagedOnly?: boolean;
  paths?: string[];
  severity?: "all" | "high";
}

interface ClefIgnoreRules {
  files: string[];
  patterns: string[];
  paths: string[];
}
```

### Import

```ts
type ImportFormat = "dotenv" | "json" | "yaml" | "auto";

interface ImportOptions {
  format?: ImportFormat;
  prefix?: string;
  keys?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
  stdin?: boolean;
}

interface ImportResult {
  imported: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
  warnings: string[];
  dryRun: boolean;
}

interface ParsedImport {
  pairs: Record<string, string>;
  format: Exclude<ImportFormat, "auto">;
  skipped: string[];
  warnings: string[];
}
```

### Recipients

```ts
interface Recipient {
  key: string;
  preview: string;
  label?: string;
}

interface RecipientsResult {
  added?: Recipient;
  removed?: Recipient;
  recipients: Recipient[];
  reEncryptedFiles: string[];
  failedFiles: string[];
  warnings: string[];
}

interface AgeKeyValidation {
  valid: boolean;
  key?: string;
  error?: string;
}
```

### Dependencies

```ts
interface DependencyVersion {
  installed: string;
  required: string;
  satisfied: boolean;
  installHint: string;
}

interface DependencyStatus {
  sops: DependencyVersion | null;
  git: DependencyVersion | null;
}
```

### Pending metadata

```ts
interface PendingKey {
  key: string;
  since: Date;
  setBy: string;
}

interface PendingMetadata {
  version: 1;
  pending: PendingKey[];
}
```

## Error Classes

All error classes extend `ClefError`, which extends `Error` with an optional `fix` hint string.

### ClefError

Base error class for all Clef errors.

```ts
class ClefError extends Error {
  constructor(message: string, public readonly fix?: string);
}
```

### ManifestValidationError

Thrown when `clef.yaml` fails validation.

```ts
class ManifestValidationError extends ClefError {
  constructor(message: string, public readonly field?: string);
}
```

### SopsDecryptionError

Thrown when SOPS decryption fails.

```ts
class SopsDecryptionError extends ClefError {
  constructor(message: string, public readonly filePath?: string);
}
```

### SopsEncryptionError

Thrown when SOPS encryption fails.

```ts
class SopsEncryptionError extends ClefError {
  constructor(message: string, public readonly filePath?: string);
}
```

### SopsKeyNotFoundError

Thrown when the decryption key is missing.

```ts
class SopsKeyNotFoundError extends ClefError {
  constructor(message: string);
}
```

### GitOperationError

Thrown when a git subprocess fails.

```ts
class GitOperationError extends ClefError {
  constructor(message: string, fix?: string);
}
```

### SchemaLoadError

Thrown when a schema file cannot be read or parsed.

```ts
class SchemaLoadError extends ClefError {
  constructor(message: string, public readonly filePath?: string);
}
```

### SopsMissingError

Thrown when the `sops` binary is not installed.

```ts
class SopsMissingError extends ClefError {
  constructor(public readonly installHint: string);
}
```

### SopsVersionError

Thrown when the installed `sops` version is too old.

```ts
class SopsVersionError extends ClefError {
  constructor(
    public readonly installed: string,
    public readonly required: string,
    public readonly installHint: string,
  );
}
```

## Constants

### CLEF_MANIFEST_FILENAME

```ts
const CLEF_MANIFEST_FILENAME = "clef.yaml";
```

The canonical filename for the Clef manifest. All code that references this filename imports this
constant.

### REQUIREMENTS

```ts
const REQUIREMENTS = {
  sops: "3.8.0",
  git: "2.28.0",
} as const;
```

Minimum required versions for each external dependency.

### CLEF_SUPPORTED_EXTENSIONS

```ts
const CLEF_SUPPORTED_EXTENSIONS = [".enc.yaml", ".enc.json"] as const;
```

Supported file extensions for encrypted SOPS files.
