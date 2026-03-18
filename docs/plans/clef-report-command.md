# `clef report` — Command Requirements

**Status:** Draft for architect review
**Date:** 2026-03-17
**Parent:** [Clef Cloud Product Strategy](./clef-cloud-product-strategy.md)

---

## Purpose

`clef report` is the foundational command for Clef Cloud. It extracts metadata from a Clef-managed repository and produces a structured report that can be:

1. Displayed in the terminal for local review
2. Output as JSON for CI pipelines
3. POSTed to the Clef Cloud API by the `clef-sh/report` GitHub Action

The command **never** includes ciphertext or decrypted values in its output.

---

## Usage

```bash
# Human-readable terminal output
clef report

# JSON output (for CI / piping)
clef report --json

# POST directly to Clef Cloud API
clef report --push --api-token <token>

# Filter to specific namespaces or environments
clef report --namespace payments --environment production
```

---

## Report Contents

### 1. Repository Identity

Context for the control plane to associate the report with the correct repo and point in time.

| Field               | Source                       | Example                           |
| ------------------- | ---------------------------- | --------------------------------- |
| `repoOrigin`        | `git remote get-url origin`  | `github.com/acme/billing-service` |
| `commitSha`         | `git rev-parse HEAD`         | `a1b2c3d`                         |
| `branch`            | `git branch --show-current`  | `main`                            |
| `commitTimestamp`   | `git log -1 --format=%cI`    | `2026-03-17T10:30:00Z`            |
| `reportGeneratedAt` | Current time                 | `2026-03-17T10:31:05Z`            |
| `clefVersion`       | CLI package version          | `0.12.0`                          |
| `sopsVersion`       | Resolved sops binary version | `3.9.4`                           |

### 2. Manifest Structure

Extracted from `clef.yaml`. Tells the control plane what this repo declares.

```json
{
  "manifestVersion": 1,
  "filePattern": "{namespace}/{environment}.enc.yaml",
  "environments": [
    { "name": "development", "protected": false },
    { "name": "staging", "protected": false },
    { "name": "production", "protected": true }
  ],
  "namespaces": [
    { "name": "api", "hasSchema": true, "owners": ["backend-team"] },
    { "name": "payments", "hasSchema": true, "owners": ["payments-team"] }
  ],
  "defaultBackend": "age"
}
```

Note: schema content is not included — only whether a schema exists. The control plane can verify schema _coverage_, not schema _correctness_ (that requires decryption).

### 3. Matrix Status

Per-cell metadata for every (namespace, environment) pair. This is the core of the report.

```json
{
  "matrix": [
    {
      "namespace": "api",
      "environment": "production",
      "filePath": "api/production.enc.yaml",
      "exists": true,
      "keyCount": 12,
      "pendingCount": 0,
      "metadata": {
        "backend": "age",
        "recipients": ["age1qy8mx5...a4wk", "age1w2nf0x...9dkr"],
        "lastModified": "2026-03-10T14:22:00Z"
      }
    },
    {
      "namespace": "api",
      "environment": "staging",
      "filePath": "api/staging.enc.yaml",
      "exists": true,
      "keyCount": 12,
      "pendingCount": 2,
      "metadata": {
        "backend": "age",
        "recipients": ["age1qy8mx5...a4wk"],
        "lastModified": "2026-02-15T09:10:00Z"
      }
    },
    {
      "namespace": "payments",
      "environment": "production",
      "filePath": "payments/production.enc.yaml",
      "exists": false,
      "keyCount": 0,
      "pendingCount": 0,
      "metadata": null
    }
  ]
}
```

**Key design decisions:**

- **Key names are never sent — only counts.** Key names are plaintext in SOPS files but could reveal what kind of secrets exist (e.g., `STRIPE_API_KEY`). The control plane detects drift by comparing key counts across environments in the same namespace — if `api/production` has 12 keys and `api/staging` has 10, that's 2 keys drifting. The developer resolves _which_ keys locally using `clef lint` or `clef drift`, where key names are already visible. This keeps the trust boundary clean: the control plane knows the shape of the problem, the developer fixes it with local tools.
- **Recipient fingerprints are truncated** in terminal display but full in JSON output. The control plane needs full fingerprints to match against declared recipients in policy.
- **`pendingCount`** comes from `.clef-meta.yaml` sidecar files — these are pending placeholder values awaiting real secret values.

