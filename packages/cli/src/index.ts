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
import { registerUpdateCommand } from "./commands/update";
import { registerScanCommand } from "./commands/scan";
import { registerImportCommand } from "./commands/import";
import { registerRecipientsCommand } from "./commands/recipients";
import { registerMergeDriverCommand } from "./commands/merge-driver";
import { formatter } from "./output/formatter";
import { setPlainMode, isPlainMode, symbols } from "./output/symbols";
import { isGitUrl, resolveRemoteRepo } from "@clef-sh/core";

const VERSION = "0.1.0";

const program = new Command();
const runner = new NodeSubprocessRunner();
const deps = { runner };

// Commands blocked when --repo is a git URL (read-only remote mode).
// Subcommand parents (hooks, recipients) are checked separately.
const REMOTE_WRITE_COMMANDS = new Set(["set", "delete", "rotate", "init", "import", "ui"]);

function isWriteCommand(name: string, parentName: string | undefined): boolean {
  if (REMOTE_WRITE_COMMANDS.has(name)) return true;
  if (parentName === "recipients" && (name === "add" || name === "remove")) return true;
  if (parentName === "hooks") return true;
  return false;
}

program
  .name("clef")
  .option("--repo <path>", "Path to the Clef repository root or a git URL (SSH or HTTPS)")
  .option(
    "--branch <branch>",
    "Branch to check out when --repo is a git URL (default: remote HEAD)",
  )
  .option("--plain", "Plain output, no emoji or colour");

// Resolve --plain and remote --repo before any command runs.
program.hook("preAction", async (_thisCommand, actionCommand) => {
  const opts = program.opts();

  if (opts.plain) {
    setPlainMode(true);
  }

  if (opts.repo && isGitUrl(opts.repo as string)) {
    const commandName = actionCommand.name();
    const parentName = (actionCommand.parent as Command | null)?.name();

    if (isWriteCommand(commandName, parentName)) {
      formatter.error(
        `'clef ${commandName}' is not supported when --repo is a URL. ` +
          `Clone the repository locally to make changes.`,
      );
      process.exit(1);
    }

    try {
      const localPath = await resolveRemoteRepo(
        opts.repo as string,
        opts.branch as string | undefined,
        runner,
      );
      program.setOptionValue("repo", localPath);
    } catch (err) {
      formatter.error(`Remote repository error: ${(err as Error).message}`);
      process.exit(1);
    }
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
registerUpdateCommand(program, deps);
registerScanCommand(program, deps);
registerRecipientsCommand(program, deps);
registerMergeDriverCommand(program, deps);

program.parseAsync(process.argv).catch((err) => {
  formatter.error(err.message);
  process.exit(1);
});
