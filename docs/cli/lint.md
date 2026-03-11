# clef lint

Validate the entire repository: matrix completeness, schema compliance, and SOPS encryption integrity. Reports issues grouped by severity with actionable fix commands.

## Syntax

```bash
clef lint [options]
```

## Description

`clef lint` scans every file in the namespace-by-environment matrix and reports three categories of issues:

- **Matrix issues** — missing files, empty files, incomplete matrix coverage
- **Schema issues** — missing required keys, type mismatches, undeclared keys
- **SOPS issues** — files without valid SOPS metadata, decryption failures

Each issue includes a severity level and, where possible, the exact CLI command to fix it.

The exit code reflects whether errors (not warnings) were found, making `clef lint` usable as a CI gate.

## Flags

| Flag     | Type      | Default | Description                                                                |
| -------- | --------- | ------- | -------------------------------------------------------------------------- |
| `--fix`  | `boolean` | `false` | Auto-fix safe issues. Currently supports scaffolding missing matrix files. |
| `--json` | `boolean` | `false` | Output the raw `LintResult` as JSON instead of formatted output            |

## Exit codes

| Code | Meaning                          |
| ---- | -------------------------------- |
| `0`  | No errors (warnings are allowed) |
| `1`  | At least one error found         |

## Severity levels

| Severity    | Blocks commit? | Examples                                                         |
| ----------- | -------------- | ---------------------------------------------------------------- |
| **Error**   | Yes            | Missing required key, missing matrix file, invalid SOPS metadata |
| **Warning** | No             | Undeclared key, value exceeds schema max, stale encryption       |
| **Info**    | No             | Key with no schema definition, single-recipient encryption       |

## Examples

### Healthy repository

```bash
clef lint
```

```
✓ All clear — 9 files healthy
```

### Issues found

```bash
clef lint
```

```
✗ 2 error(s)
  ✗ [matrix] database/staging.enc.yaml
    File is missing from the matrix. Expected at database/staging.enc.yaml
    fix: clef lint --fix
  ✗ [schema] payments/production.enc.yaml WEBHOOK_SECRET
    Required key 'WEBHOOK_SECRET' is missing.
    fix: clef set payments/production WEBHOOK_SECRET <value>

⚠ 1 warning(s)
  ⚠ [schema] auth/dev.enc.yaml LEGACY_TOKEN
    Key 'LEGACY_TOKEN' is not declared in the schema.

2 error(s), 1 warning(s)
```

### Auto-fix missing files

```bash
clef lint --fix
```

This scaffolds missing matrix files (creating empty encrypted files with valid SOPS metadata) and then re-runs validation to report remaining issues.

### JSON output for CI

```bash
clef lint --json
```

```json
{
  "issues": [
    {
      "severity": "error",
      "category": "schema",
      "file": "payments/production.enc.yaml",
      "key": "WEBHOOK_SECRET",
      "message": "Required key 'WEBHOOK_SECRET' is missing.",
      "fixCommand": "clef set payments/production WEBHOOK_SECRET <value>"
    }
  ],
  "fileCount": 9
}
```

### CI pipeline example

```bash
# In your CI workflow
clef lint --json > lint-results.json
if [ $? -ne 0 ]; then
  echo "Clef lint failed — see lint-results.json for details"
  exit 1
fi
```

## Related commands

- [`clef init`](/cli/init) — set up the manifest and scaffold the initial matrix
- [`clef set`](/cli/set) — fix missing key errors
- [`clef diff`](/cli/diff) — compare two specific environments in detail
- [`clef hooks install`](/cli/hooks) — install a pre-commit hook that runs lint