### 4. Policy Evaluation (Local)

The CI runner has full access to everything — it can decrypt, validate schemas, compare key sets, and run the complete lint and drift suites. The constraint is only on **what leaves the runner in the payload**. The runner performs all analysis locally and sends **conclusions**, not raw data.

This means the report includes results from checks that require decryption (schema validation, key-level drift), but the results are sanitized to exclude key names and values.

```json
{
  "policy": {
    "issueCount": { "error": 2, "warning": 4, "info": 2 },
    "issues": [
      {
        "severity": "error",
        "category": "matrix",
        "file": "payments/production.enc.yaml",
        "message": "Missing encrypted file for matrix cell"
      },
      {
        "severity": "error",
        "category": "schema",
        "namespace": "api",
        "environment": "staging",
        "message": "3 keys fail schema validation",
        "count": 3
      },
      {
        "severity": "warning",
        "category": "drift",
        "namespace": "api",
        "message": "2 keys present in production but missing from staging",
        "driftCount": 2,
        "sourceEnvironment": "production",
        "targetEnvironment": "staging"
      },
      {
        "severity": "warning",
        "category": "sops",
        "file": "api/staging.enc.yaml",
        "message": "Single recipient — no key recovery possible if lost"
      },
      {
        "severity": "warning",
        "category": "sops",
        "file": "api/staging.enc.yaml",
        "message": "Recipient mismatch: expected 2 recipients, found 1"
      },
      {
        "severity": "warning",
        "category": "drift",
        "namespace": "payments",
        "message": "1 key present in development but missing from staging",
        "driftCount": 1,
        "sourceEnvironment": "development",
        "targetEnvironment": "staging"
      },
      {
        "severity": "info",
        "category": "matrix",
        "file": "api/staging.enc.yaml",
        "message": "2 pending keys awaiting values"
      },
      {
        "severity": "info",
        "category": "matrix",
        "file": "api/development.enc.yaml",
        "message": "1 pending key awaiting value"
      }
    ]
  }
}
```

**What the CI evaluates locally vs what it sends:**

| Check               | Runs locally with full access                  | What's sent in the report                                                         |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Schema validation   | Decrypts values, validates against YAML schema | "N keys fail schema validation" (no key names, no values, no schema content)      |
| Key drift           | Compares key name sets across environments     | "N keys drifting between env A and env B" (no key names)                          |
| Recipient drift     | Compares actual recipients vs declared         | Full recipient fingerprints + expected vs actual (already public in `.sops.yaml`) |
| Matrix completeness | Checks file existence                          | Missing file paths (already public in git)                                        |
| Pending keys        | Reads `.clef-meta.yaml`                        | Count of pending keys per cell (no key names)                                     |
| Single recipient    | Reads SOPS metadata                            | Which files have only one recipient                                               |

The control plane receives enough detail to show compliance posture and flag problems. The developer resolves specifics locally with `clef lint`, `clef drift`, or `clef diff`.

### 5. Recipient Summary

An aggregated view of who can decrypt what. Useful for the control plane to build org-wide access maps.

```json
{
  "recipients": {
    "age1qy8mx5...a4wk": {
      "type": "age",
      "environments": ["development", "staging", "production"],
      "fileCount": 6
    },
    "age1w2nf0x...9dkr": {
      "type": "age",
      "environments": ["production"],
      "fileCount": 2
    },
    "arn:aws:kms:us-east-1:123456789:key/abc-def": {
      "type": "awskms",
      "environments": ["production"],
      "fileCount": 2
    }
  }
}
```

---

## What the Report Excludes

These are hard constraints, not defaults:

- **Ciphertext** — never included, no flag to override
- **Decrypted values** — never included, no flag to override
- **Key names** — never included; only counts and aggregate conclusions derived from key-level analysis
- **Schema content** — only whether a schema exists and how many keys pass/fail validation
- **Raw file contents** — only structured metadata and evaluation results

The principle: the CI runner has full access and performs complete analysis locally. Only **aggregate conclusions** leave the runner — counts, pass/fail results, and metadata that's already public in git (file paths, recipient fingerprints, manifest structure).

---

## Terminal Output

### Default View

