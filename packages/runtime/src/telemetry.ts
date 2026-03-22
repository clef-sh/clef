/** Base fields present on every telemetry event. */
interface TelemetryEventBase {
  type: string;
  timestamp: string;
  agentId: string;
  identity: string;
  environment: string;
  sourceType: string;
}

export interface AgentStartedEvent extends TelemetryEventBase {
  type: "agent.started";
  version: string;
}

export interface AgentStoppedEvent extends TelemetryEventBase {
  type: "agent.stopped";
  reason: "signal" | "error" | "lambda_shutdown";
  uptimeSeconds: number;
}

export interface ArtifactRefreshedEvent extends TelemetryEventBase {
  type: "artifact.refreshed";
  revision: string;
  keyCount: number;
  kmsEnvelope: boolean;
}

export interface ArtifactRevokedEvent extends TelemetryEventBase {
  type: "artifact.revoked";
  revokedAt: string;
}

export interface ArtifactExpiredEvent extends TelemetryEventBase {
  type: "artifact.expired";
  expiresAt: string;
}

export interface FetchFailedEvent extends TelemetryEventBase {
  type: "fetch.failed";
  error: string;
  diskCacheAvailable: boolean;
}

export interface CacheExpiredEvent extends TelemetryEventBase {
  type: "cache.expired";
  cacheTtlSeconds: number;
  diskCachePurged: boolean;
}

export interface ArtifactInvalidEvent extends TelemetryEventBase {
  type: "artifact.invalid";
  reason: string;
  error: string;
}

/** Discriminated union of all telemetry event types. */
export type TelemetryEvent =
  | AgentStartedEvent
  | AgentStoppedEvent
  | ArtifactRefreshedEvent
  | ArtifactRevokedEvent
  | ArtifactExpiredEvent
  | FetchFailedEvent
  | CacheExpiredEvent
  | ArtifactInvalidEvent;

/** Configuration for the telemetry emitter. */
export interface TelemetryOptions {
  /** OTLP HTTP endpoint (e.g. `http://localhost:4318/v1/logs`). */
  url: string;
  /** Custom HTTP headers for the OTLP endpoint (e.g. `{ Authorization: "Bearer ..." }` or `{ "DD-API-KEY": "..." }`). */
  headers?: Record<string, string>;
  /** Service version — used in OTLP resource and scope. */
  version: string;
  /** Unique agent/instance ID. */
  agentId: string;
  /** Service identity name. */
  identity: string;
  /** Target environment. */
  environment: string;
  /** Source type: `"vcs"`, `"http"`, or `"file"`. */
  sourceType: string;
  /** Flush interval in milliseconds. Default: 10_000 (10s). */
  flushIntervalMs?: number;
  /** Max buffered events before auto-flush. Default: 50. */
  maxBufferSize?: number;
}

/** OTLP severity levels by event type. */
const SEVERITY: Record<string, { number: number; text: string }> = {
  "agent.started": { number: 9, text: "INFO" },
  "agent.stopped": { number: 9, text: "INFO" },
  "artifact.refreshed": { number: 9, text: "INFO" },
  "artifact.revoked": { number: 13, text: "WARN" },
  "artifact.expired": { number: 13, text: "WARN" },
  "fetch.failed": { number: 13, text: "WARN" },
  "cache.expired": { number: 17, text: "ERROR" },
  "artifact.invalid": { number: 17, text: "ERROR" },
};

/** Base fields that belong in the OTLP resource, not per-record attributes. */
const BASE_FIELDS = new Set([
  "type",
  "timestamp",
  "agentId",
  "identity",
  "environment",
  "sourceType",
]);

/** Convert a value to an OTLP typed attribute value. */
function otlpValue(v: unknown): { stringValue?: string; intValue?: string; boolValue?: boolean } {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return { intValue: String(v) };
  return { stringValue: String(v) };
}

/** Convert ISO-8601 timestamp to nanosecond Unix epoch string. */
function isoToUnixNano(iso: string): string {
  return String(new Date(iso).getTime() * 1_000_000);
}

/**
 * Telemetry emitter that buffers events and delivers them as OTLP LogRecords
 * via HTTP POST to any OTLP-compatible endpoint.
 *
 * Zero external dependencies — uses built-in `fetch()` and hand-constructed
 * OTLP JSON (no protobuf, no SDK).
 *
 * All event methods are fire-and-forget — telemetry never disrupts the critical path.
 */
