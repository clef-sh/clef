import * as path from "path";
import { Command } from "commander";
import {
  ClefManifest,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  StructureManager,
  SubprocessRunner,
  TransactionManager,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { createSopsClient } from "../age-credential";

/** Build a StructureManager wired with sops client + transaction manager. */
async function makeStructureManager(
  repoRoot: string,
  runner: SubprocessRunner,
  manifest?: ClefManifest,
): Promise<{ structure: StructureManager; cleanup: () => Promise<void> }> {
  const { client: sopsClient, cleanup } = await createSopsClient(repoRoot, runner, manifest);
  const matrixManager = new MatrixManager();
  const tx = new TransactionManager(new GitIntegration(runner));
  return { structure: new StructureManager(matrixManager, sopsClient, tx), cleanup };
}

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

          const { structure, cleanup } = await makeStructureManager(
            repoRoot,
            deps.runner,
            manifest,
          );
          try {
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
          } finally {
            await cleanup();
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );

  // --- add ---
  envCmd
    .command("add <name>")
    .description(
      "Create a new environment and scaffold an empty encrypted cell for every " +
        "existing namespace. Refuses if the name already exists or any of the " +
        "target cell files are already on disk. Does NOT cascade to service " +
        "identities — `clef lint` reports the gap and `clef service update " +
        "--add-env` (Phase 1c) closes it explicitly.",
    )
    .option("--description <text>", "Human-readable description for the new environment", "")
    .option("--protect", "Mark the new environment as protected from creation")
    .action(async (name: string, opts: { description: string; protect?: boolean }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const { structure, cleanup } = await makeStructureManager(repoRoot, deps.runner, manifest);
        try {
          await structure.addEnvironment(
            name,
            { description: opts.description, protected: opts.protect },
            manifest,
            repoRoot,
          );

          if (isJsonMode()) {
            formatter.json({
              action: "added",
              kind: "environment",
              name,
              cellsScaffolded: manifest.namespaces.length,
              protected: opts.protect ?? false,
            });
            return;
          }

          formatter.success(
            `Added environment '${name}' (${manifest.namespaces.length} cell${manifest.namespaces.length === 1 ? "" : "s"} scaffolded)`,
          );
          if (opts.protect) {
            formatter.print(`  Marked as protected.`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- remove ---
  envCmd
    .command("remove <name>")
    .alias("rm")
    .description(
      "Delete an environment, all of its encrypted cell files (across every " +
        "namespace), and remove the env entry from every service identity. " +
        "Refuses on protected environments — run `clef env edit <name> " +
        "--unprotect` first.",
    )
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (name: string, opts: { yes?: boolean }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (!opts.yes) {
          const env = manifest.environments.find((e) => e.name === name);
          const cellCount = env ? manifest.namespaces.length : 0;
          const confirmed = await formatter.confirm(
            `Delete environment '${name}' and ${cellCount} encrypted cell${cellCount === 1 ? "" : "s"}? This cannot be undone outside of git history.`,
          );
          if (!confirmed) {
            formatter.info("Aborted.");
            return;
          }
        }

        const { structure, cleanup } = await makeStructureManager(repoRoot, deps.runner, manifest);
        try {
          await structure.removeEnvironment(name, manifest, repoRoot);

          if (isJsonMode()) {
            formatter.json({ action: "removed", kind: "environment", name });
            return;
          }
          formatter.success(`Removed environment '${name}'`);
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
