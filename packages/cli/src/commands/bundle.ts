import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  MatrixManager,
  BundleGenerator,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

export function registerBundleCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("bundle <identity> <environment>")
    .description(
      "Generate a runtime JS module with encrypted secrets for a service identity.\n\n" +
        "  The generated module uses age-encryption (pure JS) to decrypt at runtime.\n" +
        "  No sops binary or git repository needed in the target environment.\n\n" +
        "Usage:\n" +
        "  clef bundle api-gateway production --output ./secrets.mjs\n" +
        "  clef bundle api-gateway dev --output ./secrets.cjs --format cjs",
    )
    .requiredOption("-o, --output <path>", "Output file path for the generated module")
    .option("--format <format>", 'Module format: "esm" or "cjs"', "esm")
    .action(
      async (identity: string, environment: string, opts: { output: string; format: string }) => {
        try {
          if (opts.format !== "esm" && opts.format !== "cjs") {
            formatter.error(`Invalid format '${opts.format}'. Must be 'esm' or 'cjs'.`);
            process.exit(1);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const matrixManager = new MatrixManager();
          const generator = new BundleGenerator(sopsClient, matrixManager);

          const outputPath = path.resolve(opts.output);

          formatter.print(
            `${sym("working")}  Generating bundle for '${identity}/${environment}'...`,
          );

          const result = await generator.generate(
            {
              identity,
              environment,
              outputPath,
              format: opts.format as "esm" | "cjs",
            },
            manifest,
            repoRoot,
          );

          formatter.success(
            `Bundle generated: ${result.keyCount} keys from ${result.namespaceCount} namespace(s).`,
          );
          formatter.print(`  Output: ${result.outputPath}`);
          formatter.print(`  Size:   ${(result.bundleSize / 1024).toFixed(1)} KB`);
          formatter.print(`  Format: ${opts.format.toUpperCase()}`);

          formatter.warn(
            "\nThe bundle contains encrypted secrets. Do NOT commit it to version control.",
          );
          formatter.hint("Add the output path to .gitignore.");
        } catch (err) {
          if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
            formatter.formatDependencyError(err);
            process.exit(1);
            return;
          }
          const message = err instanceof Error ? err.message : "Bundle generation failed";
          formatter.error(message);
          process.exit(1);
        }
      },
    );
}
