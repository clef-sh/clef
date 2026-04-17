import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import * as YAML from "yaml";
import { Command } from "commander";
import { CLEF_POLICY_FILENAME, PolicyParser, SubprocessRunner, runCompliance } from "@clef-sh/core";
import type { FileRotationStatus, KeyRotationStatus, RunComplianceResult } from "@clef-sh/core";
import { resolveAgeCredential, prepareSopsClientArgs } from "../age-credential";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym, isPlainMode } from "../output/symbols";
import { Provider, ScaffoldResult, scaffoldPolicy } from "../scaffold";

const MS_PER_DAY = 86_400_000;

interface CheckOptions {
  namespace?: string[];
  environment?: string[];
  // Commander stores --per-key / --per-file as a single `perKey?: boolean`
  // when declared as `--no-per-key`; here we use two explicit booleans so
  // the default (undefined / undefined) resolves to per-key output.
  perKey?: boolean;
  perFile?: boolean;
}

interface ReportOptions {
  output?: string;
  sha?: string;
  repo?: string;
  namespace?: string[];
  environment?: string[];
  // Commander stores --no-foo as `foo: false` (default true), not `noFoo`.
  scan?: boolean;
  lint?: boolean;
  rotation?: boolean;
}

interface InitOptions {
  ci?: Provider;
  force?: boolean;
  policyOnly?: boolean;
  workflowOnly?: boolean;
  dryRun?: boolean;
}

const VALID_PROVIDERS: Provider[] = ["github", "gitlab", "bitbucket", "circleci"];

