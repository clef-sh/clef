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

          const matrixManager = new MatrixManager();
          const tx = new TransactionManager(new GitIntegration(deps.runner));
          const structure = new StructureManager(matrixManager, tx);

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
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
