import { ArtifactPoller, TelemetryEmitter } from "@clef-sh/runtime";
import { AgentServerHandle } from "../server";

export interface DaemonOptions {
  poller: ArtifactPoller;
  server: AgentServerHandle;
  telemetry?: TelemetryEmitter;
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
  private readonly startedAt: number;
  private sigTermHandler?: () => void;
  private sigIntHandler?: () => void;

  constructor(options: DaemonOptions) {
    this.options = options;
    this.startedAt = Date.now();
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });
  }

  /** Start the daemon and register signal handlers. */
  async start(): Promise<void> {
    const { poller, server, telemetry, onLog } = this.options;

    const shutdown = async () => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      onLog?.("Shutting down...");
      if (this.sigTermHandler) process.off("SIGTERM", this.sigTermHandler);
      if (this.sigIntHandler) process.off("SIGINT", this.sigIntHandler);
      poller.stop();
      telemetry?.agentStopped({
        reason: "signal",
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      });
      try {
        await telemetry?.stopAsync();
      } catch {
        // Best-effort flush
      }
      try {
        await server.stop();
      } catch {
        // Best-effort stop
      }
      onLog?.("Shutdown complete.");
      this.shutdownResolve?.();
    };

    this.sigTermHandler = () => {
      shutdown().catch(() => {});
    };
    this.sigIntHandler = () => {
      shutdown().catch(() => {});
    };
    process.on("SIGTERM", this.sigTermHandler);
    process.on("SIGINT", this.sigIntHandler);

    onLog?.(`Agent server listening at ${server.url}`);
    // main.ts already calls fetchAndDecrypt() — only start the polling schedule.
    poller.startPolling();
    onLog?.("Agent ready. Polling for updates.");
  }

  /** Returns a promise that resolves when the daemon has fully shut down. */
  waitForShutdown(): Promise<void> {
    return this.shutdownPromise;
  }
}
