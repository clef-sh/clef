import * as fs from "fs";
import * as path from "path";
import type { Command } from "commander";
import {
  ClefManifest,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  StructureManager,
  SubprocessRunner,
  TransactionManager,
  emptyTemplate,
  exampleTemplate,
  writeSchemaRaw,
} from "@clef-sh/core";
import { handleCommandError } from "../../handle-error";
import { formatter, isJsonMode } from "../../output/formatter";
import { createSopsClient } from "../../age-credential";

interface NewOptions {
  path?: string;
  force?: boolean;
  template?: string;
}

export function registerSchemaNewCommand(
  parent: Command,
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  parent
    .command("new <namespace>")
    .description(
      "Scaffold a schema file for <namespace> and attach it in clef.yaml.\n\n" +
        "Writes a well-commented YAML template at schemas/<namespace>.yaml (or\n" +
        "--path), then sets the namespace's schema attachment in clef.yaml.\n" +
        "Refuses if the namespace already has a schema unless --force is set.\n\n" +
        "To add keys or custom patterns, hand-edit the scaffolded YAML or use\n" +
        "the UI schema editor (`clef ui`). The CLI does not take --key, --type,\n" +
        "--pattern, or similar per-field flags by design.",
    )
    .option("--path <file>", "Output path (default: schemas/<namespace>.yaml)")
    .option("--force", "Overwrite an existing schema file and replace the attachment")
    .option(
      "--template <kind>",
      "Starter content: 'empty' (comments only) or 'example' (commented sample key)",
      "empty",
    )
    .action(async (namespace: string, opts: NewOptions) => {
      try {
        const template = (opts.template ?? "empty").toLowerCase();
        if (template !== "empty" && template !== "example") {
          formatter.error(`--template must be 'empty' or 'example', got '${opts.template}'.`);
          process.exit(2);
          return;
        }

        const repoRoot = (program.opts().dir as string) || process.cwd();
        const manifestPath = path.join(repoRoot, "clef.yaml");
        const parser = new ManifestParser();
        const manifest: ClefManifest = parser.parse(manifestPath);

        const ns = manifest.namespaces.find((n) => n.name === namespace);
        if (!ns) {
          const available = manifest.namespaces.map((n) => n.name).join(", ");
          formatter.error(
            `Namespace '${namespace}' not found. Available: ${available || "(none)"}`,
          );
          process.exit(2);
          return;
        }

        const relSchemaPath = opts.path
          ? toRepoRelative(opts.path, repoRoot)
          : path.join("schemas", `${namespace}.yaml`);
        const absSchemaPath = path.resolve(repoRoot, relSchemaPath);

        const fileExists = fs.existsSync(absSchemaPath);
        const attachmentExists = ns.schema !== undefined && ns.schema !== "";

        if (!opts.force && (fileExists || attachmentExists)) {
          const reasons: string[] = [];
          if (fileExists) reasons.push(`file already exists at ${relSchemaPath}`);
          if (attachmentExists) reasons.push(`namespace already has schema '${ns.schema}'`);
          formatter.error(
            `Refusing to overwrite: ${reasons.join("; ")}. Re-run with --force to replace.`,
          );
          process.exit(2);
          return;
        }

        const contents =
          template === "example" ? exampleTemplate(namespace) : emptyTemplate(namespace);
        writeSchemaRaw(absSchemaPath, contents);

        const { structure, cleanup } = await makeStructureManager(repoRoot, deps.runner, manifest);
        try {
          await structure.editNamespace(namespace, { schema: relSchemaPath }, manifest, repoRoot);
        } finally {
          await cleanup();
        }

        if (isJsonMode()) {
          formatter.json({
            action: "created",
            kind: "schema",
            namespace,
            template,
            schemaPath: absSchemaPath,
            manifestPath,
          });
          return;
        }

        formatter.success(`Created ${absSchemaPath}`);
        formatter.success(`Attached to namespace '${namespace}' in ${manifestPath}`);
        formatter.hint(
          `Next: edit ${relSchemaPath} in your editor, or run \`clef ui\` to edit ` +
            `the schema in the browser. Run \`clef lint\` to verify.`,
        );
      } catch (err) {
        handleCommandError(err);
      }
    });
}

function toRepoRelative(input: string, repoRoot: string): string {
  const abs = path.isAbsolute(input) ? input : path.resolve(repoRoot, input);
  const rel = path.relative(repoRoot, abs);
  // Preserve the user's intent if they passed a path outside the repo — the
  // manifest will store whatever relative string we hand StructureManager.
  return rel || input;
}

async function makeStructureManager(
  repoRoot: string,
  runner: SubprocessRunner,
  manifest: ClefManifest,
): Promise<{ structure: StructureManager; cleanup: () => Promise<void> }> {
  const { client: sopsClient, cleanup } = await createSopsClient(repoRoot, runner, manifest);
  const matrixManager = new MatrixManager();
  const tx = new TransactionManager(new GitIntegration(runner));
  return { structure: new StructureManager(matrixManager, sopsClient, tx), cleanup };
}
