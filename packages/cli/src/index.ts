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
import { registerServeCommand } from "./commands/serve";
import { registerNamespaceCommand } from "./commands/namespace";
import { registerEnvCommand } from "./commands/env";
import { formatter, setJsonMode, setYesMode, isJsonMode } from "./output/formatter";
import { exitJsonError } from "./handle-error";
import { setPlainMode, isPlainMode, symbols, sym } from "./output/symbols";
import { openBrowser } from "./browser";
import { createSopsClient } from "./age-credential";
import pkg from "../package.json";

const VERSION = pkg.version as string;

const program = new Command();
const runner = new NodeSubprocessRunner();
const deps = { runner };

program
  .name("clef")
  .option("--dir <path>", "Path to a local Clef repository root (default: current directory)")
  .option("--plain", "Plain output, no emoji or colour")
  .option("--json", "Output machine-readable JSON (suppresses human output)")
  .option("--yes", "Auto-confirm destructive operations (required with --json for writes)");

// Resolve --plain before any command runs.
program.hook("preAction", async () => {
  const opts = program.opts();

  if (opts.plain) {
    setPlainMode(true);
  }

  if (opts.json) {
    setJsonMode(true);
  }

  if (opts.yes) {
    setYesMode(true);
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
registerServeCommand(program, deps);
registerNamespaceCommand(program, deps);
registerEnvCommand(program, deps);

// Cloud commands are provided by @clef-sh/cloud (optional package).
// If not installed, register a stub that tells users how to install it.
// Set CLEF_CLOUD=1 to enable (not yet generally available).
async function loadCloudPlugin(): Promise<void> {
  if (!process.env.CLEF_CLOUD) return;

  try {
    const { registerCloudCommands } = await import("@clef-sh/cloud/cli");
    registerCloudCommands(program, {
      runner,
      formatter,
      sym,
      openBrowser,
      createSopsClient,
      cliVersion: VERSION,
    });
  } catch {
    program
      .command("cloud")
      .description("Manage Clef Cloud integration (requires @clef-sh/cloud).")
      .action(() => {
        formatter.print("Clef Cloud is not installed.\n");
        formatter.print("Install it with:");
        formatter.print("  npm install @clef-sh/cloud\n");
        formatter.print("Then re-run:");
        formatter.print("  clef cloud init --env <environment>");
      });
  }
}

// ── Analytics (optional, opt-out) ─────────────────────────────────────────

interface AnalyticsModule {
  track(event: string, properties?: Record<string, string | number | boolean>): void;
  shutdown(): Promise<void>;
}

let analytics: AnalyticsModule | null = null;

async function loadAnalytics(): Promise<void> {
  try {
    analytics = await import("@clef-sh/analytics");
  } catch {
    // Not installed — no-op
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await Promise.all([loadCloudPlugin(), loadAnalytics()]);

  const startTime = Date.now();
  const commandName = process.argv[2] ?? "unknown";

  let success = true;
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    success = false;
    throw err;
  } finally {
    analytics?.track("cli_command", {
      command: commandName,
      duration_ms: Date.now() - startTime,
      success,
      cli_version: VERSION,
    });
    await analytics?.shutdown();
  }
}

main().catch((err) => {
  if (isJsonMode()) {
    exitJsonError(err.message);
  }
  formatter.error(err.message);
  process.exit(1);
});
