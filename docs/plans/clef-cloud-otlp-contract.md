# Clef Cloud: OTLP Telemetry Contract

**Status:** Ready for backend implementation
**Date:** 2026-03-22

---

## Overview

Clef Cloud is an OTLP-compatible telemetry backend for the Clef ecosystem. It receives structured events from CLI commands, CI pipelines, and runtime agents via standard `POST /v1/logs` — the same endpoint any OTLP collector exposes.

This document defines the complete contract: every event type, every attribute, every resource field. The backend team implements ingestion against this spec. The UI team builds governance views on top of the indexed data.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Event Sources                         │
├────────────────┬─────────────────────┬───────────────────────┤
│  CLI --push    │  CI --push          │  Runtime / Agent      │
│  (developer)   │  (GitHub Actions)   │  (containers/Lambda)  │
│                │                     │                       │
│  clef lint     │  clef lint --push   │  TelemetryEmitter     │
│  clef drift    │  clef drift --push  │  (buffered, async)    │
│  clef report   │  clef report --push │                       │
└───────┬────────┴──────────┬──────────┴───────────┬───────────┘
        │                   │                      │
        └───────────────────┼──────────────────────┘
                            │
                    POST /v1/logs
                  (OTLP/HTTP JSON)
                            │
                ┌───────────▼───────────┐
                │     Clef Cloud        │
                │                       │
                │  ┌─────────────────┐  │
                │  │ OTLP Ingestion  │  │
                │  └────────┬────────┘  │
                │           │           │
                │  ┌────────▼────────┐  │
                │  │ Event Store     │  │
                │  └────────┬────────┘  │
                │           │           │
                │  ┌────────▼────────┐  │
                │  │ Governance UI   │  │
                │  └─────────────────┘  │
                └───────────────────────┘
