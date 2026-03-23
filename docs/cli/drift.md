# clef drift

Compare key sets across two local Clef repositories without decryption. Reports keys that exist in some environments but not others.

## Syntax

```bash
clef drift <path> [options]
```

## Arguments

| Argument | Description                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------- |
| `path`   | Path to the remote Clef repository to compare against. Resolved relative to `--dir` (or cwd if not set). |

## Description

`clef drift` reads encrypted YAML files as plaintext — key names are not encrypted by SOPS — and compares the key sets between the local repository and the one at `<path>`. It does **not** decrypt any values and does **not** require `sops` to be installed.

Each key is checked across all environments in both repos. If a key exists in some environments but not others, it is reported as a drift issue.

## Flags

| Flag                 | Type      | Default | Description                                                                                              |
| -------------------- | --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `--json`             | `boolean` | `false` | Output the raw `DriftResult` as JSON for CI parsing                                                      |
| `--push`             | `boolean` | `false` | Push results as OTLP to `CLEF_TELEMETRY_URL`. See [Telemetry — CLI `--push`](/guide/telemetry#cli-push). |
| `--namespace <name>` | `string`  | all     | Scope comparison to specific namespace(s)                                                                |

## Exit codes

| Code | Meaning        |
| ---- | -------------- |
| `0`  | No drift found |
| `1`  | Drift detected |

## Examples

### Basic drift detection

```bash
clef drift ../other-repo
```

```
✕ 2 drift issue(s) found

  payments
    ✕ STRIPE_WEBHOOK_SECRET
      present in: dev, staging
      missing from: production

  database
    ✕ REPLICA_URL
      present in: production
      missing from: dev, staging

2 namespace(s) compared, 0 clean
```

### Scope to a single namespace

```bash
clef drift ../other-repo --namespace payments
```

### JSON output for CI

```bash
clef drift ../other-repo --json
```

```json
{
  "namespacesCompared": 2,
  "namespacesClean": 1,
  "issues": [
    {
      "namespace": "payments",
      "key": "STRIPE_WEBHOOK_SECRET",
      "presentIn": ["dev", "staging"],
      "missingFrom": ["production"]
    }
  ]
}
```

### Use in CI pipelines

```bash
# Fail the pipeline if the repos have drifted
if ! clef drift ../other-repo; then
  echo "Secret key drift detected"
  exit 1
fi
```

## Related commands

- [`clef diff`](/cli/diff) — compare decrypted values between two environments within a single repo
- [`clef lint`](/cli/lint) — validate matrix completeness and schema conformance
