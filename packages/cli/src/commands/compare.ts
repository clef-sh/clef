import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import * as crypto from "crypto";

export function registerCompareCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("compare <target> <key> [value]")
    .description(
      "Compare a stored secret with a supplied value.\n\n" +
        "  target: namespace/environment (e.g. payments/staging)\n" +
        "  key:    the key name to compare\n" +
        "  value:  optional — if omitted, prompts with hidden input\n\n" +
        "Neither value is ever printed to stdout.\n\n" +
        "Exit codes:\n" +
        "  0  values match\n" +
        "  1  values do not match or operation failed",
    )
    .action(async (target: string, key: string, value: string | undefined) => {
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

        if (value !== undefined) {
          formatter.warn(
            "Value passed as a command-line argument is visible in shell history.\n" +
              `  Consider using the interactive prompt instead: clef compare ${target} ${key}`,
          );
        }

        let compareValue: string;
        if (value === undefined) {
          compareValue = await formatter.secretPrompt(`Enter value to compare for ${key}`);
        } else {
          compareValue = value;
        }

        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const decrypted = await sopsClient.decrypt(filePath);

        if (!(key in decrypted.values)) {
          formatter.error(
            `Key '${key}' not found in ${namespace}/${environment}. Available keys: ${Object.keys(decrypted.values).join(", ") || "(none)"}`,
          );
          process.exit(1);
          return;
        }

        const stored = decrypted.values[key];

        // Constant-time comparison to avoid timing side-channels
        const match =
          stored.length === compareValue.length &&
          crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(compareValue));

        if (match) {
          formatter.success(`${key} ${sym("arrow")} values match`);
        } else {
          formatter.failure(`${key} ${sym("arrow")} values do not match`);
          process.exit(1);
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
