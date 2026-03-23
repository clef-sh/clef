# clef report

Generate a metadata report for a Clef repository. The report includes repo identity, matrix status, policy issues, and recipient summaries. It never exposes ciphertext, key names, or decrypted values.

## Usage

```bash
clef report [options]
```

## Options

| Flag                      | Description                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--json`                  | Output the full report as JSON                                                                          |
| `--push`                  | Push report as OTLP to `CLEF_TELEMETRY_URL`. See [Telemetry — CLI `--push`](/guide/telemetry#cli-push). |
| `--at <sha>`              | Generate a report at a specific commit                                                                  |
| `--since <sha>`           | Generate reports for all commits since `<sha>`                                                          |
| `--namespace <name...>`   | Filter to specific namespace(s)                                                                         |
| `--environment <name...>` | Filter to specific environment(s)                                                                       |

## Exit codes

| Code | Meaning          |
| ---- | ---------------- |
| `0`  | No policy errors |
| `1`  | Errors found     |

## Examples

### Default terminal output

```bash
clef report
```

Prints a summary table with matrix status, recipients, and policy issues.

### JSON output

```bash
clef report --json
```

Outputs the full report as a JSON object — useful for piping to `jq` or storing as a CI artifact.

### Filter by namespace and environment

```bash
clef report --namespace payments --environment production
```

### Report at a specific commit

```bash
clef report --at abc1234
```

Checks out the given commit in a temporary worktree, generates the report, and cleans up.

### Report range

```bash
clef report --since abc1234
```

Generates a report for every commit between `abc1234` and HEAD. Useful for backfilling after enabling reports in CI.

### Push to telemetry backend

```bash
export CLEF_TELEMETRY_URL=https://otel-collector.internal:4318/v1/logs
export CLEF_TELEMETRY_TOKEN=your-otlp-bearer-token

clef report --push
```

Generates the report and pushes it as OTLP LogRecords to the configured endpoint. Normal terminal output still prints — `--push` is additive.

### CI integration

```yaml
# .github/workflows/report.yml
name: Clef Report
on:
  push:
    branches: [main]

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history for --since
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx clef report --push
        env:
          CLEF_TELEMETRY_URL: ${{ vars.CLEF_TELEMETRY_URL }}
          CLEF_TELEMETRY_TOKEN: ${{ secrets.CLEF_TELEMETRY_TOKEN }}
```

## Report schema

The JSON report (`--json`) includes:

| Section        | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `repoIdentity` | Repo origin, commit SHA, branch, timestamps, tool versions  |
| `manifest`     | Manifest version, file pattern, environments, namespaces    |
| `matrix`       | Per-cell status: exists, key count, pending count, metadata |
| `policy`       | Issue count by severity + list of individual issues         |
| `recipients`   | Per-fingerprint summary: type, environments, file count     |

## See also

- [Telemetry](/guide/telemetry) — OTLP telemetry setup and event reference
- [`clef lint`](/cli/lint) — local health check with auto-fix
- [`clef drift`](/cli/drift) — detect drift between manifest and encrypted files
- [`clef scan`](/cli/scan) — scan for leaked plaintext secrets