```
$ clef report

  Clef Report — acme/billing-service @ a1b2c3d (main)
  Generated: 2026-03-17 10:31:05 UTC

  Matrix (2 namespaces × 3 environments)
  ┌────────────┬─────────────┬─────────┬────────────┐
  │ Namespace  │ Environment │ Keys    │ Last Rotated │
  ├────────────┼─────────────┼─────────┼────────────┤
  │ api        │ development │ 12      │ 3 days ago   │
  │ api        │ staging     │ 12 (2P) │ 30 days ago  │
  │ api        │ production  │ 12      │ 7 days ago   │
  │ payments   │ development │ 8       │ 5 days ago   │
  │ payments   │ staging     │ 8       │ 5 days ago   │
  │ payments   │ production  │ —       │ MISSING      │
  └────────────┴─────────────┴─────────┴────────────┘

  (2P) = 2 pending keys

  Recipients
  ┌──────────────────┬──────┬───────────────────────────────┐
  │ Fingerprint      │ Type │ Environments                  │
  ├──────────────────┼──────┼───────────────────────────────┤
  │ age1qy8m...a4wk  │ age  │ development, staging, production │
  │ age1w2nf...9dkr  │ age  │ production                    │
  │ arn:aws:kms:...  │ kms  │ production                    │
  └──────────────────┴──────┴───────────────────────────────┘

  Issues (2 errors, 4 warnings, 2 info)

  ✖ payments/production — Missing encrypted file
  ✖ api/staging — 3 keys fail schema validation

  ⚠ api — 2 keys in production missing from staging
  ⚠ payments — 1 key in development missing from staging
  ⚠ api/staging.enc.yaml — Single recipient, no recovery possible
  ⚠ api/staging.enc.yaml — Recipient mismatch: expected 2, found 1

  ℹ api/staging — 2 pending keys awaiting values
  ℹ api/development — 1 pending key awaiting value

  ✖ 2 errors  ⚠ 4 warnings  ℹ 2 info

  Run clef lint or clef drift locally for details.
```

### JSON View

`clef report --json` outputs the full JSON structure described above. No formatting, no color. One JSON object to stdout.

---

## `--push` Flag

```bash
clef report --push --api-token $CLEF_API_TOKEN
```

Behavior:

1. Generates the report (same as `--json`)
2. POSTs it to `https://api.clef.sh/v1/reports`
3. Prints the response (accepted, policy violations found, etc.)

The `--api-token` can also be read from the `CLEF_API_TOKEN` environment variable.

The `--push` flag implies `--json` internally (the API receives the JSON report), but the terminal still shows a human-readable confirmation:

```
$ clef report --push

  ✓ Report pushed to Clef Cloud
    Repo: acme/billing-service @ a1b2c3d
    Issues: 1 error, 3 warnings
    Dashboard: https://app.clef.sh/acme/billing-service/reports/latest
```

---

## Implementation Notes

### No New Analysis Logic

`clef report` does not implement any new analysis. It is an orchestrator that:

1. Calls existing commands with full local access
2. Sanitizes their output (strips key names, values, ciphertext)
3. Aggregates sanitized results into a single payload
4. Displays or pushes the payload

```
┌─────────────────────────────────────────────────────┐
│                   CI Runner (full access)            │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ LintRunner│  │ DriftDetector│  │ MatrixManager │  │
│  │ (full,    │  │ (full, with  │  │ + SopsClient  │  │
│  │ decrypts) │  │  key names)  │  │ (metadata)    │  │
│  └─────┬─────┘  └──────┬───────┘  └──────┬────────┘  │
│        │               │                │            │
│        ▼               ▼                ▼            │
│  ┌─────────────────────────────────────────────┐     │
│  │            ReportSanitizer                   │     │
│  │                                             │     │
│  │  - Key names → counts                       │     │
│  │  - Schema failures → "N keys fail"          │     │
│  │  - Drift details → "N keys drifting"        │     │
│  │  - Values/ciphertext → stripped entirely     │     │
│  │  - File paths, recipients → pass through    │     │
│  └──────────────────┬──────────────────────────┘     │
│                     │                                │
│                     ▼                                │
│              ClefReport JSON                         │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼  POST (sanitized payload only)
           Clef Cloud API
```

Improvements to `LintRunner`, `DriftDetector`, or `MatrixManager` automatically improve the report. Existing test coverage for those modules covers analysis correctness. Report-specific tests only need to verify:

