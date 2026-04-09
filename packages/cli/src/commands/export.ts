import * as path from "path";
import { Command } from "commander";
import { ManifestParser, ConsumptionClient, SubprocessRunner } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { createCloudAwareSopsClient } from "../cloud-sops";
import { copyToClipboard } from "../clipboard";
import { parseTarget } from "../parse-target";

export function registerExportCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("export <target>")
    .description(
      "Export decrypted secrets as shell export statements.\n\n" +
        "  target: namespace/environment (e.g. payments/production)\n\n" +
        "By default, exports are copied to clipboard. Use --raw to print to stdout.\n\n" +
        "Usage:\n" +
        "  clef export payments/production             (copies to clipboard)\n" +
        "  eval $(clef export payments/production --raw)  (injects into shell)\n\n" +
        "Exit codes:\n" +
        "  0  Values exported successfully\n" +
        "  1  Decryption error or invalid arguments",
    )
    .option("--format <format>", "Output format (only 'env' is supported)", "env")
    .option("--no-export", "Omit the 'export' keyword — output bare KEY=value pairs")
    .option("--raw", "Print to stdout instead of clipboard (for eval/piping)")
    .action(async (target: string, options: { format: string; export: boolean; raw?: boolean }) => {
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

        const { client: sopsClient, cleanup } = await createCloudAwareSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const decrypted = await sopsClient.decrypt(filePath);

          if (isJsonMode()) {
            const pairs = Object.entries(decrypted.values).map(([k, v]) => ({
              key: k,
              value: v,
            }));
            formatter.json({ pairs, namespace, environment });
            return;
          }

          const consumption = new ConsumptionClient();
          const output = consumption.formatExport(decrypted, "env", !options.export);

          if (options.raw) {
            // Warn on Linux about /proc visibility
            if (process.platform === "linux") {
              formatter.warn(
                "Exported values will be visible in /proc/<pid>/environ to processes with ptrace access. Use clef exec when possible.",
              );
            }
            formatter.raw(output);
          } else {
            const keyCount = Object.keys(decrypted.values).length;
            const copied = copyToClipboard(output);
            if (copied) {
              formatter.success(`${keyCount} secret(s) copied to clipboard as env exports.`);
              formatter.hint("eval $(clef export " + target + " --raw)  to inject into shell");
            } else {
              // Clipboard unavailable — fall back to raw output
              if (process.platform === "linux") {
                formatter.warn(
                  "Exported values will be visible in /proc/<pid>/environ to processes with ptrace access. Use clef exec when possible.",
                );
              }
              formatter.raw(output);
            }
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
