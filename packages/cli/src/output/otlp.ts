/**
 * Shared OTLP JSON serializer and push for CLI commands.
 *
 * Converts lint, drift, and report results into OTLP ExportLogsServiceRequest
 * JSON — the same wire format used by the runtime telemetry emitter — and
 * pushes directly to any OTLP-compatible endpoint.
 * Zero dependencies: hand-constructed JSON, no SDK, no protobuf.
 */
import type { LintResult, LintIssue, DriftResult, DriftIssue, ClefReport } from "@clef-sh/core";

type OtlpAttributeValue = { stringValue?: string; intValue?: string; boolValue?: boolean };
interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

function str(v: string): OtlpAttributeValue {
  return { stringValue: v };
}
function num(v: number): OtlpAttributeValue {
  return { intValue: String(v) };
}
function bool(v: boolean): OtlpAttributeValue {
  return { boolValue: v };
}

function nowNano(): string {
  return String(Date.now() * 1_000_000);
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
}

const SEV = {
  INFO: { number: 9, text: "INFO" },
  WARN: { number: 13, text: "WARN" },
  ERROR: { number: 17, text: "ERROR" },
} as const;

function lintSeverity(s: string): (typeof SEV)[keyof typeof SEV] {
  if (s === "error") return SEV.ERROR;
  if (s === "warning") return SEV.WARN;
  return SEV.INFO;
}

function wrapPayload(
  records: OtlpLogRecord[],
  version: string,
  resourceAttrs?: OtlpAttribute[],
): string {
  const defaultResource: OtlpAttribute[] = [
    { key: "service.name", value: str("clef-cli") },
    { key: "service.version", value: str(version) },
  ];

  return JSON.stringify(
    {
      resourceLogs: [
        {
          resource: { attributes: resourceAttrs ?? defaultResource },
          scopeLogs: [
            {
              scope: { name: "clef.cli", version },
              logRecords: records,
            },
          ],
        },
      ],
    },
    null,
    2,
  );
}

// ── Lint ──────────────────────────────────────────────────────────────────────

function lintIssueToRecord(issue: LintIssue): OtlpLogRecord {
  const sev = lintSeverity(issue.severity);
  const attrs: OtlpAttribute[] = [
    { key: "event.name", value: str("clef.lint.issue") },
    { key: "clef.severity", value: str(issue.severity) },
    { key: "clef.category", value: str(issue.category) },
    { key: "clef.file", value: str(issue.file) },
    { key: "clef.message", value: str(issue.message) },
  ];
  if (issue.key) attrs.push({ key: "clef.key", value: str(issue.key) });
  if (issue.fixCommand) attrs.push({ key: "clef.fixCommand", value: str(issue.fixCommand) });

  return {
    timeUnixNano: nowNano(),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: issue.message },
    attributes: attrs,
  };
}

export function lintResultToOtlp(result: LintResult, version: string): string {
  const records: OtlpLogRecord[] = [];

  // Summary record
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  const infos = result.issues.filter((i) => i.severity === "info").length;
  const sev = errors > 0 ? SEV.ERROR : warnings > 0 ? SEV.WARN : SEV.INFO;

  records.push({
    timeUnixNano: nowNano(),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: "lint.summary" },
    attributes: [
      { key: "event.name", value: str("clef.lint.summary") },
      { key: "clef.fileCount", value: num(result.fileCount) },
      { key: "clef.pendingCount", value: num(result.pendingCount) },
      { key: "clef.errorCount", value: num(errors) },
      { key: "clef.warningCount", value: num(warnings) },
      { key: "clef.infoCount", value: num(infos) },
      { key: "clef.passed", value: bool(errors === 0) },
    ],
  });

  // Individual issue records
  for (const issue of result.issues) {
    records.push(lintIssueToRecord(issue));
  }

  return wrapPayload(records, version);
}

// ── Drift ────────────────────────────────────────────────────────────────────

function driftIssueToRecord(issue: DriftIssue): OtlpLogRecord {
  return {
    timeUnixNano: nowNano(),
    severityNumber: SEV.WARN.number,
    severityText: SEV.WARN.text,
    body: { stringValue: issue.message },
    attributes: [
      { key: "event.name", value: str("clef.drift.issue") },
      { key: "clef.namespace", value: str(issue.namespace) },
      { key: "clef.key", value: str(issue.key) },
      { key: "clef.presentIn", value: str(issue.presentIn.join(", ")) },
      { key: "clef.missingFrom", value: str(issue.missingFrom.join(", ")) },
      { key: "clef.message", value: str(issue.message) },
    ],
  };
}

