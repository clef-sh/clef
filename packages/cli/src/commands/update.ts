import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SopsClient,
  SubprocessRunner,
  SopsMissingError,
  SopsVersionError,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { resolveAgeCredential, prepareSopsClientArgs } from "../age-credential";

export function registerUpdateCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("update")
    .description(
      "Scaffold any missing matrix cells from the existing manifest.\n\n" +
        "Run after adding environments or namespaces to clef.yaml.\n\n" +
        "Exit codes:\n" +
        "  0  All cells up to date or newly scaffolded\n" +
        "  1  Error reading manifest or scaffolding files",
    )
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const manifestPath = path.join(repoRoot, "clef.yaml");

        if (!fs.existsSync(manifestPath)) {
          formatter.error("clef.yaml not found. Run 'clef init' to initialise this repository.");
          process.exit(1);
          return;
        }

        const parser = new ManifestParser();
        const manifest = parser.parse(manifestPath);

        const credential =
          manifest.sops.default_backend === "age"
            ? await resolveAgeCredential(repoRoot, deps.runner)
            : null;
        const { ageKeyFile, ageKey } = prepareSopsClientArgs(credential);
        const sopsClient = new SopsClient(deps.runner, ageKeyFile, ageKey);
        const matrixManager = new MatrixManager();
        const cells = matrixManager.resolveMatrix(manifest, repoRoot);
        const missing = cells.filter((c) => !c.exists);

        if (missing.length === 0) {
          formatter.success("Matrix is up to date.");
          process.exit(0);
          return;
        }

        let scaffoldedCount = 0;
        let failedCount = 0;
        for (const cell of missing) {
          try {
            await matrixManager.scaffoldCell(cell, sopsClient, manifest);
            scaffoldedCount++;
          } catch (err) {
            failedCount++;
            formatter.warn(
              `Could not scaffold ${cell.namespace}/${cell.environment}: ${(err as Error).message}`,
            );
          }
        }

        if (scaffoldedCount > 0) {
          formatter.success(`Scaffolded ${scaffoldedCount} encrypted file(s)`);
        }

        if (failedCount === 0) {
          process.exit(0);
          return;
        }

        if (failedCount > 0) {
          formatter.error(`${failedCount} cell(s) could not be scaffolded.`);
          process.exit(1);
          return;
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
