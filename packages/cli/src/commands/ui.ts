import { createServer } from "node:net";
import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { resolveAgeCredential, prepareSopsClientArgs } from "../age-credential";
import { openBrowser, isHeadless } from "../browser";

interface ServerHandle {
  url: string;
  token: string;
  stop: () => Promise<void>;
  address: () => { address: string; port: number };
}

// Probe 127.0.0.1:port before handing off to the UI server. app.listen() inside
// @clef-sh/ui can fire its 'listening' callback even when the bind silently
// fails (observed on macOS when another process already holds the port), so
// startServer resolves, the URL prints, and the process exits cleanly seconds
// later — no error surfaces. Detecting up front turns that into a clear message.
async function probePortAvailable(port: number): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", (err) => resolve(err as NodeJS.ErrnoException));
    tester.once("listening", () => tester.close(() => resolve(null)));
    tester.listen(port, "127.0.0.1");
  });
}

export function registerUiCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("ui")
    .description("Open the Clef local web UI in your browser")
    .option("--port <port>", "Port to serve the UI on", "7777")
    .option("--no-open", "Don't automatically open the browser")
    .action(async (options: { port: string; open: boolean }) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        formatter.error(`Invalid port '${options.port}'. Must be a number between 1 and 65535.`);
        process.exit(1);
        return;
      }

      const probeErr = await probePortAvailable(port);
      if (probeErr) {
        if (probeErr.code === "EADDRINUSE") {
          formatter.error(
            `Port ${port} is already in use. Another \`clef ui\` (or other process) is bound to 127.0.0.1:${port}.`,
          );
          formatter.print("");
          formatter.print(`  Find it:  lsof -nP -iTCP:${port} -sTCP:LISTEN`);
          formatter.print(`  Stop it:  kill <PID>`);
          formatter.print(`  Or run:   clef ui --port <other-port>`);
        } else {
          formatter.error(`Cannot bind to 127.0.0.1:${port}: ${probeErr.message}`);
        }
        process.exit(1);
        return;
      }

      const repoRoot = (program.opts().dir as string) || process.cwd();

      // Resolve age credentials so the UI server can decrypt secrets
      const credential = await resolveAgeCredential(repoRoot, deps.runner);
      const { ageKeyFile, ageKey } = prepareSopsClientArgs(credential);

      // Lazy-load @clef-sh/ui — it's an optional dependency.
      let uiModule;
      try {
        uiModule = await import("@clef-sh/ui");
      } catch {
        formatter.print("Clef UI is not installed.\n");
        formatter.print("Install it with:");
        formatter.print("  npm install @clef-sh/ui\n");
        formatter.print("Then re-run:");
        formatter.print("  clef ui");
        process.exit(1);
        return;
      }

      const { startServer } = uiModule as {
        startServer: (
          port: number,
          repoRoot: string,
          runner?: SubprocessRunner,
          clientDir?: string,
          ageKeyFile?: string,
          ageKey?: string,
        ) => Promise<ServerHandle>;
      };

      let handle: ServerHandle;
      try {
        handle = await startServer(port, repoRoot, deps.runner, undefined, ageKeyFile, ageKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        formatter.error(`Failed to start UI server: ${message}`);
        process.exit(1);
        return;
      }

      const tokenUrl = `${handle.url}?token=${handle.token}`;

      formatter.print(`${sym("clef")}  Starting Clef UI...\n`);
      formatter.print(`   ${sym("locked")}  URL   ${tokenUrl}`);

      if (options.open) {
        if (isHeadless()) {
          formatter.info(
            `Browser auto-open skipped (no display detected). Open the URL above manually.`,
          );
        } else {
          formatter.print(`\n   Opening browser...`);
          const opened = await openBrowser(tokenUrl, deps.runner);
          if (!opened) {
            formatter.warn(`Could not open browser automatically. Visit the URL above manually.`);
          }
        }
      }
      formatter.print(`   Press Ctrl+C to stop.`);

      // Graceful shutdown — use `once` so repeated Ctrl+C doesn't leak listeners
      await new Promise<void>((resolve) => {
        let stopping = false;
        const shutdown = async () => {
          if (stopping) return;
          stopping = true;
          formatter.print("\nShutting down...");
          await handle.stop();
          resolve();
        };

        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
    });
}
