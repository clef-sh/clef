import * as path from "path";
import pc from "picocolors";
import { Command } from "commander";
import {
  ClefReport,
  CloudApiError,
  CloudApiReport,
  CloudClient,
  ManifestParser,
  MatrixManager,
  ReportGenerator,
  ReportTransformer,
  SchemaValidator,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  collectCIContext,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import { generateReportAtCommit, getHeadSha, listCommitRange } from "../report/historical";

const DEFAULT_API_URL = "https://api.clef.sh";

export function registerReportCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("report")
    .description(
      "Generate a metadata report for this Clef repository.\n\n" +
        "Includes repo identity, matrix status, policy issues, and recipient\n" +
        "summaries. Never exposes ciphertext, key names, or decrypted values.\n\n" +
        "Exit codes:\n" +
        "  0  No errors\n" +
        "  1  Errors found",
    )
    .option("--json", "Output full report as JSON")
    .option("--push", "Push report(s) to Clef Cloud API")
    .option("--at <sha>", "Generate report at a specific commit")
    .option("--since <sha>", "Generate reports for all commits since <sha>")
    .option("--api-token <token>", "API token (or CLEF_API_TOKEN env var)")
    .option("--api-url <url>", "Cloud API base URL (or CLEF_API_URL env var)")
    .option("--namespace <name...>", "Filter to namespace(s)")
    .option("--environment <name...>", "Filter to environment(s)")
    .action(
      async (options: {
        json?: boolean;
        push?: boolean;
        at?: string;
        since?: string;
        apiToken?: string;
        apiUrl?: string;
        namespace?: string[];
        environment?: string[];
      }) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();

          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const clefVersion = (require("../../package.json") as { version: string }).version;

          // ── --at <sha>: generate at a specific commit ───────────────────
          if (options.at) {
            const report = await generateReportAtCommit(
              repoRoot,
              options.at,
              clefVersion,
              deps.runner,
            );
            outputReport(report, options.json);
            return;
          }

          // ── Generate HEAD report (used by default, --push, --since) ─────
          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const matrixManager = new MatrixManager();
          const schemaValidator = new SchemaValidator();
          const generator = new ReportGenerator(
            deps.runner,
            sopsClient,
            matrixManager,
            schemaValidator,
          );

          const headReport = await generator.generate(repoRoot, clefVersion, {
            namespaceFilter: options.namespace,
            environmentFilter: options.environment,
          });

          // ── --push: full cloud pipeline ─────────────────────────────────
          if (options.push) {
            await pushPipeline(repoRoot, clefVersion, headReport, options, deps.runner);
            return;
          }

          // ── --since <sha>: range of reports ─────────────────────────────
          if (options.since) {
            const commits = await listCommitRange(repoRoot, options.since, deps.runner);
            const headSha = await getHeadSha(repoRoot, deps.runner);

            const reports: ClefReport[] = [];
            for (const sha of commits) {
              if (sha === headSha) {
                reports.push(headReport);
              } else {
                reports.push(await generateReportAtCommit(repoRoot, sha, clefVersion, deps.runner));
              }
            }

            if (options.json) {
              formatter.raw(JSON.stringify(reports, null, 2) + "\n");
            } else {
              formatter.print(
                `Generated ${reports.length} report(s) for commits since ${options.since.slice(0, 8)}`,
              );
              for (const r of reports) {
                const sha = r.repoIdentity.commitSha.slice(0, 8);
                const errors = r.policy.issueCount.error;
                const status = errors > 0 ? pc.red(`${errors} error(s)`) : pc.green("clean");
                formatter.print(`  ${pc.dim(sha)}  ${status}`);
              }
            }
            process.exit(reports.some((r) => r.policy.issueCount.error > 0) ? 1 : 0);
            return;
          }

          // ── Default: output single report ───────────────────────────────
          outputReport(headReport, options.json);
        } catch (err) {
          if (err instanceof CloudApiError) {
            formatter.error(err.message);
            if (err.fix) formatter.hint(err.fix);
            process.exit(1);
            return;
          }
          if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
            formatter.formatDependencyError(err);
            process.exit(1);
            return;
          }
          formatter.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}

