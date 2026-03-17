import { ArtifactPoller } from "../poller";
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
  onLog?: (message: string) => void;
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

  constructor(options: LambdaExtensionOptions) {
    this.options = options;
  }

  /** Run the Lambda Extension lifecycle. */
  async start(): Promise<void> {
    const { poller, server, onLog, refreshTtl } = this.options;

    const extensionId = await this.register();
    onLog?.(`Registered with Lambda Extensions API (id: ${extensionId})`);
    onLog?.(`Agent server listening at ${server.url}`);

    // Initial fetch
    await poller.fetchAndDecrypt();
    this.lastRefresh = Date.now();
    onLog?.("Initial secrets loaded.");

    // Event loop
    while (true) {
      const event = await this.nextEvent(extensionId);

      if (event.eventType === "SHUTDOWN") {
        onLog?.("SHUTDOWN event received.");
        poller.stop();
        await server.stop();
        break;
      }

      // INVOKE event — refresh if TTL expired
      if (event.eventType === "INVOKE") {
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
