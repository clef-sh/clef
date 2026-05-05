/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * `runCompliance` is the single entry point that the CLI (`clef policy *`)
 * and every CI integration (the GitHub compliance Action, GitLab pipes,
 * Bitbucket pipelines, CircleCI orbs) call to produce a compliance verdict
 * + artifact for a repository.  Both surfaces emit byte-equivalent output
 * for a given input — local debugging must match CI verdicts.
 *
 * A logic slip here either silently passes overdue / leaking secrets or
 * floods every downstream pipeline with false alarms.  Before adding or
 * modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as path from "path";
import { ManifestParser } from "../manifest/parser";
import { MatrixManager } from "../matrix/manager";
import { SopsClient } from "../sops/client";
import { LintRunner } from "../lint/runner";
import { SchemaValidator } from "../schema/validator";
import { ScanRunner, ScanResult } from "../scanner";
import { LintResult, SubprocessRunner } from "../types";
import { composeSecretSource } from "../source/compose";
import { FilesystemStorageBackend } from "../source/filesystem-storage-backend";
import { createSopsEncryptionBackend } from "../source/sops-encryption-backend";
import type { SecretSource } from "../source/types";
import { CLEF_POLICY_FILENAME, PolicyParser } from "../policy/parser";
import { PolicyEvaluator } from "../policy/evaluator";
import { FileRotationStatus, PolicyDocument } from "../policy/types";
import { readSopsKeyNames } from "../sops/keys";
import { getRotations } from "../pending/metadata";
import { ComplianceGenerator } from "./generator";
import { ComplianceDocument } from "./types";

/**
 * Inputs for {@link runCompliance}.
 *
 * `runner` is required.  Compliance only ever shells out to `git` and
 * `sops filestatus` (no stdin piping), so callers can ship a minimal
 * `SubprocessRunner` around `child_process.execFile` — there is no need
 * for the FIFO workaround that `@clef-sh/cli`'s `NodeSubprocessRunner`
 * uses for encrypt/decrypt.
 */
export interface RunComplianceOptions {
  /** Required.  See note above. */
  runner: SubprocessRunner;
  /** Repository root.  Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Manifest path.  Defaults to `<repoRoot>/clef.yaml`. */
  manifestPath?: string;
  /**
   * Policy path.  Defaults to `<repoRoot>/.clef/policy.yaml`.  A missing
   * file is not an error — the run uses {@link DEFAULT_POLICY}.
   */
  policyPath?: string;
  /**
   * Pre-resolved policy.  Wins over `policyPath`.  Useful when callers
   * have already merged an org-wide policy with the repo's own.
   */
  policy?: PolicyDocument;
  /** Git commit SHA.  Auto-detected from CI env / `git rev-parse HEAD`. */
  sha?: string;
  /** `owner/repo`.  Auto-detected from CI env / `git remote get-url`. */
  repo?: string;
  /** Subset of the matrix to evaluate.  Empty arrays mean "no filter". */
  filter?: { namespaces?: string[]; environments?: string[] };
  /** Reference time for `generated_at` and rotation evaluation. */
  now?: Date;
  /** Toggle individual checks.  All true by default. */
  include?: { scan?: boolean; lint?: boolean; rotation?: boolean };
  /**
   * Optional override for the sops binary path.  When omitted,
   * {@link resolveSopsPath} chooses (CLEF_SOPS_PATH env, bundled package,
   * then bare "sops" on PATH).  Callers that already resolved the path
   * (the UI server, the CLI) can pass it through to skip re-resolution.
   */
  sopsPath?: string;
  /**
   * Age key material — inline private key string.  When provided, the
   * internal {@link SopsClient} uses it for decrypt-requiring checks
   * (lint, schema validation).  When omitted, those checks run without
   * keys and surface decrypt failures as `info`-level lint issues.
   *
   * KMS-encrypted files authenticate via ambient env (AWS_PROFILE, IMDS,
   * etc.) — no parameter threading required.
   */
  ageKey?: string;
  /** Age key file path.  Same semantics as {@link ageKey}. */
  ageKeyFile?: string;
}

