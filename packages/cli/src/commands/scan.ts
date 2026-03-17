import * as path from "path";
import pc from "picocolors";
import { Command } from "commander";
import {
  ManifestParser,
  ScanRunner,
  ScanResult,
  SubprocessRunner,
  ManifestValidationError,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerScanCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("scan [paths...]")
    .description(
      "Scan the repository for secrets that have escaped the Clef matrix.\n\n" +
        "Exit codes:\n" +
        "  0  No issues found\n" +
        "  1  Issues found\n" +
        "  2  Scan could not complete (manifest missing, permission error)",
    )
    .option("--staged", "Only scan files staged for commit")
    .option(
      "--severity <level>",
      "Detection level: all (patterns+entropy) or high (patterns only)",
      "all",
    )
    .option("--json", "Output machine-readable JSON")
    .action(
      async (paths: string[], options: { staged?: boolean; severity?: string; json?: boolean }) => {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        let manifest;
        try {
          const parser = new ManifestParser();
          manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
        } catch (err) {
          if (
            err instanceof ManifestValidationError ||
            (err as Error).message?.includes("clef.yaml")
          ) {
            formatter.error("No clef.yaml found. Run 'clef init' to set up this repository.");
          } else {
            formatter.error((err as Error).message);
          }
          process.exit(2);
          return;
        }

        if (options.severity && options.severity !== "all" && options.severity !== "high") {
          formatter.error(`Invalid severity '${options.severity}'. Must be 'all' or 'high'.`);
          process.exit(2);
          return;
        }

        const severity = options.severity === "high" ? "high" : "all";
        const scanRunner = new ScanRunner(deps.runner);

        if (!options.json) {
          formatter.print(pc.dim("Scanning repository for unencrypted secrets..."));
        }

        let result: ScanResult;
        try {
          result = await scanRunner.scan(repoRoot, manifest, {
            stagedOnly: options.staged,
            paths: paths.length > 0 ? paths : undefined,
            severity,
          });
        } catch (err) {
          formatter.error(`Scan failed: ${(err as Error).message}`);
          process.exit(2);
          return;
        }

        if (options.json) {
          const totalIssues = result.matches.length + result.unencryptedMatrixFiles.length;
          formatter.raw(
            JSON.stringify(
              {
                matches: result.matches,
                unencryptedMatrixFiles: result.unencryptedMatrixFiles,
                filesScanned: result.filesScanned,
                filesSkipped: result.filesSkipped,
                durationMs: result.durationMs,
                summary: `${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found`,
              },
              null,
              2,
            ) + "\n",
          );
          const hasIssues = result.matches.length > 0 || result.unencryptedMatrixFiles.length > 0;
          process.exit(hasIssues ? 1 : 0);
          return;
        }

        formatScanOutput(result);

        const hasIssues = result.matches.length > 0 || result.unencryptedMatrixFiles.length > 0;
        process.exit(hasIssues ? 1 : 0);
      },
    );
}

function formatScanOutput(result: ScanResult): void {
  const totalIssues = result.matches.length + result.unencryptedMatrixFiles.length;
  const durationSec = (result.durationMs / 1000).toFixed(1);

  formatter.print("");

  // Unencrypted matrix files (errors)
  for (const file of result.unencryptedMatrixFiles) {
    formatter.print(pc.red(`${sym("failure")} Unencrypted matrix file`));
    formatter.print(`  ${pc.white(file)} \u2014 missing ${sym("locked")}`);
    const base = file.replace(/\.enc\.(yaml|json)$/, "");
    formatter.hint(`clef encrypt ${base}`);
    formatter.print("");
  }

  // Pattern and entropy matches (warnings)
  for (const match of result.matches) {
    if (match.matchType === "pattern") {
      formatter.print(pc.yellow(`${sym("warning")} Pattern match: ${match.patternName}`));
    } else {
      formatter.print(
        pc.yellow(`${sym("warning")} High entropy value (entropy: ${match.entropy?.toFixed(1)})`),
      );
    }

    formatter.print(`  ${pc.white(match.file)}:${match.line}`);
    formatter.print(`  ${pc.dim(match.preview)}`);

    if (match.matchType === "pattern") {
      formatter.hint("clef set <namespace>/<env> <KEY>");
    } else {
      const varName = match.preview.split("=")[0] ?? "KEY";
      formatter.hint(`clef set <namespace>/<env> ${varName}`);
      formatter.print(
        `  ${pc.dim("or suppress: add '# clef-ignore' to line")} ${match.line} ${pc.dim("of")} ${match.file}`,
      );
    }
    formatter.print("");
  }

  // Summary
  if (totalIssues === 0) {
    formatter.success(
      `No issues found \u2014 ${result.filesScanned} files scanned in ${durationSec}s`,
    );
  } else {
    formatter.print(
      `${pc.yellow(`${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found`)} in ${result.filesScanned} files (${durationSec}s)`,
    );
    formatter.hint("Add false positives to .clefignore");
  }
}
