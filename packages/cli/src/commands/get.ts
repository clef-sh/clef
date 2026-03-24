import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { createSopsClient } from "../age-credential";
import { copyToClipboard, maskedPlaceholder } from "../clipboard";

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
        const decrypted = await sopsClient.decrypt(filePath);

        if (!(key in decrypted.values)) {
          formatter.error(
            `Key '${key}' not found in ${namespace}/${environment}. Available keys: ${Object.keys(decrypted.values).join(", ") || "(none)"}`,
          );
          process.exit(1);
          return;
        }

        const val = decrypted.values[key];
        if (opts.raw) {
          formatter.raw(val);
        } else {
          const copied = copyToClipboard(val);
          if (copied) {
            formatter.print(`  ${key}: ${maskedPlaceholder()} (copied to clipboard)`);
          } else {
            formatter.keyValue(key, val);
          }
        }
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

function parseTarget(target: string): [string, string] {
  const parts = target.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid target "${target}". Expected format: namespace/environment`);
  }
  return [parts[0], parts[1]];
}
