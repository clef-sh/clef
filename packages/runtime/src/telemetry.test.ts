import { TelemetryEmitter, TelemetryOptions } from "./telemetry";

function opts(overrides: Partial<TelemetryOptions> = {}): TelemetryOptions {
  return {
    url: "https://otel.example.com/v1/logs",
    headers: { Authorization: "Bearer secret-token" },
    version: "0.1.5",
    agentId: "agent-001",
    identity: "api-gateway",
    environment: "production",
    sourceType: "vcs",
    ...overrides,
  };
}

describe("TelemetryEmitter", () => {
  let mockFetch: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  describe("event methods", () => {
    it("should buffer events without immediate flush", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });

      expect(mockFetch).not.toHaveBeenCalled();
      emitter.stop();
    });

    it("should stamp base fields from options", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "1.0.0" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.body).toEqual({ stringValue: "agent.started" });
      expect(record.attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.agent.started" },
      });
      expect(record.attributes).toContainEqual({
        key: "clef.version",
        value: { stringValue: "1.0.0" },
      });
      emitter.stop();
    });

    it("should emit agent.stopped with reason and uptime", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStopped({ reason: "signal", uptimeSeconds: 3600 });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.agent.stopped" },
      });
      expect(record.attributes).toContainEqual({
        key: "clef.reason",
        value: { stringValue: "signal" },
      });
      expect(record.attributes).toContainEqual({
        key: "clef.uptimeSeconds",
        value: { intValue: "3600" },
      });
      emitter.stop();
    });

    it("should emit artifact.refreshed with typed attributes", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.artifactRefreshed({ revision: "abc123", kmsEnvelope: true });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attrs).toContainEqual({ key: "clef.revision", value: { stringValue: "abc123" } });
      expect(attrs).toContainEqual({ key: "clef.kmsEnvelope", value: { boolValue: true } });
      emitter.stop();
    });

    it("should emit artifact.revoked", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.artifactRevoked({ revokedAt: "2026-03-22T14:30:00.000Z" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attrs).toContainEqual({
        key: "clef.revokedAt",
        value: { stringValue: "2026-03-22T14:30:00.000Z" },
      });
      emitter.stop();
    });

    it("should emit artifact.expired", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.artifactExpired({ expiresAt: "2026-03-22T11:00:00.000Z" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attrs).toContainEqual({
        key: "clef.expiresAt",
        value: { stringValue: "2026-03-22T11:00:00.000Z" },
      });
      emitter.stop();
    });

    it("should emit fetch.failed", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.fetchFailed({ error: "network timeout", diskCacheAvailable: true });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attrs).toContainEqual({
        key: "clef.error",
        value: { stringValue: "network timeout" },
      });
      expect(attrs).toContainEqual({
        key: "clef.diskCacheAvailable",
        value: { boolValue: true },
      });
      emitter.stop();
    });

    it("should emit cache.expired", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.cacheExpired({ cacheTtlSeconds: 300, diskCachePurged: true });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attrs).toContainEqual({ key: "clef.cacheTtlSeconds", value: { intValue: "300" } });
      expect(attrs).toContainEqual({ key: "clef.diskCachePurged", value: { boolValue: true } });
      emitter.stop();
    });

    it("should emit artifact.invalid with reason and error", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.artifactInvalid({ reason: "integrity", error: "hash mismatch" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.body.stringValue).toBe("artifact.invalid");
      expect(record.severityText).toBe("ERROR");
      expect(record.attributes).toContainEqual({
        key: "clef.reason",
        value: { stringValue: "integrity" },
      });
      expect(record.attributes).toContainEqual({
        key: "clef.error",
        value: { stringValue: "hash mismatch" },
      });
      emitter.stop();
    });

    it("should swallow errors in event methods", () => {
      mockFetch.mockImplementation(() => {
        throw new Error("fetch constructor crash");
      });

      const emitter = new TelemetryEmitter(opts({ maxBufferSize: 1 }));
      // Should not throw even when flush triggers inside emit and fetch throws synchronously
      expect(() => emitter.agentStarted({ version: "1.0.0" })).not.toThrow();
      emitter.stop();
    });
  });

  describe("OTLP format", () => {
    it("should set resource attributes", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrs = body.resourceLogs[0].resource.attributes;

      expect(attrs).toContainEqual({
        key: "service.name",
        value: { stringValue: "clef-agent" },
      });
      expect(attrs).toContainEqual({
        key: "service.version",
        value: { stringValue: "0.1.5" },
      });
      expect(attrs).toContainEqual({
        key: "clef.agent.id",
        value: { stringValue: "agent-001" },
      });
      expect(attrs).toContainEqual({
        key: "clef.identity",
        value: { stringValue: "api-gateway" },
      });
      expect(attrs).toContainEqual({
        key: "clef.environment",
        value: { stringValue: "production" },
      });
      expect(attrs).toContainEqual({
        key: "clef.source.type",
        value: { stringValue: "vcs" },
      });
      emitter.stop();
    });

    it("should set scope name and version", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const scope = body.resourceLogs[0].scopeLogs[0].scope;

      expect(scope).toEqual({ name: "clef.runtime", version: "0.1.5" });
      emitter.stop();
    });

    it("should convert ISO timestamp to nanosecond Unix epoch", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
      const expectedNano = String(new Date("2026-03-22T12:00:00.000Z").getTime() * 1_000_000);

      expect(record.timeUnixNano).toBe(expectedNano);
      emitter.stop();
    });

    it("should map severity by event type", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" }); // INFO
      emitter.fetchFailed({ error: "timeout", diskCacheAvailable: false }); // WARN
      emitter.cacheExpired({ cacheTtlSeconds: 300, diskCachePurged: true }); // ERROR
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const records = body.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records[0].severityNumber).toBe(9);
      expect(records[0].severityText).toBe("INFO");
      expect(records[1].severityNumber).toBe(13);
      expect(records[1].severityText).toBe("WARN");
      expect(records[2].severityNumber).toBe(17);
      expect(records[2].severityText).toBe("ERROR");
      emitter.stop();
    });

    it("should not include base fields in per-record attributes", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attrKeys = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map(
        (a: { key: string }) => a.key,
      );

      expect(attrKeys).not.toContain("clef.agentId");
      expect(attrKeys).not.toContain("clef.identity");
      expect(attrKeys).not.toContain("clef.environment");
      expect(attrKeys).not.toContain("clef.sourceType");
      expect(attrKeys).not.toContain("clef.timestamp");
      expect(attrKeys).not.toContain("clef.type");
      emitter.stop();
    });

    it("should send correct headers", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://otel.example.com/v1/logs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer secret-token",
          }),
        }),
      );
      emitter.stop();
    });
  });

  describe("buffering and flush", () => {
    it("should flush on timer interval", () => {
      const emitter = new TelemetryEmitter(opts({ flushIntervalMs: 5_000 }));
      emitter.agentStarted({ version: "0.1.5" });

      jest.advanceTimersByTime(5_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
      emitter.stop();
    });

    it("should auto-flush when buffer reaches maxBufferSize", () => {
      const emitter = new TelemetryEmitter(opts({ maxBufferSize: 3 }));

      emitter.agentStarted({ version: "0.1.5" });
      emitter.agentStarted({ version: "0.1.5" });
      expect(mockFetch).not.toHaveBeenCalled();

      emitter.agentStarted({ version: "0.1.5" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3);
      emitter.stop();
    });

    it("should not flush when buffer is empty", () => {
      const emitter = new TelemetryEmitter(opts({ flushIntervalMs: 1_000 }));

      jest.advanceTimersByTime(1_000);
      expect(mockFetch).not.toHaveBeenCalled();
      emitter.stop();
    });

    it("should flush remaining events on stop()", () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      emitter.agentStarted({ version: "0.1.5" });
      emitter.stop();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2);
    });

    it("should flush remaining events on stopAsync()", async () => {
      const emitter = new TelemetryEmitter(opts());
      emitter.agentStarted({ version: "0.1.5" });
      await emitter.stopAsync();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not call fetch on stopAsync() when buffer is empty", async () => {
      const emitter = new TelemetryEmitter(opts());
      await emitter.stopAsync();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should swallow fetch errors in flush()", () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const emitter = new TelemetryEmitter(opts({ flushIntervalMs: 1_000 }));

      emitter.agentStarted({ version: "0.1.5" });
      expect(() => emitter.flush()).not.toThrow();
      emitter.stop();
    });

    it("should swallow fetch errors in flushAsync()", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const emitter = new TelemetryEmitter(opts());

      emitter.agentStarted({ version: "0.1.5" });
      await expect(emitter.flushAsync()).resolves.toBeUndefined();
    });

    it("should clear timer on stop", () => {
      const emitter = new TelemetryEmitter(opts({ flushIntervalMs: 1_000 }));
      emitter.agentStarted({ version: "0.1.5" });
      emitter.stop();
      mockFetch.mockClear();

      jest.advanceTimersByTime(5_000);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