export function registerPolicyCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  const policyCmd = program
    .command("policy")
    .description("Inspect and enforce rotation policy. Same engine the compliance Action uses.");

  // ── policy init ─────────────────────────────────────────────────────────
  policyCmd
    .command("init")
    .description(
      "Scaffold .clef/policy.yaml and a CI workflow that enforces it.\n\n" +
        "CI provider auto-detected from the repo layout. Existing files are\n" +
        "preserved — pass --force to overwrite.",
    )
    .option(
      "--ci <provider>",
      `Force a CI provider: ${VALID_PROVIDERS.join(", ")}. Defaults to auto-detect.`,
    )
    .option("--force", "Overwrite existing files")
    .option("--policy-only", "Scaffold only .clef/policy.yaml, skip the CI workflow")
    .option("--workflow-only", "Scaffold only the CI workflow, skip .clef/policy.yaml")
    .option(
      "--dry-run",
      "Preview the scaffold: print what would change without writing. " +
        "Pair with --force to diff against existing files.",
    )
    .action((options: InitOptions) => {
      try {
        if (options.ci && !VALID_PROVIDERS.includes(options.ci)) {
          formatter.error(
            `Invalid --ci value '${options.ci}'. Must be one of: ${VALID_PROVIDERS.join(", ")}.`,
          );
          process.exit(2);
          return;
        }
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const result = scaffoldPolicy({
          repoRoot,
          ci: options.ci,
          force: options.force,
          policyOnly: options.policyOnly,
          workflowOnly: options.workflowOnly,
          dryRun: options.dryRun,
        });

        if (isJsonMode()) {
          formatter.json(result);
          return;
        }

        printScaffoldResult(result);
      } catch (err) {
        handleCommandError(err);
      }
    });

  // ── policy show ─────────────────────────────────────────────────────────
  policyCmd
    .command("show")
    .description(
      "Print the resolved policy.\n\n" +
        "Loads .clef/policy.yaml if present, otherwise prints the built-in default.\n" +
        "Use --json for machine output.",
    )
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const policyPath = path.join(repoRoot, CLEF_POLICY_FILENAME);
        const exists = fs.existsSync(policyPath);
        const policy = new PolicyParser().load(policyPath);

        if (isJsonMode()) {
          formatter.json(policy);
          return;
        }

        if (!exists) {
          formatter.print(
            pc.dim(`# Using built-in default. No ${CLEF_POLICY_FILENAME} found in this repo.`),
          );
          formatter.print(pc.dim(`# Create one to customize: edit ${CLEF_POLICY_FILENAME}`));
        } else {
          formatter.print(pc.dim(`# Resolved from ${CLEF_POLICY_FILENAME}`));
        }
        formatter.raw(YAML.stringify(policy));
      } catch (err) {
        handleCommandError(err);
      }
    });

  // ── policy check ────────────────────────────────────────────────────────
  policyCmd
    .command("check")
    .description(
      "Evaluate the matrix against the rotation policy.  Per-key verdicts by\n" +
        "default (the primary policy signal); use --per-file for a file-level\n" +
        "summary.  Unknown rotation state is always a violation — per design,\n" +
        "we don't claim a secret is compliant unless we have a record of when\n" +
        "its value last changed.\n\n" +
        "Exit codes:\n" +
        "  0  All evaluated keys compliant\n" +
        "  1  One or more keys overdue or of unknown rotation state\n" +
        "  2  Configuration error (missing manifest, invalid policy)",
    )
    .option("-n, --namespace <ns...>", "Limit evaluation to these namespaces (repeatable)")
    .option("-e, --environment <env...>", "Limit evaluation to these environments (repeatable)")
    .option("--per-key", "Print a row per key (default)")
    .option("--per-file", "Print a row per cell with a roll-up status")
    .action(async (options: CheckOptions) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const credential = await resolveAgeCredential(repoRoot, deps.runner);
        const { ageKey, ageKeyFile } = prepareSopsClientArgs(credential);
        const result = await runCompliance({
          runner: deps.runner,
          repoRoot,
          ageKey,
          ageKeyFile,
          filter: {
            namespaces: options.namespace,
            environments: options.environment,
          },
          // `check` only cares about rotation. Skip scan + lint for speed.
          include: { rotation: true, scan: false, lint: false },
        });

        if (isJsonMode()) {
          formatter.json({
            files: result.document.files,
            summary: {
              total_files: result.document.summary.total_files,
              compliant: result.document.summary.compliant,
              rotation_overdue: result.document.summary.rotation_overdue,
              unknown_metadata: countUnknown(result.document.files),
            },
            passed: result.passed,
          });
          process.exit(exitCodeForCheck(result));
          return;
        }

        const mode = options.perFile ? "per-file" : "per-key";
        if (mode === "per-key") {
          printCheckPerKey(result.document.files);
        } else {
          printCheckPerFile(result.document.files);
        }
        printCheckSummary(result.document.files);
        process.exit(exitCodeForCheck(result));
      } catch (err) {
        handleCommandError(err);
      }
    });

  // ── policy report ───────────────────────────────────────────────────────
  policyCmd
    .command("report")
    .description(
      "Produce a full ComplianceDocument (scan + lint + policy + summary).\n\n" +
        "By default writes JSON to stdout. Use --output to write to a file.\n" +
        "This is the same artifact the compliance GitHub Action uploads.",
    )
    .option("-o, --output <file>", "Write the JSON document to a file instead of stdout")
    .option("--sha <sha>", "Override commit SHA (auto-detected from CI env / git otherwise)")
    .option("--repo <owner/name>", "Override repo slug (auto-detected from CI env / git otherwise)")
    .option("-n, --namespace <ns...>", "Limit to these namespaces")
    .option("-e, --environment <env...>", "Limit to these environments")
    .option("--no-scan", "Skip plaintext-secret scan")
    .option("--no-lint", "Skip lint")
    .option("--no-rotation", "Skip rotation evaluation")
    .action(async (options: ReportOptions) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const credential = await resolveAgeCredential(repoRoot, deps.runner);
        const { ageKey, ageKeyFile } = prepareSopsClientArgs(credential);
        const result = await runCompliance({
          runner: deps.runner,
          repoRoot,
          ageKey,
          ageKeyFile,
          sha: options.sha,
          repo: options.repo,
          filter: {
            namespaces: options.namespace,
            environments: options.environment,
          },
          include: {
            scan: options.scan ?? true,
            lint: options.lint ?? true,
            rotation: options.rotation ?? true,
          },
        });

        const json = JSON.stringify(result.document, null, 2);

        if (options.output) {
          // No --json flag check — `report` is structured-data-by-default;
          // human flag only affects the post-write summary line.
          fs.writeFileSync(options.output, json + "\n", "utf-8");
          if (!isJsonMode()) {
            const verdict = result.passed
              ? pc.green(`${sym("success")}  passed`)
              : pc.red(`${sym("failure")}  failed`);
            formatter.print(
              `Wrote ${options.output} \u00B7 ${verdict} \u00B7 ${result.durationMs}ms`,
            );
          }
        } else {
          // No trailing newline omitted — formatter.raw is direct stdout
          formatter.raw(json + "\n");
        }
        // `report` always exits 0 on successful artifact production.
        // The `passed` field carries the verdict for callers that gate on it.
      } catch (err) {
        handleCommandError(err);
      }
    });
}

