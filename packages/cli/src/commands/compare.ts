import * as path from "path";
import { Command } from "commander";
import { ManifestParser, SubprocessRunner } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import { parseTarget } from "../parse-target";
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
        try {
          const decrypted = await sopsClient.decrypt(filePath);

          if (!(key in decrypted.values)) {
            formatter.error(
              `Key '${key}' not found in ${namespace}/${environment}. Available keys: ${Object.keys(decrypted.values).join(", ") || "(none)"}`,
            );
            process.exit(1);
            return;
          }

          const stored = decrypted.values[key];

          // Constant-time comparison to avoid timing side-channels.
          // Pad both buffers to equal length so the length check itself
          // does not leak the stored value's length via timing.
          const storedBuf = Buffer.from(stored);
          const compareBuf = Buffer.from(compareValue);
          const maxLen = Math.max(storedBuf.length, compareBuf.length, 1);
          const paddedStored = Buffer.alloc(maxLen);
          const paddedCompare = Buffer.alloc(maxLen);
          storedBuf.copy(paddedStored);
          compareBuf.copy(paddedCompare);
          // Always execute timingSafeEqual regardless of length — the &&
          // short-circuit would leak whether lengths matched via timing.
          const timingEqual = crypto.timingSafeEqual(paddedStored, paddedCompare);
          const match = storedBuf.length === compareBuf.length && timingEqual;

          if (isJsonMode()) {
            formatter.json({ match, key, namespace, environment });
            if (!match) process.exit(1);
          } else if (match) {
            formatter.success(`${key} ${sym("arrow")} values match`);
          } else {
            formatter.failure(`${key} ${sym("arrow")} values do not match`);
            process.exit(1);
          }
        } finally {
          // no cleanup needed
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
