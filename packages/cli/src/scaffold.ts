/**
 * Policy + CI workflow scaffold engine.
 *
 * Shared by `clef policy init` (standalone) and `clef init` (first-run hook).
 * Idempotent by design: existing files are never clobbered unless `--force`
 * is explicitly passed.
 *
 * Template variants — today every CI provider ships a `cli` variant that
 * invokes `@clef-sh/cli`.  When the GitHub Action (clef-sh/compliance-action)
 * ships its v1 tag, flip `github` to `"native"` below and drop the
 * corresponding `templates/workflows/github/native.yml`.  Other providers
 * follow the same pattern when their Orb / Pipe / Component lands.  Users
 * who scaffolded with the `cli` variant keep working forever — the CLI's
 * `policy check` / `policy report` commands are part of the public API.
 */
import * as fs from "fs";
import * as path from "path";
import { renderUnifiedDiff } from "./diff-print";

export type Provider = "github" | "gitlab" | "bitbucket" | "circleci";
export type Variant = "cli" | "native";

/**
 * Per-provider template variant.  Flip an entry to `"native"` once the
 * matching `native.yml` template lands alongside the `cli.yml`.
 */
const TEMPLATE_VARIANT: Record<Provider, Variant> = {
  github: "cli",
  gitlab: "cli",
  bitbucket: "cli",
  circleci: "cli",
};

/**
 * Where each provider's workflow file is written.  For GitHub we drop the
 * standalone workflow in the standard location; for other providers we use a
 * subpath and surface include/merge instructions since those tools expect a
 * single root config file.
 */
const WORKFLOW_PATHS: Record<Provider, string> = {
  github: ".github/workflows/clef-compliance.yml",
  gitlab: ".gitlab/clef-compliance.yml",
  bitbucket: ".clef/workflows/bitbucket-pipelines.yml",
  circleci: ".clef/workflows/circleci-config.yml",
};

/**
 * Post-scaffold merge hints for providers that can't consume a standalone
 * file.  Printed once per run; never written to disk.
 */
const MERGE_INSTRUCTIONS: Partial<Record<Provider, string>> = {
  gitlab: "Add `include: '/.gitlab/clef-compliance.yml'` to your .gitlab-ci.yml",
  bitbucket:
    "Merge the contents of .clef/workflows/bitbucket-pipelines.yml into your bitbucket-pipelines.yml",
  circleci:
    "Merge the contents of .clef/workflows/circleci-config.yml into your .circleci/config.yml",
};

export const POLICY_PATH = ".clef/policy.yaml";

export interface ScaffoldOptions {
  repoRoot: string;
  /** Force a specific provider, bypassing detection. */
  ci?: Provider;
  /** Overwrite existing files. */
  force?: boolean;
  /** Only scaffold the policy file. */
  policyOnly?: boolean;
  /** Only scaffold the workflow file. */
  workflowOnly?: boolean;
  /**
   * Preview mode — compute would-be changes and return diffs without
   * writing anything.  Honors `force`: without it, existing files report
   * `skipped_exists`; with it, they report `would_overwrite`.
   */
  dryRun?: boolean;
}

export type FileStatus =
  | "created"
  | "skipped_exists"
  | "skipped_by_flag"
  | "skipped_no_provider"
  | "would_create"
  | "would_overwrite"
  | "unchanged";

export interface ScaffoldFileResult {
  /** Repo-relative path where the file was (or would be) written. */
  path: string;
  status: FileStatus;
  /**
   * Unified diff of current-vs-template contents.  Populated only for
   * dry-run `would_overwrite` results; empty otherwise.
   */
  diff?: string;
}

export interface ScaffoldResult {
  policy: ScaffoldFileResult;
  workflow: ScaffoldFileResult;
  /**
   * The CI provider whose template would have been used.  Always populated,
   * even when the workflow was skipped — useful for diagnostics ("you'd be on
   * the gitlab template if you ran without --policy-only").
   */
  provider: Provider;
  /** One-line instruction for the user when the provider needs a manual merge. */
  mergeInstruction?: string;
}

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/**
 * Scaffold `.clef/policy.yaml` and a CI workflow into `opts.repoRoot`.
 * Idempotent; callers can run repeatedly without fear of clobber.
 */
export function scaffoldPolicy(opts: ScaffoldOptions): ScaffoldResult {
  // Always resolve the provider (when known) so even skipped workflow
  // results carry the would-be path — the human summary then prints
  // "Workflow  .github/workflows/clef-compliance.yml  [skipped]" instead
  // of "Workflow  (none)  [skipped]".
  const provider = opts.ci ?? detectProvider(opts.repoRoot);

  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  const policyResult = opts.workflowOnly
    ? { path: POLICY_PATH, status: "skipped_by_flag" as FileStatus }
    : scaffoldFile(opts.repoRoot, POLICY_PATH, "policy.yaml", force, dryRun);

  const workflowResult = opts.policyOnly
    ? {
        path: WORKFLOW_PATHS[provider],
        status: "skipped_by_flag" as FileStatus,
      }
    : scaffoldFile(
        opts.repoRoot,
        WORKFLOW_PATHS[provider],
        `workflows/${provider}/${TEMPLATE_VARIANT[provider]}.yml`,
        force,
        dryRun,
      );

  // Merge hints only fire when a workflow would actually land on disk —
  // includes dry-run `would_create` / `would_overwrite` so preview output
  // matches what the user will see after applying.
  const workflowLanded =
    workflowResult.status === "created" ||
    workflowResult.status === "would_create" ||
    workflowResult.status === "would_overwrite";

  return {
    policy: policyResult,
    workflow: workflowResult,
    // `provider` is always populated; null is reserved for callers that
    // explicitly opt out of any workflow consideration in the future.
    provider,
    mergeInstruction:
      workflowLanded && MERGE_INSTRUCTIONS[provider] ? MERGE_INSTRUCTIONS[provider] : undefined,
  };
}