/** Count cells that have at least one key of unknown rotation state. */
function countUnknown(files: FileRotationStatus[]): number {
  return files.filter((f) => f.keys.some((k) => !k.last_rotated_known)).length;
}

function exitCodeForCheck(result: RunComplianceResult): number {
  // Unified gate: any non-compliant cell (overdue keys or unknown keys) →
  // exit 1.  No separate --strict path for unknown lastmodified — the raw
  // SOPS timestamp no longer drives the policy verdict.
  return result.passed ? 0 : 1;
}

function printCheckPerKey(files: FileRotationStatus[]): void {
  const rows: string[][] = [];
  for (const f of files) {
    for (const k of f.keys) {
      rows.push([
        k.key,
        f.path,
        f.environment,
        keyAgeCol(k),
        `${maxAgeDaysFor(k)}d`,
        formatKeyStatus(k),
      ]);
    }
  }

  if (rows.length === 0) {
    formatter.info("No keys found in the evaluated cells.");
    return;
  }

  formatter.table(rows, ["KEY", "FILE", "ENV", "AGE", "LIMIT", "STATUS"]);
}

function printCheckPerFile(files: FileRotationStatus[]): void {
  if (files.length === 0) {
    formatter.info("No matrix files matched the filter.");
    return;
  }

  const rows = files.map((f) => {
    const lastMod = new Date(f.last_modified);
    const ageDays = Math.floor((Date.now() - lastMod.getTime()) / MS_PER_DAY);
    const ageStr = f.last_modified_known ? `${ageDays}d` : "\u2014";
    return [f.path, f.environment, ageStr, `${f.keys.length}`, formatFileStatus(f)];
  });

  formatter.table(rows, ["FILE", "ENV", "LAST WRITTEN", "KEYS", "STATUS"]);
}

/** Render the AGE column for a per-key row: days since last rotation, or "—" when unknown. */
function keyAgeCol(k: KeyRotationStatus): string {
  if (!k.last_rotated_known || !k.last_rotated_at) return "\u2014";
  const ageDays = Math.floor((Date.now() - new Date(k.last_rotated_at).getTime()) / MS_PER_DAY);
  return `${ageDays}d`;
}

/** Derive max_age_days for a key from its rotation_due vs last_rotated_at. */
function maxAgeDaysFor(k: KeyRotationStatus): number {
  if (!k.last_rotated_at || !k.rotation_due) return 0;
  const due = new Date(k.rotation_due).getTime();
  const last = new Date(k.last_rotated_at).getTime();
  return Math.round((due - last) / MS_PER_DAY);
}

function formatKeyStatus(k: KeyRotationStatus): string {
  if (!k.last_rotated_known) {
    const tag = `${sym("warning")} unknown`;
    return isPlainMode() ? tag : pc.yellow(tag);
  }
  if (k.rotation_overdue) {
    const tag = `${sym("failure")} overdue ${k.days_overdue}d`;
    return isPlainMode() ? tag : pc.red(tag);
  }
  const tag = `${sym("success")} ok`;
  return isPlainMode() ? tag : pc.green(tag);
}

