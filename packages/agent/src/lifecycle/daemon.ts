import { ArtifactPoller } from "@clef-sh/runtime";
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
  private shutdownResolve?: () => void;
  private readonly shutdownPromise: Promise<void>;

  constructor(options: DaemonOptions) {
    this.options = options;
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });
  }

  /** Start the daemon and register signal handlers. */
  async start(): Promise<void> {
    const { poller, server, onLog } = this.options;

    const shutdown = async () => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      onLog?.("Shutting down...");
      poller.stop();
      try {
        await server.stop();
      } catch {
        // Best-effort stop
      }
      onLog?.("Shutdown complete.");
      this.shutdownResolve?.();
    };

    process.on("SIGTERM", () => {
      shutdown().catch(() => {});
    });
    process.on("SIGINT", () => {
      shutdown().catch(() => {});
    });

    onLog?.(`Agent server listening at ${server.url}`);
    // main.ts already calls fetchAndDecrypt() — only start the polling interval.
    poller.startInterval();
    onLog?.("Agent ready. Polling for updates.");
  }

  /** Returns a promise that resolves when the daemon has fully shut down. */
  waitForShutdown(): Promise<void> {
    return this.shutdownPromise;
  }
}
