import * as path from "path";
import pc from "picocolors";
import { Command } from "commander";
import {
  LintResult,
  LintRunner,
  ManifestParser,
  MatrixManager,
  SchemaValidator,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerLintCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("lint")
    .description(
      "Full repo health check — matrix completeness, schema validation, SOPS integrity.\n\n" +
        "Exit codes:\n" +
        "  0  No errors (warnings are allowed)\n" +
        "  1  Errors found",
    )
    .option("--fix", "Auto-fix safe issues (scaffold missing files)")
    .option("--json", "Output raw LintResult JSON")
    .action(async (options: { fix?: boolean; json?: boolean }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const sopsClient = new SopsClient(deps.runner);
        const matrixManager = new MatrixManager();
        const schemaValidator = new SchemaValidator();
        const lintRunner = new LintRunner(matrixManager, schemaValidator, sopsClient);

        let result: LintResult;
        if (options.fix) {
          result = await lintRunner.fix(manifest, repoRoot);
        } else {
          result = await lintRunner.run(manifest, repoRoot);
        }

        if (options.json) {
          formatter.raw(JSON.stringify(result, null, 2) + "\n");
          const hasErrors = result.issues.some((i) => i.severity === "error");
          process.exit(hasErrors ? 1 : 0);
        }

        formatLintOutput(result);

        const hasErrors = result.issues.some((i) => i.severity === "error");
        process.exit(hasErrors ? 1 : 0);
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}

function formatLintOutput(result: LintResult): void {
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");

  if (result.issues.length === 0) {
    formatter.success(`All clear \u2014 ${result.fileCount} files healthy`);
    return;
  }

  formatter.print("");

  if (errors.length > 0) {
    formatter.print(pc.red(pc.bold(`${sym("failure")} ${errors.length} error(s)`)));
    for (const issue of errors) {
      const keyRef = issue.key ? ` ${pc.white(issue.key)}` : "";
      const categoryBadge = pc.dim(`[${issue.category}]`);
      formatter.print(`  ${pc.red(sym("failure"))} ${categoryBadge} ${issue.file}${keyRef}`);
      formatter.print(`    ${issue.message}`);
      if (issue.fixCommand) {
        formatter.hint(issue.fixCommand);
      }
    }
    formatter.print("");
  }

  if (warnings.length > 0) {
    formatter.print(pc.yellow(pc.bold(`${sym("warning")} ${warnings.length} warning(s)`)));
    for (const issue of warnings) {
      const keyRef = issue.key ? ` ${pc.white(issue.key)}` : "";
      const categoryBadge = pc.dim(`[${issue.category}]`);
      formatter.print(`  ${pc.yellow(sym("warning"))} ${categoryBadge} ${issue.file}${keyRef}`);
      formatter.print(`    ${issue.message}`);
      if (issue.fixCommand) {
        formatter.hint(issue.fixCommand);
      }
    }
    formatter.print("");
  }

  if (infos.length > 0) {
    formatter.print(pc.blue(pc.bold(`${sym("info")} ${infos.length} info`)));
    for (const issue of infos) {
      const keyRef = issue.key ? ` ${pc.white(issue.key)}` : "";
      const categoryBadge = pc.dim(`[${issue.category}]`);
      formatter.print(`  ${pc.blue(sym("info"))} ${categoryBadge} ${issue.file}${keyRef}`);
      formatter.print(`    ${issue.message}`);
    }
    formatter.print("");
  }

  // Summary line
  const parts: string[] = [];
  if (errors.length > 0) parts.push(pc.red(`${errors.length} error(s)`));
  if (warnings.length > 0) parts.push(pc.yellow(`${warnings.length} warning(s)`));
  if (infos.length > 0) parts.push(pc.blue(`${infos.length} info`));
  formatter.print(parts.join(", "));

  // Fixable hints at the end
  const fixableIssues = result.issues.filter((i) => i.fixCommand);
  if (fixableIssues.length > 0) {
    for (const issue of fixableIssues) {
      formatter.hint(issue.fixCommand!);
    }
  }
}