export class TelemetryEmitter {
  private buffer: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: TelemetryOptions;
  private readonly maxBufferSize: number;

  constructor(options: TelemetryOptions) {
    this.opts = options;
    this.maxBufferSize = options.maxBufferSize ?? 50;

    const intervalMs = options.flushIntervalMs ?? 10_000;
    this.timer = setInterval(() => this.flush(), intervalMs);
    this.timer.unref();
  }

  agentStarted(fields: { version: string }): void {
    this.emit({ type: "agent.started", ...fields });
  }

  agentStopped(fields: { reason: AgentStoppedEvent["reason"]; uptimeSeconds: number }): void {
    this.emit({ type: "agent.stopped", ...fields });
  }

  artifactRefreshed(fields: { revision: string; keyCount: number; kmsEnvelope: boolean }): void {
    this.emit({ type: "artifact.refreshed", ...fields });
  }

  artifactRevoked(fields: { revokedAt: string }): void {
    this.emit({ type: "artifact.revoked", ...fields });
  }

  artifactExpired(fields: { expiresAt: string }): void {
    this.emit({ type: "artifact.expired", ...fields });
  }

  fetchFailed(fields: { error: string; diskCacheAvailable: boolean }): void {
    this.emit({ type: "fetch.failed", ...fields });
  }

  cacheExpired(fields: { cacheTtlSeconds: number; diskCachePurged: boolean }): void {
    this.emit({ type: "cache.expired", ...fields });
  }

  artifactInvalid(fields: { reason: string; error: string }): void {
    this.emit({ type: "artifact.invalid", ...fields });
  }

  /** Fire-and-forget flush of the current buffer. */
  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    fetch(this.opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.opts.headers },
      body: this.toOtlpPayload(batch),
    }).catch(() => {
      // Best-effort delivery — telemetry must never disrupt the critical path
    });
  }

  /** Awaitable flush for graceful shutdown. */
  async flushAsync(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await fetch(this.opts.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.opts.headers },
        body: this.toOtlpPayload(batch),
      });
    } catch {
      // Best-effort delivery
    }
  }

  /** Stop the flush timer and fire-and-forget remaining events. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /** Stop the flush timer and await final flush. */
  async stopAsync(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flushAsync();
  }

  private emit(fields: Omit<TelemetryEvent, keyof TelemetryEventBase> & { type: string }): void {
    try {
      const event = {
        ...fields,
        timestamp: new Date().toISOString(),
        agentId: this.opts.agentId,
        identity: this.opts.identity,
        environment: this.opts.environment,
        sourceType: this.opts.sourceType,
      } as TelemetryEvent;
      this.buffer.push(event);
      if (this.buffer.length >= this.maxBufferSize) {
        this.flush();
      }
    } catch {
      // Telemetry must never disrupt the critical path
    }
  }

  /** Convert a batch of TelemetryEvents to an OTLP ExportLogsServiceRequest JSON string. */
  private toOtlpPayload(events: TelemetryEvent[]): string {
    const first = events[0];

    const resourceAttributes = [
      { key: "service.name", value: { stringValue: "clef-agent" } },
      { key: "service.version", value: { stringValue: this.opts.version } },
      { key: "clef.agent.id", value: { stringValue: first.agentId } },
      { key: "clef.identity", value: { stringValue: first.identity } },
      { key: "clef.environment", value: { stringValue: first.environment } },
      { key: "clef.source.type", value: { stringValue: first.sourceType } },
    ];

    const logRecords = events.map((event) => {
      const severity = SEVERITY[event.type] ?? { number: 9, text: "INFO" };

      const attributes: { key: string; value: ReturnType<typeof otlpValue> }[] = [
        { key: "event.name", value: { stringValue: `clef.${event.type}` } },
      ];

      for (const [key, val] of Object.entries(event)) {
        if (BASE_FIELDS.has(key)) continue;
        attributes.push({ key: `clef.${key}`, value: otlpValue(val) });
      }

      return {
        timeUnixNano: isoToUnixNano(event.timestamp),
        severityNumber: severity.number,
        severityText: severity.text,
        body: { stringValue: event.type },
        attributes,
      };
    });

    return JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: resourceAttributes },
          scopeLogs: [
            {
              scope: { name: "clef.runtime", version: this.opts.version },
              logRecords,
            },
          ],
        },
      ],
    });
  }
}
