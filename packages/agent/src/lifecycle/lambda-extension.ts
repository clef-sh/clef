import { ArtifactPoller, TelemetryEmitter } from "@clef-sh/runtime";
import { AgentServerHandle } from "../server";

/** Event types returned by the Lambda Extensions API. */
type LambdaEvent = "INVOKE" | "SHUTDOWN";

interface LambdaNextResponse {
  eventType: LambdaEvent;
}

export interface LambdaExtensionOptions {
  poller: ArtifactPoller;
  server: AgentServerHandle;
  /** TTL in seconds — refresh artifact if older than this on INVOKE. */
  refreshTtl: number;
  telemetry?: TelemetryEmitter;
  onLog?: (message: string) => void;
  /** Skip the initial fetch if the caller already bootstrapped the poller. */
  skipInitialFetch?: boolean;
}

/**
 * Lambda Extension lifecycle wrapper.
 *
 * Registers with the Lambda Extensions API, starts the HTTP server,
 * and refreshes secrets between invocations when the TTL has expired.
 */
export class LambdaExtension {
  private lastRefresh = 0;
  private readonly options: LambdaExtensionOptions;
  private readonly startedAt: number;

  constructor(options: LambdaExtensionOptions) {
    this.options = options;
    this.startedAt = Date.now();
  }

  /** Run the Lambda Extension lifecycle. */
  async start(): Promise<void> {
    const { poller, server, onLog, refreshTtl, telemetry } = this.options;

    const extensionId = await this.register();
    onLog?.(`Registered with Lambda Extensions API (id: ${extensionId})`);
    onLog?.(`Agent server listening at ${server.url}`);

    if (!this.options.skipInitialFetch) {
      // Initial fetch — JIT mode fetches without decrypting
      if (refreshTtl === 0) {
        await poller.fetchAndValidate();
      } else {
        await poller.fetchAndDecrypt();
      }
      onLog?.("Initial secrets loaded.");
    }
    this.lastRefresh = Date.now();

    // Event loop
    while (true) {
      const event = await this.nextEvent(extensionId);

      if (event.eventType === "SHUTDOWN") {
        onLog?.("SHUTDOWN event received.");
        poller.stop();
        telemetry?.agentStopped({
          reason: "lambda_shutdown",
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        });
        try {
          await telemetry?.stopAsync();
        } catch {
          // Best-effort flush
        }
        await server.stop();
        break;
      }

      // INVOKE event — refresh artifact
      if (event.eventType === "INVOKE") {
        if (refreshTtl === 0) {
          // JIT mode: always fetch fresh encrypted artifact on every invocation
          try {
            await poller.fetchAndValidate();
            this.lastRefresh = Date.now();
          } catch (err) {
            onLog?.(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          const elapsed = (Date.now() - this.lastRefresh) / 1000;
          if (elapsed >= refreshTtl) {
            try {
              await poller.fetchAndDecrypt();
              this.lastRefresh = Date.now();
            } catch (err) {
              onLog?.(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    }
  }

  private async register(): Promise<string> {
    const res = await fetch("http://127.0.0.1:9001/2020-01-01/extension/register", {
      method: "POST",
      headers: { "Lambda-Extension-Name": "clef-agent" },
      body: JSON.stringify({ events: ["INVOKE", "SHUTDOWN"] }),
    });

    if (!res.ok) {
      throw new Error(`Lambda Extensions API register failed: ${res.status}`);
    }

    const extensionId = res.headers.get("Lambda-Extension-Identifier");
    if (!extensionId) {
      throw new Error("Lambda Extensions API did not return an extension ID.");
    }

    return extensionId;
  }

  private async nextEvent(extensionId: string): Promise<LambdaNextResponse> {
    const res = await fetch("http://127.0.0.1:9001/2020-01-01/extension/event/next", {
      method: "GET",
      headers: { "Lambda-Extension-Identifier": extensionId },
    });

    if (!res.ok) {
      throw new Error(`Lambda Extensions API event/next failed: ${res.status}`);
    }

    return (await res.json()) as LambdaNextResponse;
  }
}
