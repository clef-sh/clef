import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import {
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  TransactionManager,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { createSecretSource } from "../source-factory";

export function registerUpdateCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("update")
    .description(
      "Scaffold any missing matrix cells from the existing manifest.\n\n" +
        "Run after adding environments or namespaces to clef.yaml.\n\n" +
        "Exit codes:\n" +
        "  0  All cells up to date or newly scaffolded\n" +
        "  1  Error reading manifest, preflight failure, or scaffolding files",
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

        const { source, cleanup } = await createSecretSource(repoRoot, deps.runner, manifest);
        const matrixManager = new MatrixManager();
        const cells = matrixManager.resolveMatrix(manifest, repoRoot);
        const missing = cells.filter((c) => !c.exists);

        if (missing.length === 0) {
          formatter.success("Matrix is up to date.");
          return;
        }

        // Paths are repo-relative because TransactionManager passes them to
        // `git add` / `git clean -f`, both of which want repo-relative paths.
        const paths = missing.map((c) => path.relative(repoRoot, c.filePath));
        const description =
          missing.length === 1
            ? `clef update: scaffold ${missing[0].namespace}/${missing[0].environment}`
            : `clef update: scaffold ${missing.length} matrix cells`;

        try {
          const tx = new TransactionManager(new GitIntegration(deps.runner));
          const result = await tx.run(repoRoot, {
            description,
            paths,
            mutate: async () => {
              for (const cell of missing) {
                await source.scaffoldCell(
                  { namespace: cell.namespace, environment: cell.environment },
                  manifest,
                );
              }
            },
          });

          if (isJsonMode()) {
            formatter.json({
              scaffolded: missing.length,
              sha: result.sha,
              paths: result.paths,
            });
            return;
          }

          formatter.success(`Scaffolded ${missing.length} encrypted file(s)`);
          if (result.sha) {
            formatter.print(`  Committed as ${result.sha.slice(0, 7)}`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
