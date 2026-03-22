import {
  lintResultToOtlp,
  driftResultToOtlp,
  reportToOtlp,
  resolveTelemetryConfig,
  pushOtlp,
  parseHeaders,
} from "./otlp";
import type { LintResult, DriftResult, ClefReport } from "@clef-sh/core";

describe("OTLP serializers", () => {
  describe("lintResultToOtlp", () => {
    it("should produce valid OTLP JSON with summary and issue records", () => {
      const result: LintResult = {
        issues: [
          {
            severity: "error",
            category: "schema",
            file: "payments/production.enc.yaml",
            key: "DB_URL",
            message: "Key DB_URL fails schema validation",
          },
          {
            severity: "warning",
            category: "matrix",
            file: "auth/staging.enc.yaml",
            message: "Missing matrix cell",
            fixCommand: "clef update",
          },
        ],
        fileCount: 10,
        pendingCount: 2,
      };

      const json = JSON.parse(lintResultToOtlp(result, "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      // Summary + 2 issues = 3 records
      expect(records).toHaveLength(3);

      // Summary record
      expect(records[0].body.stringValue).toBe("lint.summary");
      expect(records[0].attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.lint.summary" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.fileCount",
        value: { intValue: "10" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.errorCount",
        value: { intValue: "1" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.passed",
        value: { boolValue: false },
      });
      // Summary severity should be ERROR since there are errors
      expect(records[0].severityText).toBe("ERROR");

      // First issue record
      expect(records[1].attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.lint.issue" },
      });
      expect(records[1].attributes).toContainEqual({
        key: "clef.key",
        value: { stringValue: "DB_URL" },
      });
      expect(records[1].severityText).toBe("ERROR");

      // Second issue record (warning)
      expect(records[2].severityText).toBe("WARN");
      expect(records[2].attributes).toContainEqual({
        key: "clef.fixCommand",
        value: { stringValue: "clef update" },
      });
    });

    it("should set passed=true when no errors", () => {
      const result: LintResult = { issues: [], fileCount: 5, pendingCount: 0 };
      const json = JSON.parse(lintResultToOtlp(result, "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records).toHaveLength(1); // summary only
      expect(records[0].attributes).toContainEqual({
        key: "clef.passed",
        value: { boolValue: true },
      });
      expect(records[0].severityText).toBe("INFO");
    });

    it("should set resource and scope correctly", () => {
      const result: LintResult = { issues: [], fileCount: 0, pendingCount: 0 };
      const json = JSON.parse(lintResultToOtlp(result, "2.0.0"));

      const resource = json.resourceLogs[0].resource.attributes;
      expect(resource).toContainEqual({
        key: "service.name",
        value: { stringValue: "clef-cli" },
      });
      expect(resource).toContainEqual({
        key: "service.version",
        value: { stringValue: "2.0.0" },
      });

      const scope = json.resourceLogs[0].scopeLogs[0].scope;
      expect(scope).toEqual({ name: "clef.cli", version: "2.0.0" });
    });
  });

  describe("driftResultToOtlp", () => {
    it("should produce summary and issue records", () => {
      const result: DriftResult = {
        issues: [
          {
            namespace: "payments",
            key: "STRIPE_KEY",
            presentIn: ["production"],
            missingFrom: ["staging"],
            message: "STRIPE_KEY present in production but missing from staging",
          },
        ],
        namespacesCompared: 3,
        namespacesClean: 2,
        localEnvironments: ["production", "staging"],
        remoteEnvironments: ["production", "staging"],
      };

      const json = JSON.parse(driftResultToOtlp(result, "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records).toHaveLength(2); // summary + 1 issue

      // Summary
      expect(records[0].attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.drift.summary" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.namespacesCompared",
        value: { intValue: "3" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.passed",
        value: { boolValue: false },
      });
      expect(records[0].severityText).toBe("WARN");

      // Issue
      expect(records[1].attributes).toContainEqual({
        key: "event.name",
        value: { stringValue: "clef.drift.issue" },
      });
      expect(records[1].attributes).toContainEqual({
        key: "clef.namespace",
        value: { stringValue: "payments" },
      });
      expect(records[1].attributes).toContainEqual({
        key: "clef.key",
        value: { stringValue: "STRIPE_KEY" },
      });
    });

    it("should set passed=true when no issues", () => {
      const result: DriftResult = {
        issues: [],
        namespacesCompared: 2,
        namespacesClean: 2,
        localEnvironments: ["dev"],
        remoteEnvironments: ["dev"],
      };

      const json = JSON.parse(driftResultToOtlp(result, "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records).toHaveLength(1);
      expect(records[0].attributes).toContainEqual({
        key: "clef.passed",
        value: { boolValue: true },
      });
      expect(records[0].severityText).toBe("INFO");
    });
  });

  describe("reportToOtlp", () => {
    function makeReport(overrides: Partial<ClefReport> = {}): ClefReport {
      return {
        schemaVersion: 1,
        repoIdentity: {
          repoOrigin: "github.com/org/repo",
          commitSha: "abc123",
          branch: "main",
          commitTimestamp: "2024-01-15T10:00:00Z",
          reportGeneratedAt: "2024-01-15T11:00:00Z",
          clefVersion: "1.0.0",
          sopsVersion: "3.9.4",
        },
        manifest: {
          manifestVersion: 1,
          filePattern: "{namespace}/{environment}.enc.yaml",
          environments: [{ name: "dev", protected: false }],
          namespaces: [{ name: "database", hasSchema: false, owners: [] }],
          defaultBackend: "age",
        },
        matrix: [
          {
            namespace: "database",
            environment: "dev",
            filePath: "/repo/database/dev.enc.yaml",
            exists: true,
            keyCount: 3,
            pendingCount: 0,
            metadata: {
              backend: "age",
              recipients: ["age1abc"],
              lastModified: "2024-01-15T10:00:00.000Z",
            },
          },
        ],
        policy: {
          issueCount: { error: 0, warning: 0, info: 0 },
          issues: [],
        },
        recipients: {},
        ...overrides,
      };
    }

    it("should include repo identity in resource attributes", () => {
      const json = JSON.parse(reportToOtlp(makeReport(), "1.0.0"));
      const attrs = json.resourceLogs[0].resource.attributes;

      expect(attrs).toContainEqual({
        key: "clef.repo.origin",
        value: { stringValue: "github.com/org/repo" },
      });
      expect(attrs).toContainEqual({
        key: "clef.repo.commit",
        value: { stringValue: "abc123" },
      });
      expect(attrs).toContainEqual({
        key: "clef.repo.branch",
        value: { stringValue: "main" },
      });
    });

    it("should produce summary and policy issue records", () => {
      const report = makeReport({
        policy: {
          issueCount: { error: 1, warning: 1, info: 0 },
          issues: [
            { severity: "error", category: "schema", message: "Schema violation", file: "a.yaml" },
            {
              severity: "warning",
              category: "matrix",
              message: "Missing cell",
              namespace: "db",
              environment: "staging",
            },
          ],
        },
      });

      const json = JSON.parse(reportToOtlp(report, "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records).toHaveLength(3); // summary + 2 issues

      // Summary
      expect(records[0].attributes).toContainEqual({
        key: "clef.errorCount",
        value: { intValue: "1" },
      });
      expect(records[0].attributes).toContainEqual({
        key: "clef.matrixCells",
        value: { intValue: "1" },
      });
      expect(records[0].severityText).toBe("ERROR");

      // Error issue
      expect(records[1].severityText).toBe("ERROR");
      expect(records[1].attributes).toContainEqual({
        key: "clef.file",
        value: { stringValue: "a.yaml" },
      });

      // Warning issue
      expect(records[2].severityText).toBe("WARN");
      expect(records[2].attributes).toContainEqual({
        key: "clef.namespace",
        value: { stringValue: "db" },
      });
    });

    it("should set passed=true when no errors", () => {
      const json = JSON.parse(reportToOtlp(makeReport(), "1.0.0"));
      const records = json.resourceLogs[0].scopeLogs[0].logRecords;

      expect(records[0].attributes).toContainEqual({
        key: "clef.passed",
        value: { boolValue: true },
      });
      expect(records[0].severityText).toBe("INFO");
    });
  });

  describe("parseHeaders", () => {
    it("should parse comma-separated key=value pairs", () => {
      expect(parseHeaders("Authorization=Bearer tok123,X-Custom=foo")).toEqual({
        Authorization: "Bearer tok123",
        "X-Custom": "foo",
      });
    });

    it("should handle Datadog-style headers", () => {
      expect(parseHeaders("DD-API-KEY=abc123")).toEqual({ "DD-API-KEY": "abc123" });
    });

    it("should trim whitespace", () => {
      expect(parseHeaders(" Key = Value , Key2 = Value2 ")).toEqual({
        Key: "Value",
        Key2: "Value2",
      });
    });

    it("should handle values containing equals signs", () => {
      expect(parseHeaders("Authorization=Basic dXNlcjpwYXNz")).toEqual({
        Authorization: "Basic dXNlcjpwYXNz",
      });
    });
  });

  describe("resolveTelemetryConfig", () => {
    it("should return config with URL and parsed headers", () => {
      const config = resolveTelemetryConfig({
        CLEF_TELEMETRY_URL: "https://otel.example.com/v1/logs",
        CLEF_TELEMETRY_HEADERS: "Authorization=Bearer tok_abc",
      });
      expect(config).toEqual({
        url: "https://otel.example.com/v1/logs",
        headers: { Authorization: "Bearer tok_abc" },
      });
    });

    it("should return config with empty headers when only URL is set", () => {
      const config = resolveTelemetryConfig({
        CLEF_TELEMETRY_URL: "https://otel.example.com/v1/logs",
      });
      expect(config).toEqual({
        url: "https://otel.example.com/v1/logs",
        headers: {},
      });
    });

    it("should return undefined when URL is not set", () => {
      expect(resolveTelemetryConfig({})).toBeUndefined();
    });

    it("should return undefined when only headers are set without URL", () => {
      expect(resolveTelemetryConfig({ CLEF_TELEMETRY_HEADERS: "DD-API-KEY=abc" })).toBeUndefined();
    });
  });

  describe("pushOtlp", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should POST payload with custom headers", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await pushOtlp('{"test":true}', {
        url: "https://otel.example.com/v1/logs",
        headers: { "DD-API-KEY": "abc123" },
      });

      expect(mockFetch).toHaveBeenCalledWith("https://otel.example.com/v1/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": "abc123",
        },
        body: '{"test":true}',
      });
    });

    it("should POST with only Content-Type when no custom headers", async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await pushOtlp("{}", {
        url: "https://otel.example.com/v1/logs",
        headers: {},
      });

      expect(mockFetch).toHaveBeenCalledWith("https://otel.example.com/v1/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    });

    it("should throw on non-ok response", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });

      await expect(
        pushOtlp("{}", { url: "https://otel.example.com/v1/logs", headers: {} }),
      ).rejects.toThrow("Telemetry push failed: 401 Unauthorized");
    });
  });
});
