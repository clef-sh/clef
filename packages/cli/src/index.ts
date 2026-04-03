import { Command } from "commander";
import { NodeSubprocessRunner } from "./subprocess";
import { registerInitCommand } from "./commands/init";
import { registerGetCommand } from "./commands/get";
import { registerSetCommand } from "./commands/set";
import { registerCompareCommand } from "./commands/compare";
import { registerDeleteCommand } from "./commands/delete";
import { registerDiffCommand } from "./commands/diff";
import { registerLintCommand } from "./commands/lint";
import { registerRotateCommand } from "./commands/rotate";
import { registerHooksCommand } from "./commands/hooks";
import { registerUiCommand } from "./commands/ui";
import { registerExecCommand } from "./commands/exec";
import { registerExportCommand } from "./commands/export";
import { registerDoctorCommand } from "./commands/doctor";
import { registerUpdateCommand } from "./commands/update";
import { registerScanCommand } from "./commands/scan";
import { registerImportCommand } from "./commands/import";
import { registerRecipientsCommand } from "./commands/recipients";
import { registerMergeDriverCommand } from "./commands/merge-driver";
import { registerServiceCommand } from "./commands/service";
import { registerPackCommand } from "./commands/pack";
import { registerRevokeCommand } from "./commands/revoke";
import { registerDriftCommand } from "./commands/drift";
import { registerReportCommand } from "./commands/report";
import { registerInstallCommand } from "./commands/install";
import { registerSearchCommand } from "./commands/search";
import { registerMigrateBackendCommand } from "./commands/migrate-backend";
import { registerCloudCommand } from "./commands/cloud";
import { formatter } from "./output/formatter";
import { setPlainMode, isPlainMode, symbols } from "./output/symbols";
import pkg from "../package.json";

const VERSION = pkg.version as string;

const program = new Command();
const runner = new NodeSubprocessRunner();
const deps = { runner };

program
  .name("clef")
  .option("--dir <path>", "Path to a local Clef repository root (default: current directory)")
  .option("--plain", "Plain output, no emoji or colour");

// Resolve --plain before any command runs.
program.hook("preAction", async () => {
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
registerCompareCommand(program, deps);
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
registerUpdateCommand(program, deps);
registerScanCommand(program, deps);
registerRecipientsCommand(program, deps);
registerMergeDriverCommand(program, deps);
registerServiceCommand(program, deps);
registerPackCommand(program, deps);
registerRevokeCommand(program, deps);
registerDriftCommand(program, deps);
registerReportCommand(program, deps);
registerInstallCommand(program, deps);
registerSearchCommand(program, deps);
registerMigrateBackendCommand(program, deps);
registerCloudCommand(program, deps);

program.parseAsync(process.argv).catch((err) => {
  formatter.error(err.message);
  process.exit(1);
});
