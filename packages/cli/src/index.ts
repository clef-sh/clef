import { Command } from "commander";
import { NodeSubprocessRunner } from "./subprocess";
import { registerInitCommand } from "./commands/init";
import { registerGetCommand } from "./commands/get";
import { registerSetCommand } from "./commands/set";
import { registerDeleteCommand } from "./commands/delete";
import { registerDiffCommand } from "./commands/diff";
import { registerLintCommand } from "./commands/lint";
import { registerRotateCommand } from "./commands/rotate";
import { registerHooksCommand } from "./commands/hooks";
import { registerUiCommand } from "./commands/ui";
import { registerExecCommand } from "./commands/exec";
import { registerExportCommand } from "./commands/export";
import { registerDoctorCommand } from "./commands/doctor";
import { registerScanCommand } from "./commands/scan";
import { registerImportCommand } from "./commands/import";
import { registerRecipientsCommand } from "./commands/recipients";
import { formatter } from "./output/formatter";
import { setPlainMode, isPlainMode, symbols } from "./output/symbols";

const VERSION = "0.1.0";

const program = new Command();
const runner = new NodeSubprocessRunner();
const deps = { runner };

program
  .name("clef")
  .option("--repo <path>", "Path to the Clef repository root (overrides auto-detection from cwd)")
  .option("--plain", "Plain output, no emoji or colour");

// Apply --plain before any command runs
program.hook("preAction", () => {
  const opts = program.opts();
  if (opts.plain) {
    setPlainMode(true);
  }
});

// Custom help
program.addHelpText("beforeAll", () => {
  const clef = isPlainMode() ? "clef" : symbols.clef;
  return `${clef}  Clef \u2014 git-native secrets management\n`;
});

program.description(
  "Organise, encrypt, and manage secrets across\n" +
    "   environments. Built on SOPS and age.\n\n" +
    "   Docs: https://docs.clef.sh",
);

// Custom version display
program.configureOutput({
  writeOut: (str) => process.stdout.write(str),
  writeErr: (str) => process.stderr.write(str),
  outputError: (str, write) => write(str),
});

// Override version display to include 𝄞
program.version(VERSION, "-V, --version", "output the version number");
program.on("option:version", () => {
  const clef = isPlainMode() ? "clef" : symbols.clef;
  process.stdout.write(`${clef}  clef ${VERSION}\n`);
  process.exit(0);
});

registerInitCommand(program, deps);
registerGetCommand(program, deps);
registerSetCommand(program, deps);
registerDeleteCommand(program, deps);
registerDiffCommand(program, deps);
registerLintCommand(program, deps);
registerRotateCommand(program, deps);
registerHooksCommand(program, deps);
registerUiCommand(program, deps);
registerExecCommand(program, deps);
registerExportCommand(program, deps);
registerImportCommand(program, deps);
registerDoctorCommand(program, deps);
registerScanCommand(program, deps);
registerRecipientsCommand(program, deps);

program.parseAsync(process.argv).catch((err) => {
  formatter.error(err.message);
  process.exit(1);
});
