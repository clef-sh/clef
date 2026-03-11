import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  AgeMissingError,
  AgeVersionError,
  assertAge,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

export function registerGetCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("get <target> <key>")
    .description(
      "Get a single decrypted value. Output is raw (no labels, no colour) for piping.\n\n" +
        "  target: namespace/environment (e.g. payments/production)\n" +
        "  key:    the key name to retrieve\n\n" +
        "Exit codes:\n" +
        "  0  Value found and printed\n" +
        "  1  Key not found or decryption error",
    )
    .action(async (target: string, key: string) => {
      try {
        const [namespace, environment] = parseTarget(target);
        const repoRoot = (program.opts().repo as string) || process.cwd();

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (manifest.sops.default_backend === "age") {
          await assertAge(deps.runner);
        }

        const filePath = path.join(
          repoRoot,
          manifest.file_pattern
            .replace("{namespace}", namespace)
            .replace("{environment}", environment),
        );

        const sopsClient = new SopsClient(deps.runner);
        const decrypted = await sopsClient.decrypt(filePath);

        if (!(key in decrypted.values)) {
          formatter.error(
            `Key '${key}' not found in ${namespace}/${environment}. Available keys: ${Object.keys(decrypted.values).join(", ") || "(none)"}`,
          );
          process.exit(1);
          return;
        }

        formatter.keyValue(key, decrypted.values[key]);
      } catch (err) {
        if (
          err instanceof SopsMissingError ||
          err instanceof SopsVersionError ||
          err instanceof AgeMissingError ||
          err instanceof AgeVersionError
        ) {
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
