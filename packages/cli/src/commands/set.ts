import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  generateRandomValue,
  markPendingWithRetry,
  markResolved,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerSetCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("set <target> <key> [value]")
    .description(
      "Set a secret value. If value is omitted, prompts securely (hidden input).\n\n" +
        "  target: namespace/environment (e.g. payments/staging)\n" +
        "  key:    the key name to set\n" +
        "  value:  optional — if omitted, prompts with hidden input\n\n" +
        "The plaintext value is never written to disk or printed to stdout.\n\n" +
        "Exit codes:\n" +
        "  0  value set successfully\n" +
        "  1  operation failed",
    )
    .option(
      "--random",
      "Generate a cryptographically random placeholder value and mark the key as pending",
    )
    .action(
      async (
        target: string,
        key: string,
        value: string | undefined,
        opts: { random?: boolean },
      ) => {
        try {
          if (opts.random && value !== undefined) {
            formatter.error(
              "Cannot use --random and provide a value simultaneously.\n" +
                "Use --random to generate a placeholder, or provide a value to set it directly.",
            );
            process.exit(1);
            return;
          }

          if (value !== undefined && !opts.random) {
            formatter.warn(
              "Secret passed as a command-line argument is visible in shell history.\n" +
                `  Consider using the interactive prompt instead: clef set ${target} ${key}`,
            );
          }

          const [namespace, environment] = parseTarget(target);
          const repoRoot = (program.opts().dir as string) || process.cwd();

          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          // Check for protected environment
          const matrixManager = new MatrixManager();
          if (matrixManager.isProtectedEnvironment(manifest, environment)) {
            const confirmed = await formatter.confirm(
              `This is a protected environment (${environment}). Confirm?`,
            );
            if (!confirmed) {
              formatter.info("Aborted.");
              return;
            }
          }

          // Determine the value
          let secretValue: string;
          let isPendingValue = false;

          if (opts.random) {
            secretValue = generateRandomValue();
            isPendingValue = true;
          } else if (value === undefined) {
            secretValue = await formatter.secretPrompt(`Enter value for ${key}`);
          } else {
            secretValue = value;
          }

          const filePath = path.join(
            repoRoot,
            manifest.file_pattern
              .replace("{namespace}", namespace)
              .replace("{environment}", environment),
          );

          const sopsClient = new SopsClient(deps.runner);
          const decrypted = await sopsClient.decrypt(filePath);
          decrypted.values[key] = secretValue;
          await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);

          // Update pending metadata
          if (isPendingValue) {
            try {
              await markPendingWithRetry(filePath, [key], "clef set --random");
            } catch {
              formatter.warn(
                `${key} was encrypted but pending state could not be recorded.\n` +
                  "  The value is set but will not appear as pending in the UI or lint.\n" +
                  "  To manually mark it pending, edit .clef-meta.yaml.",
              );
            }
            formatter.success(`${key} set in ${namespace}/${environment} ${sym("locked")}`);
            formatter.print(
              `   ${sym("pending")}  Marked as pending \u2014 replace with a real value before deploying`,
            );
            formatter.hint(`clef set ${namespace}/${environment} ${key}`);
          } else {
            // Normal set resolves any pending state for this key
            await markResolved(filePath, [key]);
            formatter.success(`${key} set in ${namespace}/${environment}`);
            formatter.hint(
              `Commit: git add ${manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", environment)}`,
            );
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
      },
    );
}

function parseTarget(target: string): [string, string] {
  const parts = target.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid target "${target}". Expected format: namespace/environment`);
  }
  return [parts[0], parts[1]];
}
