import * as path from "path";
import pc from "picocolors";
import { Command } from "commander";
import { DriftDetector, DriftResult, SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { driftResultToOtlp, pushOtlp, resolveTelemetryConfig } from "../output/otlp";
import { version as cliVersion } from "../../package.json";

export function registerDriftCommand(program: Command, _deps: { runner: SubprocessRunner }): void {
  program
    .command("drift <path>")
    .description(
      "Compare key sets across two local Clef repos without decryption.\n\n" +
        "Reads encrypted YAML files as plaintext (key names are not encrypted)\n" +
        "and reports keys that exist in some environments but not others.\n\n" +
        "Does not require sops to be installed.\n\n" +
        "Exit codes:\n" +
        "  0  No drift\n" +
        "  1  Drift found",
    )
    .option("--json", "Output raw DriftResult JSON for CI parsing")
    .option("--push", "Push results as OTLP to CLEF_TELEMETRY_URL")
    .option("--namespace <name...>", "Scope to specific namespace(s)")
    .action(
      async (
        remotePath: string,
        options: { json?: boolean; push?: boolean; namespace?: string[] },
      ) => {
        try {
          const localRoot = (program.opts().dir as string) || process.cwd();
          const remoteRoot = path.resolve(localRoot, remotePath);

          const detector = new DriftDetector();
          const result = detector.detect(localRoot, remoteRoot, options.namespace);

          if (options.push) {
            const config = resolveTelemetryConfig();
            if (!config) {
              formatter.error("--push requires CLEF_TELEMETRY_URL to be set.");
              process.exit(1);
              return;
            }
            const payload = driftResultToOtlp(result, cliVersion);
            await pushOtlp(payload, config);
            formatter.success("Drift results pushed to telemetry endpoint.");
          }

          if (options.json) {
            formatter.raw(JSON.stringify(result, null, 2) + "\n");
            process.exit(result.issues.length > 0 ? 1 : 0);
            return;
          }

          formatDriftOutput(result);
          process.exit(result.issues.length > 0 ? 1 : 0);
        } catch (err) {
          formatter.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}

function formatDriftOutput(result: DriftResult): void {
  if (result.namespacesCompared === 0) {
    formatter.warn("No shared namespaces found between the two repositories.");
    return;
  }

  if (result.issues.length === 0) {
    formatter.success(
      `No drift \u2014 ${result.namespacesCompared} namespace(s) compared, all keys aligned`,
    );
    return;
  }

  formatter.print("");
  formatter.print(
    pc.red(pc.bold(`${sym("failure")} ${result.issues.length} drift issue(s) found`)),
  );

  // Group by namespace
  const byNamespace = new Map<string, DriftResult["issues"]>();
  for (const issue of result.issues) {
    if (!byNamespace.has(issue.namespace)) byNamespace.set(issue.namespace, []);
    byNamespace.get(issue.namespace)!.push(issue);
  }

  for (const [ns, issues] of byNamespace) {
    formatter.print("");
    formatter.print(pc.bold(`  ${ns}`));
    for (const issue of issues) {
      formatter.print(`    ${pc.red(sym("failure"))} ${pc.white(issue.key)}`);
      formatter.print(`      present in: ${issue.presentIn.join(", ")}`);
      formatter.print(`      missing from: ${pc.red(issue.missingFrom.join(", "))}`);
    }
  }

  formatter.print("");
  formatter.print(
    `${result.namespacesCompared} namespace(s) compared, ${result.namespacesClean} clean`,
  );
}