```

---

## Endpoint

```
POST /v1/logs
Content-Type: application/json
Authorization: <configurable via headers>
```

**Request body:** Standard OTLP `ExportLogsServiceRequest` JSON.
**Response:** `200 OK` with empty body (or standard OTLP `ExportLogsServiceResponse`).
**Error codes:** `401` (bad auth), `413` (batch too large), `429` (rate limited), `500`/`503` (server error).

The endpoint MUST accept the OTLP JSON encoding as specified in the [OTLP/HTTP spec](https://opentelemetry.io/docs/specs/otlp/#otlphttp). Protobuf encoding is not required.

---

## Event Inventory

### Source 1: Runtime / Agent

Emitted by `TelemetryEmitter` in `@clef-sh/runtime`. Continuous, real-time events from running workloads.

| Event name                | Severity | When                                             |
| ------------------------- | -------- | ------------------------------------------------ |
| `clef.agent.started`      | INFO     | Agent initialized successfully                   |
| `clef.agent.stopped`      | INFO     | Agent shutting down                              |
| `clef.artifact.refreshed` | INFO     | New revision decrypted and swapped into cache    |
| `clef.artifact.revoked`   | WARN     | Revocation envelope detected, cache wiped        |
| `clef.artifact.expired`   | WARN     | Artifact past `expiresAt`, cache wiped           |
| `clef.artifact.invalid`   | ERROR    | Fetched artifact failed validation or decryption |
| `clef.fetch.failed`       | WARN     | Artifact source unreachable                      |
| `clef.cache.expired`      | ERROR    | Cache TTL exceeded, agent stops serving          |

**Resource attributes:**

| Key                | Type   | Description                                |
| ------------------ | ------ | ------------------------------------------ |
| `service.name`     | string | Always `"clef-agent"`                      |
| `service.version`  | string | Agent package version                      |
| `clef.agent.id`    | string | Unique instance ID (UUID or custom)        |
| `clef.identity`    | string | Service identity name (e.g. `api-gateway`) |
| `clef.environment` | string | Target environment (e.g. `production`)     |
| `clef.source.type` | string | `"vcs"`, `"http"`, or `"file"`             |

**Scope:** `{ name: "clef.runtime", version: "<agent-version>" }`

### Source 2: CLI `--push`

Emitted by CLI commands via `pushOtlp()`. Discrete, CI-time events from lint/drift/report runs.

| Event name            | Severity      | When                    |
| --------------------- | ------------- | ----------------------- |
| `clef.lint.summary`   | INFO/WARN/ERR | Aggregate lint result   |
| `clef.lint.issue`     | per-issue     | Individual lint issue   |
| `clef.drift.summary`  | INFO/WARN     | Aggregate drift result  |
| `clef.drift.issue`    | WARN          | Individual drift issue  |
| `clef.report.summary` | INFO/ERR      | Aggregate report result |
| `clef.report.issue`   | per-issue     | Individual policy issue |

**Resource attributes:**

| Key                | Type   | Description                     |
| ------------------ | ------ | ------------------------------- |
| `service.name`     | string | Always `"clef-cli"`             |
| `service.version`  | string | CLI package version             |
| `clef.repo.origin` | string | Git remote origin (report only) |
| `clef.repo.commit` | string | HEAD commit SHA (report only)   |
| `clef.repo.branch` | string | Current branch (report only)    |

**Scope:** `{ name: "clef.cli", version: "<cli-version>" }`

---

## Event Attribute Reference

### `clef.agent.started`

| Attribute      | Type   | Description   |
| -------------- | ------ | ------------- |
| `clef.version` | string | Agent version |

### `clef.agent.stopped`

| Attribute            | Type   | Description                                   |
| -------------------- | ------ | --------------------------------------------- |
| `clef.reason`        | string | `"signal"`, `"error"`, or `"lambda_shutdown"` |
| `clef.uptimeSeconds` | int    | Seconds since start                           |

### `clef.artifact.refreshed`

| Attribute          | Type    | Description                   |
| ------------------ | ------- | ----------------------------- |
| `clef.revision`    | string  | Artifact revision identifier  |
| `clef.keyCount`    | int     | Number of keys in artifact    |
| `clef.kmsEnvelope` | boolean | Whether KMS envelope was used |

### `clef.artifact.revoked`

| Attribute        | Type   | Description                   |
| ---------------- | ------ | ----------------------------- |
| `clef.revokedAt` | string | ISO-8601 revocation timestamp |

### `clef.artifact.expired`

| Attribute        | Type   | Description               |
| ---------------- | ------ | ------------------------- |
| `clef.expiresAt` | string | ISO-8601 expiry timestamp |

### `clef.artifact.invalid`

| Attribute     | Type   | Description                     |
| ------------- | ------ | ------------------------------- |
| `clef.reason` | string | Machine-readable reason (below) |
| `clef.error`  | string | Error message                   |

**Reason values:** `json_parse`, `unsupported_version`, `missing_fields`, `incomplete_envelope`, `integrity`, `kms_unwrap`, `decrypt`, `payload_parse`

### `clef.fetch.failed`

| Attribute                 | Type    | Description                       |
| ------------------------- | ------- | --------------------------------- |
| `clef.error`              | string  | Error message                     |
| `clef.diskCacheAvailable` | boolean | Whether disk cache had a fallback |

### `clef.cache.expired`

| Attribute              | Type    | Description                   |
| ---------------------- | ------- | ----------------------------- |
| `clef.cacheTtlSeconds` | int     | Configured TTL in seconds     |
| `clef.diskCachePurged` | boolean | Whether disk cache was purged |

### `clef.lint.summary`

| Attribute           | Type    | Description              |
| ------------------- | ------- | ------------------------ |
| `clef.fileCount`    | int     | Matrix files checked     |
| `clef.pendingCount` | int     | Pending placeholder keys |
| `clef.errorCount`   | int     | Error-severity issues    |
| `clef.warningCount` | int     | Warning-severity issues  |
| `clef.infoCount`    | int     | Info-severity issues     |
| `clef.passed`       | boolean | `true` if zero errors    |

### `clef.lint.issue`

| Attribute         | Type   | Description                            |
| ----------------- | ------ | -------------------------------------- |
| `clef.severity`   | string | `"error"`, `"warning"`, or `"info"`    |
| `clef.category`   | string | `"matrix"`, `"schema"`, `"sops"`, etc. |
| `clef.file`       | string | Affected encrypted file path           |
| `clef.message`    | string | Human-readable issue description       |
| `clef.key`        | string | Affected key name (optional)           |
| `clef.fixCommand` | string | CLI command to auto-fix (optional)     |

### `clef.drift.summary`

| Attribute                 | Type    | Description              |
| ------------------------- | ------- | ------------------------ |
| `clef.namespacesCompared` | int     | Namespaces compared      |
| `clef.namespacesClean`    | int     | Namespaces with no drift |
| `clef.issueCount`         | int     | Total drift issues       |
| `clef.passed`             | boolean | `true` if zero issues    |

### `clef.drift.issue`

| Attribute          | Type   | Description                      |
| ------------------ | ------ | -------------------------------- |
| `clef.namespace`   | string | Affected namespace               |
| `clef.key`         | string | Key with inconsistent presence   |
| `clef.presentIn`   | string | Comma-separated environment list |
| `clef.missingFrom` | string | Comma-separated environment list |
| `clef.message`     | string | Human-readable description       |

### `clef.report.summary`

| Attribute           | Type    | Description             |
| ------------------- | ------- | ----------------------- |
| `clef.errorCount`   | int     | Error-severity issues   |
| `clef.warningCount` | int     | Warning-severity issues |
| `clef.infoCount`    | int     | Info-severity issues    |
| `clef.matrixCells`  | int     | Total matrix cells      |
| `clef.passed`       | boolean | `true` if zero errors   |

### `clef.report.issue`

| Attribute          | Type   | Description                         |
| ------------------ | ------ | ----------------------------------- |
| `clef.severity`    | string | `"error"`, `"warning"`, or `"info"` |
| `clef.category`    | string | Issue category                      |
| `clef.message`     | string | Human-readable description          |
| `clef.file`        | string | Affected file (optional)            |
| `clef.namespace`   | string | Affected namespace (optional)       |
| `clef.environment` | string | Affected environment (optional)     |

---

## Correlation Model

Events are correlated across three dimensions:

| Dimension    | Runtime source              | CLI source                                                                         |
| ------------ | --------------------------- | ---------------------------------------------------------------------------------- |
| **Identity** | `clef.identity` (resource)  | `clef.repo.origin` (resource) + `clef.namespace` / `clef.environment` (attributes) |
| **Instance** | `clef.agent.id` (resource)  | `clef.repo.commit` (resource)                                                      |
| **Time**     | `timeUnixNano` (per record) | `timeUnixNano` (per record)                                                        |

### Governance queries the backend should support

| Query                                     | Source events                                    | Key fields                                          |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| "Is identity X serving fresh secrets?"    | `artifact.refreshed`, `cache.expired`            | `clef.identity`, `clef.environment`, `timeUnixNano` |
| "Any revocations in the last 24h?"        | `artifact.revoked`                               | `clef.revokedAt`, `clef.identity`                   |
| "Are all agents healthy?"                 | `agent.started`, `agent.stopped`, `fetch.failed` | `clef.agent.id`, `clef.reason`                      |
| "Lint status across all repos?"           | `lint.summary`                                   | `clef.passed`, `clef.errorCount`, `service.version` |
| "Drift across repos?"                     | `drift.summary`, `drift.issue`                   | `clef.namespace`, `clef.key`, `clef.passed`         |
| "Which artifacts are failing validation?" | `artifact.invalid`                               | `clef.reason`, `clef.identity`, `clef.environment`  |
| "What's the fleet-wide refresh rate?"     | `artifact.refreshed`                             | aggregate `count` over `timeUnixNano` windows       |
| "Any agents running stale versions?"      | `agent.started`                                  | `service.version`, `clef.version`                   |

---

## Ingestion Requirements

### Must have

1. Accept `POST /v1/logs` with OTLP JSON encoding
2. Authenticate via configurable HTTP headers (Bearer token for most users)
3. Extract `event.name` from LogRecord attributes and index it as the primary event discriminator
4. Extract all `clef.*` attributes and make them queryable/filterable
5. Extract resource attributes (`clef.identity`, `clef.environment`, `clef.agent.id`) for correlation
6. Store `timeUnixNano` for time-range queries
7. Return `200 OK` on success, `401`/`429`/`500` on error

### Should have

8. Deduplication by `clef.agent.id` + `timeUnixNano` + `event.name` (agents may retry)
9. Batch support — a single request may contain multiple LogRecords
10. Rate limiting per integration (not per agent) to prevent runaway agents from flooding

### Nice to have

11. Accept `ExportLogsServiceRequest` protobuf encoding (`Content-Type: application/x-protobuf`)
12. Return partial success responses per OTLP spec (some records accepted, some rejected)

---

## Example Payloads

### Runtime: artifact refreshed

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "clef-agent" } },
          { "key": "service.version", "value": { "stringValue": "0.1.5" } },
          { "key": "clef.agent.id", "value": { "stringValue": "api-gw-prod-01" } },
          { "key": "clef.identity", "value": { "stringValue": "api-gateway" } },
          { "key": "clef.environment", "value": { "stringValue": "production" } },
          { "key": "clef.source.type", "value": { "stringValue": "vcs" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "clef.runtime", "version": "0.1.5" },
          "logRecords": [
            {
              "timeUnixNano": "1711123200000000000",
              "severityNumber": 9,
              "severityText": "INFO",
              "body": { "stringValue": "artifact.refreshed" },
              "attributes": [
                { "key": "event.name", "value": { "stringValue": "clef.artifact.refreshed" } },
                { "key": "clef.revision", "value": { "stringValue": "1711123200000" } },
                { "key": "clef.keyCount", "value": { "intValue": "12" } },
                { "key": "clef.kmsEnvelope", "value": { "boolValue": false } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### CLI: lint --push (CI pipeline)

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "clef-cli" } },
          { "key": "service.version", "value": { "stringValue": "0.1.5" } }
        ]
      },
      "scopeLogs": [
        {
          "scope": { "name": "clef.cli", "version": "0.1.5" },
          "logRecords": [
            {
              "timeUnixNano": "1711123200000000000",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": { "stringValue": "lint.summary" },
              "attributes": [
                { "key": "event.name", "value": { "stringValue": "clef.lint.summary" } },
                { "key": "clef.fileCount", "value": { "intValue": "24" } },
                { "key": "clef.pendingCount", "value": { "intValue": "0" } },
                { "key": "clef.errorCount", "value": { "intValue": "2" } },
                { "key": "clef.warningCount", "value": { "intValue": "1" } },
                { "key": "clef.infoCount", "value": { "intValue": "0" } },
                { "key": "clef.passed", "value": { "boolValue": false } }
              ]
            },
            {
              "timeUnixNano": "1711123200000000000",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": { "stringValue": "Missing required key DB_URL" },
              "attributes": [
                { "key": "event.name", "value": { "stringValue": "clef.lint.issue" } },
                { "key": "clef.severity", "value": { "stringValue": "error" } },
                { "key": "clef.category", "value": { "stringValue": "schema" } },
                { "key": "clef.file", "value": { "stringValue": "payments/production.enc.yaml" } },
                { "key": "clef.key", "value": { "stringValue": "DB_URL" } },
                { "key": "clef.message", "value": { "stringValue": "Missing required key DB_URL" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## What Clef Cloud Is NOT

- **Not a log aggregator** — it indexes Clef-specific events, not arbitrary application logs
- **Not a secrets store** — no ciphertext, no plaintext, no key values ever transit the endpoint
- **Not required** — users can point at Grafana, Datadog, or any OTLP backend. Clef Cloud is one option with Clef-specific governance views built in
