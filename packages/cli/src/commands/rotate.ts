import * as path from "path";
import { Command } from "commander";
import { ManifestParser, MatrixManager, SubprocessRunner } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import { parseTarget } from "../parse-target";

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
        try {
          const relativeFile = manifest.file_pattern
            .replace("{namespace}", namespace)
            .replace("{environment}", environment);

          formatter.print(`${sym("working")}  Rotating ${namespace}/${environment}...`);

          await sopsClient.reEncrypt(filePath, options.newKey);

          if (isJsonMode()) {
            formatter.json({ namespace, environment, file: relativeFile, action: "rotated" });
            return;
          }
          formatter.success(`Rotated. New values encrypted. ${sym("locked")}`);
          formatter.hint(
            `git add ${relativeFile} && git commit -m "rotate: ${namespace}/${environment}"`,
          );
        } finally {
          // no cleanup needed
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
