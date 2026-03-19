import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  ImportRunner,
  ImportFormat,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export function registerImportCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("import <target> [source]")
    .description(
      "Bulk-import secrets from a file (dotenv, JSON, or YAML) into an encrypted SOPS file.\n\n" +
        "  target: namespace/environment (e.g. database/staging)\n" +
        "  source: path to the source file (required unless --stdin is used)\n\n" +
        "Exit codes:\n" +
        "  0  Success or dry run complete\n" +
        "  1  Partial failure (some keys failed to encrypt)\n" +
        "  2  Could not start (missing manifest, invalid target, file not found, parse error)",
    )
    .option("--format <format>", "Override format detection (dotenv, json, yaml)")
    .option("--prefix <string>", "Only import keys starting with this prefix")
    .option("--keys <keys>", "Only import specific keys (comma-separated)")
    .option("--overwrite", "Overwrite existing keys", false)
    .option("--dry-run", "Preview without encrypting", false)
    .option("--stdin", "Read source from stdin", false)
    .action(
      async (
        target: string,
        source: string | undefined,
        opts: {
          format?: string;
          prefix?: string;
          keys?: string;
          overwrite: boolean;
          dryRun: boolean;
          stdin: boolean;
        },
      ) => {
        try {
          // Validate target format
          const parts = target.split("/");
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            formatter.error(
              `Invalid target '${target}'. Expected format: namespace/environment (e.g. database/staging)`,
            );
            process.exit(2);
            return;
          }
          const [namespace, environment] = parts;

          // Validate format option
          const validFormats = ["dotenv", "json", "yaml"];
          if (opts.format && !validFormats.includes(opts.format)) {
            formatter.error(
              `Unknown format '${opts.format}'. Supported formats: dotenv, json, yaml`,
            );
            process.exit(2);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();

          const parser = new ManifestParser();
          let manifest;
          try {
            manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
          } catch (err) {
            formatter.error((err as Error).message);
            process.exit(2);
            return;
          }

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

          // Read source content
          let content: string;
          let sourcePath: string | null = null;

          if (opts.stdin) {
            content = await readStdin();
          } else if (source) {
            if (!fs.existsSync(source)) {
              formatter.error(`Source file not found: ${source}`);
              process.exit(2);
              return;
            }
            try {
              content = fs.readFileSync(source, "utf-8");
              sourcePath = source;
            } catch (err) {
              formatter.error(`Could not read source file: ${(err as Error).message}`);
              process.exit(2);
              return;
            }
          } else {
            formatter.error(
              "No source specified. Provide a file path or use --stdin to read from stdin.",
            );
            process.exit(2);
            return;
          }

          // Parse keys option
          const keysFilter = opts.keys ? opts.keys.split(",").map((k) => k.trim()) : undefined;

          const sourceLabel = sourcePath ? path.basename(sourcePath) : "stdin";

          if (opts.dryRun) {
            formatter.print(`Dry run — nothing will be encrypted.`);
            formatter.print(
              `Previewing import to ${namespace}/${environment} from ${sourceLabel}...\n`,
            );
          } else {
            formatter.print(`Importing to ${namespace}/${environment} from ${sourceLabel}...\n`);
          }

          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const importRunner = new ImportRunner(sopsClient);

          let result;
          try {
            result = await importRunner.import(target, sourcePath, content, manifest, repoRoot, {
              format: opts.format as ImportFormat | undefined,
              prefix: opts.prefix,
              keys: keysFilter,
              overwrite: opts.overwrite,
              dryRun: opts.dryRun,
            });
          } catch (err) {
            // Re-throw dependency errors so the outer handler can format them
            if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
              throw err;
            }
            formatter.error((err as Error).message);
            process.exit(2);
            return;
          }

          // Show warnings
          for (const warning of result.warnings) {
            formatter.print(`  ${sym("warning")}  ${warning}`);
          }

          if (opts.dryRun) {
            // Show dry run preview
            for (const key of result.imported) {
              formatter.print(`   ${sym("arrow")}  ${key.padEnd(20)} would import`);
            }
            for (const key of result.skipped) {
              formatter.print(
                `   ${sym("skipped")}  ${key.padEnd(20)} would skip \u2014 already exists`,
              );
            }

            formatter.print(
              `\nDry run complete: ${result.imported.length} would import, ${result.skipped.length} would skip.`,
            );
            formatter.print(`Run without --dry-run to apply.`);
          } else {
            // Show actual import results
            for (const key of result.imported) {
              formatter.print(`   ${sym("success")}  ${key.padEnd(12)} ${sym("locked")}  imported`);
            }
            for (const key of result.skipped) {
              formatter.print(
                `   ${sym("skipped")}  ${key.padEnd(12)}     skipped \u2014 already exists (--overwrite to replace)`,
              );
            }
            for (const { key, error: keyError } of result.failed) {
              formatter.print(
                `   ${sym("failure")}  ${key.padEnd(12)}     failed \u2014 encrypt error: ${keyError}`,
              );
            }

            formatter.print(
              `\n${result.imported.length} imported, ${result.skipped.length} skipped, ${result.failed.length} failed.`,
            );

            if (result.failed.length > 0) {
              for (const { key } of result.failed) {
                formatter.hint(`clef set ${target} ${key}   (retry failed key)`);
              }
              process.exit(1);
            }
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