- Sanitization (no key names or values leak into the payload)
- Aggregation (results from all sources are combined correctly)
- Formatting (terminal and JSON output are correct)

### What Each Existing Module Contributes

| Module                            | Called with                               | Contributes to report                                                                                                                                |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ManifestParser`                  | `clef.yaml` path                          | Manifest structure: namespaces, environments, schemas declared, file pattern, default backend                                                        |
| `MatrixManager.getMatrixStatus()` | Manifest + repo root                      | Per-cell status: file existence, key counts, pending counts, last modified                                                                           |
| `SopsClient.getMetadata()`        | Each encrypted file                       | Per-cell SOPS metadata: backend type, recipient fingerprints, last modified timestamp                                                                |
| `LintRunner`                      | Full run (decrypts for schema validation) | Policy issues: matrix completeness, recipient drift, schema validation failures (sanitized to counts), single-recipient warnings, pending key counts |
| `DriftDetector`                   | Cross-environment comparison              | Drift issues: key set differences across environments (sanitized to counts per namespace/environment pair)                                           |
| `getPendingKeys()`                | `.clef-meta.yaml` files                   | Pending key counts per cell                                                                                                                          |
| `SubprocessRunner`                | Git commands                              | Repo identity: remote origin, commit SHA, branch, commit timestamp                                                                                   |

### New Code Required

- **`packages/core/src/report/generator.ts`** — `ReportGenerator` class. Calls the modules above, passes results through `ReportSanitizer`, returns a `ClefReport`. No analysis logic — pure orchestration.
- **`packages/core/src/report/sanitizer.ts`** — `ReportSanitizer`. Takes raw `LintIssue[]` and `DriftIssue[]`, replaces key-name-specific issues with aggregate counts. This is the only genuinely new concern.
- **`packages/cli/src/commands/report.ts`** — CLI command. Calls `ReportGenerator`, handles `--json` / `--push` flags, formats terminal output.
- **`ClefReport` interface** in `packages/core/src/types/index.ts` — the report payload schema.
- **API client** (minimal) — for `--push`, a simple HTTPS POST with the `ClefReport` JSON. Thin wrapper, no SDK needed initially.

### Sanitization Rules

The `ReportSanitizer` applies these transformations to raw results before they enter the payload:

| Raw result                                                                                | Sanitized to                                                         | Rationale                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `LintIssue` referencing a key name (e.g., "key 'DB_PASSWORD' fails schema")               | "3 keys fail schema validation" (grouped by namespace/environment)   | Key names may reveal what secrets exist                   |
| `DriftIssue` listing specific keys (e.g., "key 'STRIPE_KEY' in prod but not staging")     | "2 keys present in production but missing from staging"              | Key names may reveal what secrets exist                   |
| `LintIssue` about matrix completeness (e.g., "missing file payments/production.enc.yaml") | Pass through unchanged                                               | File paths are already public in git                      |
| `LintIssue` about recipients (e.g., "expected 2 recipients, found 1")                     | Pass through unchanged                                               | Recipient fingerprints are already public in `.sops.yaml` |
| `LintIssue` about pending keys (e.g., "key 'X' is pending")                               | "2 pending keys awaiting values" (count only)                        | Key names may reveal what secrets exist                   |
| Any decrypted value                                                                       | Never reaches this point — `LintRunner` results don't include values | Values never leave SOPS/memory                            |

---

## Open Questions for Architect

1. **Report versioning.** The JSON report needs a `schemaVersion` field so the API can handle format evolution. Start at `1`.

2. **Incremental reports.** Should the CI action send a full report every time, or a diff from the last report? Full report is simpler and idempotent. Diff is more efficient at scale. Recommendation: full report for v1, optimize later.

3. **Recipient label mapping.** `.sops.yaml` and `clef.yaml` can declare labels for recipients (e.g., `age1qy8m...a4wk` → "deploy-key-prod"). Should the report include these labels? They make the dashboard more readable but expose internal naming. Recommendation: include if declared, the customer chose to label them.

4. **Report signing.** Should the report be signed (e.g., with the repo's age key) to prove it came from a trusted CI runner and wasn't tampered with in transit? Adds complexity but strengthens the trust model. Recommendation: defer to v2, rely on API token auth for v1.
