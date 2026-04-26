import type { Command } from "commander";
import type { SubprocessRunner } from "@clef-sh/core";
import { registerSchemaNewCommand } from "./new";
import { registerSchemaShowCommand } from "./show";

/**
 * Register `clef schema` and its subcommands on the given program.
 *
 * `clef schema` is the verb tree for scaffolding and inspecting namespace
 * schemas. Keys are added by hand-editing the scaffolded YAML or by the UI
 * schema editor — the CLI intentionally does not grow per-field flags.
 *
 * Subcommands landing by PR:
 *   PR B — new, show (this file)
 *   PR D — infer
 */
export function registerSchemaCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  const schemaCmd = program
    .command("schema")
    .description("Scaffold and inspect namespace schemas.");

  registerSchemaNewCommand(schemaCmd, program, deps);
  registerSchemaShowCommand(schemaCmd, program);
}
