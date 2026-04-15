import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import * as YAML from "yaml";
import { Command } from "commander";
import { CLEF_POLICY_FILENAME, PolicyParser, SubprocessRunner, runCompliance } from "@clef-sh/core";
import type { FileRotationStatus, RunComplianceResult } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym, isPlainMode } from "../output/symbols";
import { Provider, ScaffoldResult, scaffoldPolicy } from "../scaffold";

const MS_PER_DAY = 86_400_000;

interface CheckOptions {
  namespace?: string[];
  environment?: string[];
  strict?: boolean;
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
      "Evaluate the matrix against the rotation policy and print a verdict per cell.\n\n" +
        "Exit codes:\n" +
        "  0  All evaluated cells compliant\n" +
        "  1  One or more cells overdue\n" +
        "  2  Configuration error (missing manifest, invalid policy)\n" +
        "  3  --strict and one or more cells have unknown lastmodified",
    )
    .option("-n, --namespace <ns...>", "Limit evaluation to these namespaces (repeatable)")
    .option("-e, --environment <env...>", "Limit evaluation to these environments (repeatable)")
    .option("--strict", "Treat files without sops.lastmodified as failures (exit 3)")
    .action(async (options: CheckOptions) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const result = await runCompliance({
          runner: deps.runner,
          repoRoot,
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
          process.exit(exitCodeForCheck(result, options.strict ?? false));
          return;
        }

        printCheckTable(result.document.files);
        printCheckSummary(result.document.files);
        process.exit(exitCodeForCheck(result, options.strict ?? false));
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
        const result = await runCompliance({
          runner: deps.runner,
          repoRoot,
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

function countUnknown(files: FileRotationStatus[]): number {
  return files.filter((f) => !f.last_modified_known).length;
}

function exitCodeForCheck(result: RunComplianceResult, strict: boolean): number {
  const overdue = result.document.summary.rotation_overdue;
  if (overdue > 0) return 1;
  if (strict && countUnknown(result.document.files) > 0) return 3;
  return 0;
}

function printCheckTable(files: FileRotationStatus[]): void {
  if (files.length === 0) {
    formatter.info("No matrix files matched the filter.");
    return;
  }

  const rows = files.map((f) => {
    const lastMod = new Date(f.last_modified);
    const ageDays = Math.floor((Date.now() - lastMod.getTime()) / MS_PER_DAY);
    const ageStr = f.last_modified_known ? `${ageDays}d` : "—";
    const status = formatStatus(f);
    return [f.path, f.environment, ageStr, `${policyMaxAge(f)}d`, status];
  });

  formatter.table(rows, ["FILE", "ENV", "AGE", "LIMIT", "STATUS"]);
}

function policyMaxAge(f: FileRotationStatus): number {
  // rotation_due === last_modified + max_age_days, so max_age_days falls
  // out as the difference rounded to whole days.
  const due = new Date(f.rotation_due).getTime();
  const last = new Date(f.last_modified).getTime();
  return Math.round((due - last) / MS_PER_DAY);
}

function formatStatus(f: FileRotationStatus): string {
  if (!f.last_modified_known) {
    const tag = `${sym("warning")} unknown`;
    return isPlainMode() ? tag : pc.yellow(tag);
  }
  if (f.rotation_overdue) {
    const tag = `${sym("failure")} overdue ${f.days_overdue}d`;
    return isPlainMode() ? tag : pc.red(tag);
  }
  const tag = `${sym("success")} ok`;
  return isPlainMode() ? tag : pc.green(tag);
}

function printCheckSummary(files: FileRotationStatus[]): void {
  const compliant = files.filter((f) => f.compliant).length;
  const overdue = files.filter((f) => f.rotation_overdue).length;
  const unknown = countUnknown(files);

  formatter.print("");
  const parts: string[] = [
    `${files.length} file${files.length !== 1 ? "s" : ""}`,
    isPlainMode() ? `${compliant} compliant` : pc.green(`${compliant} compliant`),
  ];
  if (overdue > 0) {
    parts.push(isPlainMode() ? `${overdue} overdue` : pc.red(`${overdue} overdue`));
  }
  if (unknown > 0) {
    parts.push(isPlainMode() ? `${unknown} unknown` : pc.yellow(`${unknown} unknown`));
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

  if (result.mergeInstruction) {
    formatter.print("");
    formatter.hint(result.mergeInstruction);
  }
}

function scaffoldStatusLabel(status: ScaffoldResult["policy"]["status"]): string {
  switch (status) {
    case "created":
      return isPlainMode() ? "[created]" : pc.green(`${sym("success")} created`);
    case "skipped_exists":
      return isPlainMode() ? "[exists] " : pc.dim(`${sym("info")}  exists  `);
    case "skipped_by_flag":
      return isPlainMode() ? "[skipped]" : pc.dim(`${sym("info")}  skipped `);
    case "skipped_no_provider":
      return isPlainMode() ? "[skipped]" : pc.dim(`${sym("info")}  skipped `);
  }
}
