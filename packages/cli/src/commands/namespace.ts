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

export function registerNamespaceCommand(
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  const nsCmd = program
    .command("namespace")
    .alias("ns")
    .description("Manage namespaces declared in clef.yaml.");

  // --- edit ---
  nsCmd
    .command("edit <name>")
    .description(
      "Edit a namespace's metadata in clef.yaml. Optionally rename it (which " +
        "renames every cell file under the namespace and updates every service " +
        "identity that references it).",
    )
    .option("--rename <newName>", "Rename the namespace (and all cell files)")
    .option("--description <text>", "Replace the namespace's description")
    .option("--schema <path>", "Set the schema path (use empty string to clear)")
    .action(
      async (name: string, opts: { rename?: string; description?: string; schema?: string }) => {
        try {
          if (
            opts.rename === undefined &&
            opts.description === undefined &&
            opts.schema === undefined
          ) {
            formatter.error("Nothing to edit. Pass --rename, --description, or --schema.");
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
            await structure.editNamespace(name, opts, manifest, repoRoot);

            if (isJsonMode()) {
              formatter.json({
                action: "edited",
                kind: "namespace",
                name: opts.rename ?? name,
                previousName: opts.rename ? name : undefined,
                changes: {
                  ...(opts.rename ? { rename: opts.rename } : {}),
                  ...(opts.description !== undefined ? { description: opts.description } : {}),
                  ...(opts.schema !== undefined ? { schema: opts.schema } : {}),
                },
              });
              return;
            }

            const finalName = opts.rename ?? name;
            if (opts.rename) {
              formatter.success(`Renamed namespace '${name}' → '${finalName}'`);
            }
            if (opts.description !== undefined) {
              formatter.success(`Updated description on namespace '${finalName}'`);
            }
            if (opts.schema !== undefined) {
              formatter.success(
                opts.schema === ""
                  ? `Cleared schema on namespace '${finalName}'`
                  : `Set schema on namespace '${finalName}' → ${opts.schema}`,
              );
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
  nsCmd
    .command("add <name>")
    .description(
      "Create a new namespace and scaffold an empty encrypted cell for every " +
        "existing environment. Refuses if the name already exists or any of the " +
        "target cell files are already on disk.",
    )
    .option("--description <text>", "Human-readable description for the new namespace", "")
    .option("--schema <path>", "Optional schema file path for the new namespace")
    .action(async (name: string, opts: { description: string; schema?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const { structure, cleanup } = await makeStructureManager(repoRoot, deps.runner, manifest);
        try {
          await structure.addNamespace(
            name,
            { description: opts.description, schema: opts.schema },
            manifest,
            repoRoot,
          );

          if (isJsonMode()) {
            formatter.json({
              action: "added",
              kind: "namespace",
              name,
              cellsScaffolded: manifest.environments.length,
            });
            return;
          }

          formatter.success(
            `Added namespace '${name}' (${manifest.environments.length} cell${manifest.environments.length === 1 ? "" : "s"} scaffolded)`,
          );
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- remove ---
  nsCmd
    .command("remove <name>")
    .alias("rm")
    .description(
      "Delete a namespace, all of its encrypted cell files, and remove it from " +
        "every service identity that references it. Refuses if removing it would " +
        "leave any service identity with zero scope (delete those service " +
        "identities first or expand their scope).",
    )
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (name: string, opts: { yes?: boolean }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (!opts.yes) {
          const ns = manifest.namespaces.find((n) => n.name === name);
          const cellCount = ns ? manifest.environments.length : 0;
          const confirmed = await formatter.confirm(
            `Delete namespace '${name}' and ${cellCount} encrypted cell${cellCount === 1 ? "" : "s"}? This cannot be undone outside of git history.`,
          );
          if (!confirmed) {
            formatter.info("Aborted.");
            return;
          }
        }

        const { structure, cleanup } = await makeStructureManager(repoRoot, deps.runner, manifest);
        try {
          await structure.removeNamespace(name, manifest, repoRoot);

          if (isJsonMode()) {
            formatter.json({ action: "removed", kind: "namespace", name });
            return;
          }
          formatter.success(`Removed namespace '${name}'`);
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
