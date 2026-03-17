import { ArtifactPoller } from "../poller";
import { AgentServerHandle } from "../server";

export interface DaemonOptions {
  poller: ArtifactPoller;
  server: AgentServerHandle;
  onLog?: (message: string) => void;
}

/**
 * Daemon lifecycle wrapper for containers, ECS, and standalone use.
 *
 * Starts the HTTP server, runs the poller, and handles SIGTERM/SIGINT
 * for graceful shutdown.
 */
export class Daemon {
  private shutdownRequested = false;
  private readonly options: DaemonOptions;

  constructor(options: DaemonOptions) {
    this.options = options;
  }

  /** Start the daemon and register signal handlers. */
  async start(): Promise<void> {
    const { poller, server, onLog } = this.options;

    const shutdown = async () => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      onLog?.("Shutting down...");
      poller.stop();
      await server.stop();
      onLog?.("Shutdown complete.");
    };

    process.on("SIGTERM", () => {
      shutdown();
    });
    process.on("SIGINT", () => {
      shutdown();
    });

    onLog?.(`Agent server listening at ${server.url}`);
    onLog?.("Performing initial fetch...");
    await poller.start();
    onLog?.("Agent ready. Polling for updates.");
  }
}
