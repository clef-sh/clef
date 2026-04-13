import * as path from "path";
import { Command } from "commander";
import { ManifestParser, SubprocessRunner } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { createSopsClient } from "../age-credential";
import { copyToClipboard, maskedPlaceholder } from "../clipboard";
import { parseTarget } from "../parse-target";

export function registerGetCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("get <target> <key>")
    .description(
      "Get a single decrypted value.\n\n" +
        "  target: namespace/environment (e.g. payments/production)\n" +
        "  key:    the key name to retrieve\n\n" +
        "By default, the value is copied to clipboard and obfuscated on screen.\n" +
        "Use --raw to print the plaintext value to stdout.\n\n" +
        "Exit codes:\n" +
        "  0  Value found\n" +
        "  1  Key not found or decryption error",
    )
    .option("--raw", "Print the plaintext value to stdout (for piping/scripting)")
    .action(async (target: string, key: string, opts: { raw?: boolean }) => {
      try {
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

        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        try {
          const decrypted = await sopsClient.decrypt(filePath);

          if (!(key in decrypted.values)) {
            formatter.error(
              `Key '${key}' not found in ${namespace}/${environment}. Available keys: ${Object.keys(decrypted.values).join(", ") || "(none)"}`,
            );
            process.exit(1);
            return;
          }

          const val = decrypted.values[key];
          if (isJsonMode()) {
            formatter.json({ key, value: val, namespace, environment });
          } else if (opts.raw) {
            formatter.raw(val);
          } else {
            const copied = copyToClipboard(val);
            if (copied) {
              formatter.print(`  ${key}: ${maskedPlaceholder()} (copied to clipboard)`);
            } else {
              formatter.keyValue(key, val);
            }
          }
        } finally {
          // no cleanup needed
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
