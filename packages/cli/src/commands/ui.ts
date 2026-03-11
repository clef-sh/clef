import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { startServer, ServerHandle } from "@clef-sh/ui/dist/server";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

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

      const repoRoot = (program.opts().repo as string) || process.cwd();

      let handle: ServerHandle;
      try {
        handle = await startServer(port, repoRoot, deps.runner);
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