export interface RunComplianceResult {
  document: ComplianceDocument;
  /**
   * `true` iff zero rotation-overdue files, zero scan violations, and
   * zero lint errors.  The CI gate.
   */
  passed: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/** Sentinel returned when neither CI env nor git can supply context. */
const UNKNOWN = "unknown";

/**
 * Compose all compliance signals for a repository into a single artifact.
 *
 * @throws Errors only on infrastructure failures: missing manifest, invalid
 *   policy YAML, missing `sops` binary.  Policy violations are normal
 *   results and surface as `result.passed === false`.
 */
export async function runCompliance(opts: RunComplianceOptions): Promise<RunComplianceResult> {
  const start = Date.now();
  const repoRoot = opts.repoRoot ?? process.cwd();
  const manifestPath = opts.manifestPath ?? path.join(repoRoot, "clef.yaml");
  const policyPath = opts.policyPath ?? path.join(repoRoot, CLEF_POLICY_FILENAME);
  const include = {
    scan: opts.include?.scan ?? true,
    lint: opts.include?.lint ?? true,
    rotation: opts.include?.rotation ?? true,
  };
  const now = opts.now ?? new Date();

  const manifest = new ManifestParser().parse(manifestPath);
  const policy = opts.policy ?? new PolicyParser().load(policyPath);

  // Metadata-only paths (getMetadata, readSopsKeyNames) never decrypt.
  // Lint may decrypt for schema validation — accept optional age keys from
  // the caller so local invocations with keys available produce clean
  // output.  CI (no keys) still works: decrypt failures are downgraded to
  // `info` below.  KMS files authenticate via ambient env and need no
  // parameter threading.
  const sopsClient = new SopsClient(opts.runner, opts.ageKeyFile, opts.ageKey, opts.sopsPath);
  const matrixManager = new MatrixManager();
  const schemaValidator = new SchemaValidator();
  const lintSource = composeSecretSource(
    new FilesystemStorageBackend(manifest, repoRoot),
    createSopsEncryptionBackend(sopsClient),
    manifest,
  );

  // Detect git context in parallel with metadata lookups — both are cheap
  // and independent.
  const [sha, repo, files, scanResult, lintResult] = await Promise.all([
    opts.sha !== undefined ? Promise.resolve(opts.sha) : detectSha(opts.runner, repoRoot),
    opts.repo !== undefined ? Promise.resolve(opts.repo) : detectRepo(opts.runner, repoRoot),
    include.rotation
      ? evaluateMatrix({
          manifest,
          repoRoot,
          policy,
          matrixManager,
          source: lintSource,
          filter: opts.filter,
          now,
        })
      : Promise.resolve<FileRotationStatus[]>([]),
    include.scan
      ? new ScanRunner(opts.runner).scan(repoRoot, manifest)
      : Promise.resolve(emptyScan()),
    include.lint
      ? new LintRunner(matrixManager, schemaValidator, lintSource).run(manifest, repoRoot)
      : Promise.resolve(emptyLint()),
  ]);

  // Compliance runs without decryption keys by design (see above).  The lint
  // runner emits `severity: "error"` for every file it can't decrypt, which
  // would fail the gate on a condition that's environmental, not a repo
  // issue.  Downgrade those to `info` so they stay visible in the artifact
  // but don't count toward `lint_errors`.  A real decrypt failure on a dev
  // machine (where keys *should* be present) still surfaces as an error via
  // `clef lint` directly — this adjustment is scoped to compliance only.
  const adjustedLint = downgradeDecryptIssues(lintResult);

  const document = new ComplianceGenerator().generate({
    sha,
    repo,
    policy,
    scanResult,
    lintResult: adjustedLint,
    files,
    now,
  });

  const passed =
    document.summary.rotation_overdue === 0 &&
    document.summary.scan_violations === 0 &&
    document.summary.lint_errors === 0;

  return { document, passed, durationMs: Date.now() - start };
}

interface EvaluateMatrixArgs {
  manifest: ReturnType<ManifestParser["parse"]>;
  repoRoot: string;
  policy: PolicyDocument;
  matrixManager: MatrixManager;
  source: SecretSource;
  filter: RunComplianceOptions["filter"];
  now: Date;
}

async function evaluateMatrix(args: EvaluateMatrixArgs): Promise<FileRotationStatus[]> {
  const evaluator = new PolicyEvaluator(args.policy);
  const cells = args.matrixManager
    .resolveMatrix(args.manifest, args.repoRoot)
    .filter((c) => applyFilter(c.namespace, c.environment, args.filter))
    .filter((c) => c.exists);

  return Promise.all(
    cells.map(async (cell) => {
      const metadata = await args.source.getCellMetadata({
        namespace: cell.namespace,
        environment: cell.environment,
      });
      const relPath = path.relative(args.repoRoot, cell.filePath).replace(/\\/g, "/");
      // Enumerate plaintext key names without decrypting — SOPS stores them
      // in plaintext at the top level.  `readSopsKeyNames` returns null on
      // parse failure; treat as an empty cell for policy purposes (lint
      // will separately flag the file as malformed).
      const keys = readSopsKeyNames(cell.filePath) ?? [];
      const rotations = await getRotations(cell.filePath);
      return evaluator.evaluateFile(relPath, cell.environment, metadata, keys, rotations, args.now);
    }),
  );
}

function applyFilter(
  namespace: string,
  environment: string,
  filter: RunComplianceOptions["filter"],
): boolean {
  if (filter?.namespaces?.length && !filter.namespaces.includes(namespace)) return false;
  if (filter?.environments?.length && !filter.environments.includes(environment)) return false;
  return true;
}

function emptyScan(): ScanResult {
  return {
    matches: [],
    filesScanned: 0,
    filesSkipped: 0,
    unencryptedMatrixFiles: [],
    durationMs: 0,
  };
}

function emptyLint(): LintResult {
  return { issues: [], fileCount: 0, pendingCount: 0 };
}

/**
 * Reclassify `Failed to decrypt` lint errors as info-level.  Keeps the issue
 * in the artifact (so reviewers can see which files weren't readable in this
 * environment) without failing the compliance gate.
 */
function downgradeDecryptIssues(result: LintResult): LintResult {
  return {
    ...result,
    issues: result.issues.map((issue) => {
      if (issue.category === "sops" && issue.message.startsWith("Failed to decrypt")) {
        return {
          ...issue,
          severity: "info" as const,
          message: `File not decryptable in this environment (compliance runs without keys). Original check: ${issue.message}`,
        };
      }
      return issue;
    }),
  };
}

/**
 * Resolve the commit SHA in priority order:
 *   1. CI env vars (GitHub, GitLab, Bitbucket, CircleCI)
 *   2. `git rev-parse HEAD`
 *   3. The literal string `"unknown"` so the artifact stays well-formed.
 */
async function detectSha(runner: SubprocessRunner, repoRoot: string): Promise<string> {
  const env = process.env;
  const fromEnv =
    env.GITHUB_SHA ??
    env.CI_COMMIT_SHA ??
    env.BITBUCKET_COMMIT ??
    env.CIRCLE_SHA1 ??
    env.BUILD_VCS_NUMBER;
  if (fromEnv) return fromEnv;

  const result = await runner.run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  if (result.exitCode !== 0) return UNKNOWN;
  const trimmed = result.stdout.trim();
  return trimmed || UNKNOWN;
}

/**
 * Resolve the `owner/repo` slug in priority order:
 *   1. CI env vars
 *   2. `git remote get-url origin` → parse last two path segments.
 *      Supports both `git@github.com:owner/repo.git` and HTTPS variants.
 *   3. The literal string `"unknown"`.
 */
async function detectRepo(runner: SubprocessRunner, repoRoot: string): Promise<string> {
  const env = process.env;
  const fromEnv =
    env.GITHUB_REPOSITORY ??
    env.CI_PROJECT_PATH ??
    env.BITBUCKET_REPO_FULL_NAME ??
    (env.CIRCLE_PROJECT_USERNAME && env.CIRCLE_PROJECT_REPONAME
      ? `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`
      : undefined);
  if (fromEnv) return fromEnv;

  const result = await runner.run("git", ["remote", "get-url", "origin"], { cwd: repoRoot });
  if (result.exitCode !== 0) return UNKNOWN;
  const url = result.stdout.trim();
  // Matches the trailing `owner/repo[.git]` segment of either
  //   git@host:owner/repo.git    or
  //   https://host/owner/repo(.git)
  const match = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : UNKNOWN;
}
