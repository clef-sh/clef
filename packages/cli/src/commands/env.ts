import * as path from "path";
import { Command } from "commander";
import {
  GitIntegration,
  ManifestParser,
  MatrixManager,
  StructureManager,
  SubprocessRunner,
  TransactionManager,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";

export function registerEnvCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  const envCmd = program.command("env").description("Manage environments declared in clef.yaml.");

  // --- edit ---
  envCmd
    .command("edit <name>")
    .description(
      "Edit an environment's metadata in clef.yaml. Optionally rename it " +
        "(which renames every cell file across every namespace and updates every " +
        "service identity that references it).",
    )
    .option("--rename <newName>", "Rename the environment (and all cell files)")
    .option("--description <text>", "Replace the environment's description")
    .option("--protect", "Mark the environment as protected (write ops require confirmation)")
    .option("--unprotect", "Remove the protected flag from the environment")
    .action(
      async (
        name: string,
        opts: {
          rename?: string;
          description?: string;
          protect?: boolean;
          unprotect?: boolean;
        },
      ) => {
        try {
          if (opts.protect && opts.unprotect) {
            formatter.error("Cannot pass --protect and --unprotect at the same time.");
            process.exit(2);
            return;
          }
          if (
            opts.rename === undefined &&
            opts.description === undefined &&
            !opts.protect &&
            !opts.unprotect
          ) {
            formatter.error(
              "Nothing to edit. Pass --rename, --description, --protect, or --unprotect.",
            );
            process.exit(2);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const matrixManager = new MatrixManager();
          const tx = new TransactionManager(new GitIntegration(deps.runner));
          const structure = new StructureManager(matrixManager, tx);

          // Translate the two boolean flags into the StructureManager's
          // single tri-state `protected` option (undefined / true / false).
          const protectedFlag = opts.protect ? true : opts.unprotect ? false : undefined;

          await structure.editEnvironment(
            name,
            {
              rename: opts.rename,
              description: opts.description,
              protected: protectedFlag,
            },
            manifest,
            repoRoot,
          );

          if (isJsonMode()) {
            formatter.json({
              action: "edited",
              kind: "environment",
              name: opts.rename ?? name,
              previousName: opts.rename ? name : undefined,
              changes: {
                ...(opts.rename ? { rename: opts.rename } : {}),
                ...(opts.description !== undefined ? { description: opts.description } : {}),
                ...(protectedFlag !== undefined ? { protected: protectedFlag } : {}),
              },
            });
            return;
          }

          const finalName = opts.rename ?? name;
          if (opts.rename) {
            formatter.success(`Renamed environment '${name}' → '${finalName}'`);
          }
          if (opts.description !== undefined) {
            formatter.success(`Updated description on environment '${finalName}'`);
          }
          if (protectedFlag === true) {
            formatter.success(`Marked environment '${finalName}' as protected`);
          } else if (protectedFlag === false) {
            formatter.success(`Removed protected flag from environment '${finalName}'`);
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