/**
 * Detect the CI provider in priority order: existing config dirs/files →
 * git remote → default GitHub.  Never returns null — every `clef init` gets
 * some workflow scaffolded.
 */
export function detectProvider(repoRoot: string): Provider {
  if (fs.existsSync(path.join(repoRoot, ".github"))) return "github";
  if (fs.existsSync(path.join(repoRoot, ".gitlab-ci.yml"))) return "gitlab";
  if (fs.existsSync(path.join(repoRoot, "bitbucket-pipelines.yml"))) return "bitbucket";
  if (fs.existsSync(path.join(repoRoot, ".circleci/config.yml"))) return "circleci";

  // Inspect git remote URL as a secondary signal.
  const gitConfig = path.join(repoRoot, ".git", "config");
  if (fs.existsSync(gitConfig)) {
    try {
      const cfg = fs.readFileSync(gitConfig, "utf-8");
      if (/gitlab\.com/i.test(cfg)) return "gitlab";
      if (/bitbucket\.org/i.test(cfg)) return "bitbucket";
      if (/github\.com/i.test(cfg)) return "github";
    } catch {
      // Ignore — fall through to default.
    }
  }

  return "github";
}

/**
 * Core scaffold primitive — resolves the template, then either writes to
 * disk (normal run) or returns the would-be status + diff (dry run).
 *
 * Decision table (`E` = file exists on disk, `I` = identical to template):
 *
 *   dryRun  force  E  I  → status            diff
 *   ------  -----  -  -  -------------------  ----
 *   false   *      F  *  created              —
 *   false   false  T  *  skipped_exists       —
 *   false   true   T  *  created              —       (overwrite)
 *   true    *      F  *  would_create         —
 *   true    false  T  *  skipped_exists       —
 *   true    true   T  T  unchanged            —
 *   true    true   T  F  would_overwrite      unified diff
 */
function scaffoldFile(
  repoRoot: string,
  relPath: string,
  templateRelPath: string,
  force: boolean,
  dryRun: boolean,
): ScaffoldFileResult {
  const absolutePath = path.join(repoRoot, relPath);
  const content = loadTemplate(templateRelPath);
  const exists = fs.existsSync(absolutePath);

  if (exists && !force) {
    return { path: relPath, status: "skipped_exists" };
  }

  if (dryRun) {
    if (!exists) {
      return { path: relPath, status: "would_create" };
    }
    const current = fs.readFileSync(absolutePath, "utf-8");
    if (current === content) {
      return { path: relPath, status: "unchanged" };
    }
    return {
      path: relPath,
      status: "would_overwrite",
      diff: renderUnifiedDiff(relPath, current, content),
    };
  }

  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, content, "utf-8");
  return { path: relPath, status: "created" };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface SeaModule {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
}

/**
 * Load a template file's contents.  Resolves from (1) the embedded SEA blob
 * when running as a single-executable binary, else (2) disk at one of several
 * candidate paths covering npm-installed, bundled, and src-tree layouts.
 */
export function loadTemplate(relativePath: string): string {
  // 1. SEA binary — assets embedded at build time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() is the SEA module access pattern
    const sea = require("node:sea") as SeaModule;
    if (sea.isSea()) {
      const buf = Buffer.from(sea.getAsset(`templates/${relativePath}`));
      return buf.toString("utf-8");
    }
  } catch {
    // node:sea unavailable on Node 18.  Fall through.
  }

  // 2. Disk fallback.  Candidate paths cover:
  //   • bundled CJS output (dist/index.cjs → ../templates/...)
  //   • src/commands/ (src/commands/ → ../../templates/...)
  //   • src/ (src/ → ../templates/...)
  //   • the package root itself (rare, but covers odd bundler layouts)
  const candidates = [
    path.resolve(__dirname, "../templates", relativePath),
    path.resolve(__dirname, "../../templates", relativePath),
    path.resolve(__dirname, "templates", relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }
  throw new ScaffoldError(
    `Template not found: templates/${relativePath}. ` + `Tried: ${candidates.join(", ")}.`,
  );
}

/**
 * Expose the variant map for tests and diagnostic output.  Consumers should
 * not depend on the contents — this reflects current shipping state, not a
 * stable API.
 */
export function currentVariant(provider: Provider): Variant {
  return TEMPLATE_VARIANT[provider];
}
