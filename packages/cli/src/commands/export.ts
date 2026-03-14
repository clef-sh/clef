import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  ConsumptionClient,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

export function registerExportCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("export <target>")
    .description(
      "Print decrypted secrets as shell export statements to stdout.\n\n" +
        "  target: namespace/environment (e.g. payments/production)\n\n" +
        "Usage:\n" +
        "  eval $(clef export payments/production --format env)\n\n" +
        "Exit codes:\n" +
        "  0  Values printed successfully\n" +
        "  1  Decryption error or invalid arguments",
    )
    .option("--format <format>", "Output format (only 'env' is supported)", "env")
    .option("--no-export", "Omit the 'export' keyword — output bare KEY=value pairs")
    .action(async (target: string, options: { format: string; export: boolean }) => {
      try {
        // Reject unsupported formats with a clear explanation
        if (options.format !== "env") {
          if (
            options.format === "dotenv" ||
            options.format === "json" ||
            options.format === "yaml"
          ) {
            formatter.error(
              `Format '${options.format}' is not supported. ` +
                "Clef does not support output formats that encourage writing plaintext secrets to disk.\n\n" +
                "Use one of these patterns instead:\n" +
                "  clef exec payments/production -- node server.js  (recommended — injects secrets via env)\n" +
                "  eval $(clef export payments/production --format env)  (shell eval pattern)",
            );
          } else {
            formatter.error(
              `Unknown format '${options.format}'. Only 'env' is supported.\n\n` +
                "Usage: clef export payments/production --format env",
            );
          }
          process.exit(1);
          return;
        }

        const [namespace, environment] = parseTarget(target);
        const repoRoot = (program.opts().dir as string) || process.cwd();

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const filePath = path.join(
          repoRoot,
          manifest.file_pattern
            .replace("{namespace}", namespace)
            .replace("{environment}", environment),
        );

        const sopsClient = new SopsClient(deps.runner);
        const decrypted = await sopsClient.decrypt(filePath);

        const consumption = new ConsumptionClient();
        const output = consumption.formatExport(decrypted, "env", !options.export);

        // Warn on Linux about /proc visibility
        if (process.platform === "linux") {
          formatter.warn(
            "Exported values will be visible in /proc/<pid>/environ to processes with ptrace access. Use clef exec when possible.",
          );
        }

        // Raw output — no labels, no colour
        formatter.raw(output);
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        // Never leak decrypted values in error messages
        const message = err instanceof Error ? err.message : "Export failed";
        formatter.error(message);
        process.exit(1);
      }
    });
}

function parseTarget(target: string): [string, string] {
  const parts = target.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid target "${target}". Expected format: namespace/environment`);
  }
  return [parts[0], parts[1]];
}
