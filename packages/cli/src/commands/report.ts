import pc from "picocolors";
import { Command } from "commander";
import {
  ClefReport,
  MatrixManager,
  ReportGenerator,
  SchemaValidator,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

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
    .option("--push", "POST the report to Clef Cloud API (preview)")
    .option("--api-token <token>", "API token (or CLEF_API_TOKEN env var)")
    .option("--namespace <name...>", "Filter to namespace(s)")
    .option("--environment <name...>", "Filter to environment(s)")
    .action(
      async (options: {
        json?: boolean;
        push?: boolean;
        apiToken?: string;
        namespace?: string[];
        environment?: string[];
      }) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();
          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const matrixManager = new MatrixManager();
          const schemaValidator = new SchemaValidator();
          const generator = new ReportGenerator(
            deps.runner,
            sopsClient,
            matrixManager,
            schemaValidator,
          );

          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const clefVersion = (require("../../package.json") as { version: string }).version;

          const report = await generator.generate(repoRoot, clefVersion, {
            namespaceFilter: options.namespace,
            environmentFilter: options.environment,
          });

          if (options.push) {
            const token = options.apiToken ?? process.env.CLEF_API_TOKEN;
            if (!token) {
              formatter.error("--push requires an API token. Set --api-token or CLEF_API_TOKEN.");
              process.exit(1);
              return;
            }
            formatter.print("Clef Cloud push is not yet available. Report generated locally:");
            formatter.raw(JSON.stringify(report, null, 2) + "\n");
            process.exit(0);
            return;
          }

          if (options.json) {
            formatter.raw(JSON.stringify(report, null, 2) + "\n");
            process.exit(report.policy.issueCount.error > 0 ? 1 : 0);
            return;
          }

          formatReportOutput(report);
          process.exit(report.policy.issueCount.error > 0 ? 1 : 0);
        } catch (err) {
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
