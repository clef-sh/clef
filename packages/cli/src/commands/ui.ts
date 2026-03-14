import * as path from "path";
import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

interface ServerHandle {
  url: string;
  token: string;
  stop: () => Promise<void>;
  address: () => { address: string; port: number };
}

// When the CLI is distributed as a self-contained esbuild bundle, all code
// lives in dist/index.js and __dirname resolves to that file's directory.
// The build script copies UI client assets to dist/client/ alongside the bundle.
const UI_CLIENT_DIR = path.resolve(__dirname, "client");

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

      const repoRoot = (program.opts().dir as string) || process.cwd();

      // Lazy-load @clef-sh/ui so the CLI doesn't fail at startup when the UI
      // module hasn't been resolved yet for commands other than `clef ui`.
      const uiModule = await import("@clef-sh/ui/dist/server");
      const { startServer } = uiModule as {
        startServer: (
          port: number,
          repoRoot: string,
          runner?: SubprocessRunner,
          clientDir?: string,
        ) => Promise<ServerHandle>;
      };

      let handle: ServerHandle;
      try {
        handle = await startServer(port, repoRoot, deps.runner, UI_CLIENT_DIR);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        formatter.error(`Failed to start UI server: ${message}`);
        process.exit(1);
        return;
      }

      const tokenUrl = `${handle.url}?token=${handle.token}`;

      formatter.print(`${sym("clef")}  Starting Clef UI...\n`);
      formatter.print(`   ${sym("locked")}  Server   ${handle.url}`);
      formatter.print(`   ${sym("copied")}  Token    ${handle.token}`);

      if (options.open) {
        if (isHeadless()) {
          formatter.info(
            `Browser auto-open skipped (no display detected). Open ${tokenUrl} manually.`,
          );
        } else {
          formatter.print(`\n   Opening browser...`);
          try {
            await openBrowser(tokenUrl, deps.runner);
          } catch {
            formatter.warn(`Could not open browser automatically. Visit ${tokenUrl} manually.`);
          }
        }
      }
      formatter.print(`   Press Ctrl+C to stop.`);

      // Graceful shutdown
      await new Promise<void>((resolve) => {
        const shutdown = async () => {
          formatter.print("\nShutting down...");
          await handle.stop();
          resolve();
        };

        process.on("SIGINT", () => {
          shutdown();
        });
        process.on("SIGTERM", () => {
          shutdown();
        });
      });
    });
}

export function isHeadless(): boolean {
  // CI environment — universal headless signal
  if (process.env.CI) {
    return true;
  }

  // SSH session — no local display
  if (process.env.SSH_TTY) {
    return true;
  }

  // Linux without a display server
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }

  return false;
}

async function openBrowser(url: string, runner: SubprocessRunner): Promise<void> {
  const platform = process.platform;
  let command: string;

  switch (platform) {
    case "darwin":
      command = "open";
      break;
    case "linux":
      command = "xdg-open";
      break;
    case "win32":
      command = "start";
      break;
    default:
      return;
  }

  await runner.run(command, [url]);
}
