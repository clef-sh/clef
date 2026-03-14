import * as path from "path";
import pc from "picocolors";
import { Command } from "commander";
import {
  DiffEngine,
  DiffResult,
  ManifestParser,
  MatrixManager,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerDiffCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("diff <namespace> <env-a> <env-b>")
    .description(
      "Compare secrets between two environments for a namespace.\n\n" +
        "Exit codes:\n" +
        "  0  No differences\n" +
        "  1  Differences found",
    )
    .option("--show-identical", "Include identical keys in the output")
    .option("--show-values", "Show plaintext values instead of masking them")
    .option("--json", "Output raw DiffResult JSON")
    .action(
      async (
        namespace: string,
        envA: string,
        envB: string,
        options: { showIdentical?: boolean; showValues?: boolean; json?: boolean },
      ) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const sopsClient = new SopsClient(deps.runner);
          const diffEngine = new DiffEngine();

          const result = await diffEngine.diffFiles(
            namespace,
            envA,
            envB,
            manifest,
            sopsClient,
            repoRoot,
          );

          // Warn if showing values for a protected environment
          if (options.showValues) {
            const matrixManager = new MatrixManager();
            if (
              matrixManager.isProtectedEnvironment(manifest, envA) ||
              matrixManager.isProtectedEnvironment(manifest, envB)
            ) {
              formatter.warn("Warning: printing plaintext values for protected environment.");
            }
          }

          if (options.json) {
            const jsonOutput = options.showValues
              ? result
              : {
                  ...result,
                  rows: result.rows.map((r) => ({
                    ...r,
                    valueA:
                      r.valueA !== null ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : null,
                    valueB:
                      r.valueB !== null ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : null,
                    masked: true,
                  })),
                };
            formatter.raw(JSON.stringify(jsonOutput, null, 2) + "\n");
            const hasDiffs = result.rows.some((r) => r.status !== "identical");
            process.exit(hasDiffs ? 1 : 0);
          }

          formatDiffOutput(
            result,
            envA,
            envB,
            options.showIdentical ?? false,
            options.showValues ?? false,
          );

          const hasDiffs = result.rows.some((r) => r.status !== "identical");
          process.exit(hasDiffs ? 1 : 0);
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

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function formatDiffOutput(
  result: DiffResult,
  envA: string,
  envB: string,
  showIdentical: boolean,
  showValues: boolean,
): void {
  const filteredRows = showIdentical
    ? result.rows
    : result.rows.filter((r) => r.status !== "identical");

  if (filteredRows.length === 0) {
    formatter.success(`No differences between ${envA} and ${envB} for ${result.namespace}`);
    return;
  }

  // Summary
  const changed = result.rows.filter((r) => r.status === "changed").length;
  const missingA = result.rows.filter((r) => r.status === "missing_a").length;
  const missingB = result.rows.filter((r) => r.status === "missing_b").length;
  const identical = result.rows.filter((r) => r.status === "identical").length;

  const parts: string[] = [];
  if (changed > 0) parts.push(`${changed} changed`);
  if (missingA > 0) parts.push(`${missingA} missing in ${envA}`);
  if (missingB > 0) parts.push(`${missingB} missing in ${envB}`);
  if (identical > 0) parts.push(`${identical} identical`);
  formatter.print(`\n${result.namespace}: ${parts.join(", ")}\n`);

  // Table
  const rows: string[][] = [];
  for (const row of filteredRows) {
    let valueA: string;
    let valueB: string;
    let status: string;

    switch (row.status) {
      case "changed":
        valueA = pc.yellow(showValues ? (row.valueA ?? "") : MASKED);
        valueB = pc.cyan(showValues ? (row.valueB ?? "") : MASKED);
        status = `${sym("warning")} ${pc.yellow("changed")}`;
        break;
      case "missing_a":
        valueA = pc.red(pc.italic("(not set)"));
        valueB = showValues ? (row.valueB ?? "") : MASKED;
        status = `${sym("failure")} ${pc.red(`missing in ${envA}`)}`;
        break;
      case "missing_b":
        valueA = showValues ? (row.valueA ?? "") : MASKED;
        valueB = pc.red(pc.italic("(not set)"));
        status = `${sym("failure")} ${pc.red(`missing in ${envB}`)}`;
        break;
      case "identical":
        valueA = showValues ? (row.valueA ?? "") : MASKED;
        valueB = showValues ? (row.valueB ?? "") : MASKED;
        status = `${sym("success")} ${pc.green("identical")}`;
        break;
    }

    rows.push([row.key, valueA, valueB, status]);
  }

  formatter.table(rows, ["Key", envA, envB, "Status"]);

  // Fix hints for missing keys
  const missingRows = result.rows.filter(
    (r) => r.status === "missing_a" || r.status === "missing_b",
  );
  if (missingRows.length > 0) {
    formatter.print("");
    formatter.hint("Fix:");
    for (const row of missingRows) {
      const missingEnv = row.status === "missing_a" ? envA : envB;
      formatter.hint(`clef set ${result.namespace}/${missingEnv} ${row.key} <value>`);
    }
  }
}