export function driftResultToOtlp(result: DriftResult, version: string): string {
  const records: OtlpLogRecord[] = [];
  const sev = result.issues.length > 0 ? SEV.WARN : SEV.INFO;

  records.push({
    timeUnixNano: nowNano(),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: "drift.summary" },
    attributes: [
      { key: "event.name", value: str("clef.drift.summary") },
      { key: "clef.namespacesCompared", value: num(result.namespacesCompared) },
      { key: "clef.namespacesClean", value: num(result.namespacesClean) },
      { key: "clef.issueCount", value: num(result.issues.length) },
      { key: "clef.passed", value: bool(result.issues.length === 0) },
    ],
  });

  for (const issue of result.issues) {
    records.push(driftIssueToRecord(issue));
  }

  return wrapPayload(records, version);
}

// ── Report ───────────────────────────────────────────────────────────────────

export function reportToOtlp(report: ClefReport, version: string): string {
  const records: OtlpLogRecord[] = [];
  const { policy, repoIdentity } = report;
  const sev = policy.issueCount.error > 0 ? SEV.ERROR : SEV.INFO;

  // Resource attributes include repo identity
  const resourceAttrs: OtlpAttribute[] = [
    { key: "service.name", value: str("clef-cli") },
    { key: "service.version", value: str(version) },
    { key: "clef.repo.origin", value: str(repoIdentity.repoOrigin ?? "") },
    { key: "clef.repo.commit", value: str(repoIdentity.commitSha ?? "") },
    { key: "clef.repo.branch", value: str(repoIdentity.branch ?? "") },
  ];

  // Summary record
  records.push({
    timeUnixNano: nowNano(),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: "report.summary" },
    attributes: [
      { key: "event.name", value: str("clef.report.summary") },
      { key: "clef.errorCount", value: num(policy.issueCount.error) },
      { key: "clef.warningCount", value: num(policy.issueCount.warning) },
      { key: "clef.infoCount", value: num(policy.issueCount.info) },
      { key: "clef.matrixCells", value: num(report.matrix.length) },
      { key: "clef.passed", value: bool(policy.issueCount.error === 0) },
    ],
  });

  // Policy issue records
  for (const issue of policy.issues) {
    const issueSev = lintSeverity(issue.severity);
    const attrs: OtlpAttribute[] = [
      { key: "event.name", value: str("clef.report.issue") },
      { key: "clef.severity", value: str(issue.severity) },
      { key: "clef.category", value: str(issue.category) },
      { key: "clef.message", value: str(issue.message) },
    ];
    if (issue.file) attrs.push({ key: "clef.file", value: str(issue.file) });
    if (issue.namespace) attrs.push({ key: "clef.namespace", value: str(issue.namespace) });
    if (issue.environment) attrs.push({ key: "clef.environment", value: str(issue.environment) });

    records.push({
      timeUnixNano: nowNano(),
      severityNumber: issueSev.number,
      severityText: issueSev.text,
      body: { stringValue: issue.message },
      attributes: attrs,
    });
  }

  return wrapPayload(records, version, resourceAttrs);
}

// ── Push ─────────────────────────────────────────────────────────────────────

/** Resolved telemetry config from environment. */
export interface TelemetryPushConfig {
  url: string;
  headers: Record<string, string>;
}

/**
 * Parse a comma-separated `key=value` header string (OTEL convention).
 *
 * Example: `"Authorization=Bearer tok123,X-Custom=foo"` →
 * `{ Authorization: "Bearer tok123", "X-Custom": "foo" }`
 */
export function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return headers;
}

/**
 * Resolve OTLP telemetry config from environment variables.
 * Returns undefined if `CLEF_TELEMETRY_URL` is not set.
 *
 * Headers come from `CLEF_TELEMETRY_HEADERS` (comma-separated `key=value` pairs,
 * following the OTEL `OTEL_EXPORTER_OTLP_HEADERS` convention).
 */
export function resolveTelemetryConfig(
  env: Record<string, string | undefined> = process.env,
): TelemetryPushConfig | undefined {
  const url = env.CLEF_TELEMETRY_URL;
  if (!url) return undefined;

  const headersRaw = env.CLEF_TELEMETRY_HEADERS;
  const headers = headersRaw ? parseHeaders(headersRaw) : {};

  return { url, headers };
}

/** Push an OTLP JSON payload to the configured endpoint. Throws on failure. */
export async function pushOtlp(payload: string, config: TelemetryPushConfig): Promise<void> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...config.headers },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Telemetry push failed: ${res.status} ${res.statusText}`);
  }
}
