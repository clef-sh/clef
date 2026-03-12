import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import {
  ClefLocalConfig,
  ManifestParser,
  MatrixManager,
  SopsClient,
  SubprocessRunner,
  SopsMissingError,
  SopsVersionError,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

const CLEF_DIR = ".clef";
const CLEF_CONFIG_FILENAME = "config.yaml";

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
        const repoRoot = (program.opts().repo as string) || process.cwd();
        const manifestPath = path.join(repoRoot, "clef.yaml");

        if (!fs.existsSync(manifestPath)) {
          formatter.error("clef.yaml not found. Run 'clef init' to initialise this repository.");
          process.exit(1);
          return;
        }

        const parser = new ManifestParser();
        const manifest = parser.parse(manifestPath);

        // Read ageKeyFile from .clef/config.yaml if present and env vars not already set
        let ageKeyFile: string | undefined;
        if (
          manifest.sops.default_backend === "age" &&
          !process.env.SOPS_AGE_KEY &&
          !process.env.SOPS_AGE_KEY_FILE
        ) {
          const clefConfigPath = path.join(repoRoot, CLEF_DIR, CLEF_CONFIG_FILENAME);
          if (fs.existsSync(clefConfigPath)) {
            try {
              const config = YAML.parse(
                fs.readFileSync(clefConfigPath, "utf-8"),
              ) as ClefLocalConfig;
              ageKeyFile = config?.age_key_file;
            } catch {
              // ignore parse errors
            }
          }
        }

        const sopsClient = new SopsClient(deps.runner, ageKeyFile);
        const matrixManager = new MatrixManager();
        const cells = matrixManager.resolveMatrix(manifest, repoRoot);
        const missing = cells.filter((c) => !c.exists);

        if (missing.length === 0) {
          formatter.success("Matrix is up to date.");
          return;
        }

        let scaffoldedCount = 0;
        for (const cell of missing) {
          try {
            await matrixManager.scaffoldCell(cell, sopsClient);
            scaffoldedCount++;
          } catch (err) {
            formatter.warn(
              `Could not scaffold ${cell.namespace}/${cell.environment}: ${(err as Error).message}`,
            );
          }
        }

        if (scaffoldedCount > 0) {
          formatter.success(`Scaffolded ${scaffoldedCount} encrypted file(s)`);
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
