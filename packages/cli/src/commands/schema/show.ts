import * as fs from "fs";
import * as path from "path";
import type { Command } from "commander";
import {
  ClefManifest,
  ManifestParser,
  SchemaValidator,
  SchemaKey,
  NamespaceSchema,
} from "@clef-sh/core";
import { handleCommandError } from "../../handle-error";
import { formatter, isJsonMode } from "../../output/formatter";

export function registerSchemaShowCommand(parent: Command, program: Command): void {
  parent
    .command("show <namespace>")
    .description(
      "Pretty-print the schema attached to <namespace>. Use --json for a " +
        "machine-readable dump of the loaded schema.",
    )
    .action(async (namespace: string) => {
      try {
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

        if (!ns.schema) {
          if (isJsonMode()) {
            formatter.json({ namespace, path: null, keys: {} });
            return;
          }
          formatter.info(`Namespace '${namespace}' has no schema attached.`);
          formatter.hint(`Run \`clef schema new ${namespace}\` to scaffold one.`);
          return;
        }

        const absSchemaPath = path.resolve(repoRoot, ns.schema);
        if (!fs.existsSync(absSchemaPath)) {
          formatter.error(
            `Schema file '${ns.schema}' is attached to namespace '${namespace}' but does not exist at ${absSchemaPath}.`,
          );
          process.exit(2);
          return;
        }

        const schema: NamespaceSchema = new SchemaValidator().loadSchema(absSchemaPath);

        if (isJsonMode()) {
          formatter.json({ namespace, path: absSchemaPath, keys: schema.keys });
          return;
        }

        formatter.print(`${namespace} (${ns.schema})`);
        const keyCount = Object.keys(schema.keys).length;
        if (keyCount === 0) {
          formatter.hint("  (no keys declared yet — edit the file to add some)");
          return;
        }
        renderSchemaTable(schema.keys);
      } catch (err) {
        handleCommandError(err);
      }
    });
}

function renderSchemaTable(keys: Record<string, SchemaKey>): void {
  const names = Object.keys(keys);
  const nameWidth = Math.max(...names.map((n) => n.length));
  const typeWidth = Math.max(...Object.values(keys).map((k) => k.type.length), "type".length);

  for (const name of names) {
    const def = keys[name];
    const pieces = [
      name.padEnd(nameWidth),
      def.type.padEnd(typeWidth),
      def.required ? "required" : "optional",
    ];
    if (def.pattern) pieces.push(`pattern: ${def.pattern}`);
    if (def.description) pieces.push(`— ${def.description}`);
    formatter.print(`  ${pieces.join("  ")}`);
  }
}