function formatFileStatus(f: FileRotationStatus): string {
  const overdue = f.keys.filter((k) => k.last_rotated_known && k.rotation_overdue).length;
  const unknown = f.keys.filter((k) => !k.last_rotated_known).length;

  if (overdue === 0 && unknown === 0) {
    const tag = `${sym("success")} all compliant`;
    return isPlainMode() ? tag : pc.green(tag);
  }
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (unknown > 0) parts.push(`${unknown} unknown`);
  const tag = `${sym("failure")} ${parts.join(", ")}`;
  return isPlainMode() ? tag : pc.red(tag);
}

function printCheckSummary(files: FileRotationStatus[]): void {
  const compliantCells = files.filter((f) => f.compliant).length;
  let overdueKeys = 0;
  let unknownKeys = 0;
  let totalKeys = 0;
  for (const f of files) {
    for (const k of f.keys) {
      totalKeys++;
      if (!k.last_rotated_known) unknownKeys++;
      else if (k.rotation_overdue) overdueKeys++;
    }
  }

  formatter.print("");
  const parts: string[] = [
    `${files.length} file${files.length !== 1 ? "s" : ""} \u00B7 ${totalKeys} key${
      totalKeys !== 1 ? "s" : ""
    }`,
    isPlainMode()
      ? `${compliantCells} compliant`
      : pc.green(`${compliantCells} compliant cell${compliantCells !== 1 ? "s" : ""}`),
  ];
  if (overdueKeys > 0) {
    parts.push(isPlainMode() ? `${overdueKeys} overdue` : pc.red(`${overdueKeys} overdue`));
  }
  if (unknownKeys > 0) {
    parts.push(isPlainMode() ? `${unknownKeys} unknown` : pc.yellow(`${unknownKeys} unknown`));
  }
  formatter.print(parts.join(" \u00B7 "));
}

/** Human-readable summary for `clef policy init`. */
function printScaffoldResult(result: ScaffoldResult): void {
  const lines: [string, typeof result.policy][] = [
    ["Policy", result.policy],
    ["Workflow", result.workflow],
  ];

  for (const [label, file] of lines) {
    const status = scaffoldStatusLabel(file.status);
    formatter.print(`${status}  ${label.padEnd(9)} ${file.path}`);
  }

  if (result.provider) {
    formatter.print(pc.dim(`Provider: ${result.provider} (cli variant)`));
  }

  // Render any diffs produced in dry-run mode.  `diff` is only populated
  // for `would_overwrite` results, so we don't need to branch on status.
  for (const file of [result.policy, result.workflow]) {
    if (file.diff) {
      formatter.print("");
      formatter.raw(file.diff + "\n");
    }
  }

  if (result.mergeInstruction) {
    formatter.print("");
    formatter.hint(result.mergeInstruction);
  }
}

function scaffoldStatusLabel(status: ScaffoldResult["policy"]["status"]): string {
  switch (status) {
    case "created":
      return isPlainMode() ? "[created]" : pc.green(`${sym("success")} created`);
    case "would_create":
      return isPlainMode() ? "[+create]" : pc.green(`${sym("pending")} + create`);
    case "would_overwrite":
      return isPlainMode() ? "[~update]" : pc.yellow(`${sym("pending")} ~ update`);
    case "unchanged":
      return isPlainMode() ? "[same]   " : pc.dim(`${sym("success")} unchanged`);
    case "skipped_exists":
      return isPlainMode() ? "[exists] " : pc.dim(`${sym("info")}  exists  `);
    case "skipped_by_flag":
      return isPlainMode() ? "[skipped]" : pc.dim(`${sym("info")}  skipped `);
    case "skipped_no_provider":
      return isPlainMode() ? "[skipped]" : pc.dim(`${sym("info")}  skipped `);
  }
}
