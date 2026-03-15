import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

export function registerRotateCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("rotate <target>")
    .description(
      "Rotate encryption key for a namespace/environment file.\n\n" +
        "  target:     namespace/environment (e.g. payments/production)\n" +
        "  --new-key:  the new age public key to add (required)\n\n" +
        "Exit codes:\n" +
        "  0  key rotated successfully\n" +
        "  1  operation failed",
    )
    .requiredOption("--new-key <key>", "New age public key to rotate to")
    .action(async (target: string, options: { newKey: string }) => {
      try {
        const [namespace, environment] = parseTarget(target);
        const repoRoot = (program.opts().dir as string) || process.cwd();

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        // Check for protected environment
        const matrixManager = new MatrixManager();
        if (matrixManager.isProtectedEnvironment(manifest, environment)) {
          const confirmed = await formatter.confirm(
            `${environment} is a protected environment. Rotate key anyway?`,
          );
          if (!confirmed) {
            formatter.info("Rotation cancelled.");
            return;
          }
        }

        const filePath = path.join(
          repoRoot,
          manifest.file_pattern
            .replace("{namespace}", namespace)
            .replace("{environment}", environment),
        );

        const sopsClient = await createSopsClient(repoRoot, deps.runner);

        const relativeFile = manifest.file_pattern
          .replace("{namespace}", namespace)
          .replace("{environment}", environment);

        formatter.print(`${sym("working")}  Rotating ${namespace}/${environment}...`);

        await sopsClient.reEncrypt(filePath, options.newKey);

        formatter.success(`Rotated. New values encrypted. ${sym("locked")}`);
        formatter.hint(
          `git add ${relativeFile} && git commit -m "rotate: ${namespace}/${environment}"`,
        );
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