async function pushPipeline(
  repoRoot: string,
  clefVersion: string,
  headReport: ClefReport,
  options: { apiToken?: string; apiUrl?: string },
  runner: SubprocessRunner,
): Promise<void> {
  // 1. Resolve token
  const token = options.apiToken ?? process.env.CLEF_API_TOKEN;
  if (!token) {
    formatter.error("--push requires an API token. Set --api-token or CLEF_API_TOKEN.");
    process.exit(1);
    return;
  }

  // 2. Parse manifest for cloud config
  const parser = new ManifestParser();
  const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
  if (!manifest.cloud?.integrationId) {
    formatter.error("--push requires cloud.integrationId in clef.yaml.");
    formatter.hint("Add a 'cloud' section with 'integrationId' to your manifest.");
    process.exit(1);
    return;
  }

  // 3. Resolve API URL
  const apiUrl = options.apiUrl ?? process.env.CLEF_API_URL ?? DEFAULT_API_URL;

  // 4. Fetch integration to determine gap
  const client = new CloudClient();
  const integration = await client.fetchIntegration(apiUrl, token, manifest.cloud.integrationId);

  // 5. Determine which commits to report
  const headSha = headReport.repoIdentity.commitSha;

  let reports: ClefReport[];
  if (integration.lastCommitSha === null) {
    // First report ever
    reports = [headReport];
  } else if (integration.lastCommitSha === headSha) {
    formatter.success("Already up to date — no new commits to report.");
    process.exit(0);
    return;
  } else {
    // Gap-fill: generate reports for all commits since last known
    const commits = await listCommitRange(repoRoot, integration.lastCommitSha, runner);
    reports = [];
    for (const sha of commits) {
      if (sha === headSha) {
        reports.push(headReport);
      } else {
        reports.push(await generateReportAtCommit(repoRoot, sha, clefVersion, runner));
      }
    }
  }

  // 6. Transform all reports
  const transformer = new ReportTransformer();
  const cloudReports: CloudApiReport[] = reports.map((r) => transformer.transform(r));

  // 7. Attach CI context to the last report if enabled
  if (integration.config.collectCIContext && cloudReports.length > 0) {
    const ciCtx = collectCIContext();
    if (ciCtx) {
      cloudReports[cloudReports.length - 1].ciContext = ciCtx;
    }
  }

  // 8. Submit
  if (cloudReports.length === 1) {
    const result = await client.submitReport(apiUrl, token, cloudReports[0]);
    formatter.success(`Report submitted (${result.commitSha.slice(0, 8)})`);
  } else {
    const result = await client.submitBatchReports(apiUrl, token, { reports: cloudReports });
    formatter.success(`${result.accepted} report(s) submitted`);
  }
  process.exit(0);
}

function outputReport(report: ClefReport, json?: boolean): void {
  if (json) {
    formatter.raw(JSON.stringify(report, null, 2) + "\n");
    process.exit(report.policy.issueCount.error > 0 ? 1 : 0);
    return;
  }

  formatReportOutput(report);
  process.exit(report.policy.issueCount.error > 0 ? 1 : 0);
}

function formatReportOutput(report: ClefReport): void {
  const sha = report.repoIdentity.commitSha ? report.repoIdentity.commitSha.slice(0, 8) : "";
  const header = [
    report.repoIdentity.repoOrigin
      ? pc.bold(report.repoIdentity.repoOrigin)
      : pc.dim("(unknown origin)"),
    sha ? pc.dim(sha) : "",
    report.repoIdentity.branch ? pc.dim(report.repoIdentity.branch) : "",
  ]
    .filter(Boolean)
    .join("  ");
  formatter.print(header);
  formatter.print("");

  // Matrix table
  if (report.matrix.length > 0) {
    formatter.print(pc.bold("Matrix"));
    formatter.table(
      report.matrix.map((cell) => [
        cell.namespace,
        cell.environment,
        cell.exists ? String(cell.keyCount) : pc.dim("missing"),
        cell.metadata?.lastModified
          ? new Date(cell.metadata.lastModified).toLocaleDateString()
          : pc.dim("\u2014"),
      ]),
      ["Namespace", "Environment", "Keys", "Last Modified"],
    );
    formatter.print("");
  }

  // Recipients table
  const recipientEntries = Object.entries(report.recipients);
  if (recipientEntries.length > 0) {
    formatter.print(pc.bold("Recipients"));
    formatter.table(
      recipientEntries.map(([fingerprint, summary]) => [
        fingerprint.length > 20
          ? `${fingerprint.slice(0, 8)}\u2026${fingerprint.slice(-8)}`
          : fingerprint,
        summary.type,
        summary.environments.join(", "),
      ]),
      ["Fingerprint", "Type", "Environments"],
    );
    formatter.print("");
  }

  // Policy issues
  const { issues, issueCount } = report.policy;
  if (issues.length === 0) {
    formatter.success("No policy issues found.");
    return;
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  if (errors.length > 0) {
    formatter.print(pc.red(pc.bold(`${sym("failure")} ${errors.length} error(s)`)));
    for (const issue of errors) {
      formatter.print(`  ${pc.red(sym("failure"))} ${issue.message}`);
    }
    formatter.print("");
  }

  if (warnings.length > 0) {
    formatter.print(pc.yellow(pc.bold(`${sym("warning")} ${warnings.length} warning(s)`)));
    for (const issue of warnings) {
      formatter.print(`  ${pc.yellow(sym("warning"))} ${issue.message}`);
    }
    formatter.print("");
  }

  if (infos.length > 0) {
    formatter.print(pc.blue(pc.bold(`${sym("info")} ${infos.length} info`)));
    for (const issue of infos) {
      formatter.print(`  ${pc.blue(sym("info"))} ${issue.message}`);
    }
    formatter.print("");
  }

  const parts: string[] = [];
  if (issueCount.error > 0) parts.push(pc.red(`${issueCount.error} error(s)`));
  if (issueCount.warning > 0) parts.push(pc.yellow(`${issueCount.warning} warning(s)`));
  if (issueCount.info > 0) parts.push(pc.blue(`${issueCount.info} info`));
  formatter.print(parts.join("  "));
  formatter.hint("Run clef lint or clef drift locally for details.");
}
