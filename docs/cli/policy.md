# clef policy

Enforce secret rotation schedules and generate compliance artifacts. `clef policy` reads the rotation rules in `.clef/policy.yaml` (or the built-in default of 90 days) and evaluates every encrypted file in the matrix against them.

## Subcommands

| Subcommand                                  | Description                                               |
| ------------------------------------------- | --------------------------------------------------------- |
| [`clef policy init`](#clef-policy-init)     | Scaffold `.clef/policy.yaml` and a CI compliance workflow |
| [`clef policy show`](#clef-policy-show)     | Print the resolved policy (file or default)               |
| [`clef policy check`](#clef-policy-check)   | Evaluate the matrix against the rotation policy           |
| [`clef policy report`](#clef-policy-report) | Generate a full `ComplianceDocument` artifact             |

---

## clef policy init

Scaffold `.clef/policy.yaml` and a CI workflow that gates on `clef policy check`. Auto-detects your CI provider from directory structure or git remote.

### Syntax

```bash
clef policy init [flags]
```

### Flags

| Flag              | Type      | Default | Description                                                      |
| ----------------- | --------- | ------- | ---------------------------------------------------------------- |
| `--ci <provider>` | `string`  | auto    | Force a CI provider: `github`, `gitlab`, `bitbucket`, `circleci` |
| `--force`         | `boolean` | `false` | Overwrite existing files                                         |
| `--policy-only`   | `boolean` | `false` | Scaffold only `.clef/policy.yaml`, skip CI workflow              |
| `--workflow-only` | `boolean` | `false` | Scaffold only the CI workflow, skip policy file                  |

### Provider detection

When `--ci` is not set, Clef detects the CI provider in this order:

| Priority | Signal                                      | Detected as |
| -------- | ------------------------------------------- | ----------- |
| 1        | `.github/` directory exists                 | `github`    |
| 2        | `.gitlab-ci.yml` exists                     | `gitlab`    |
| 3        | `bitbucket-pipelines.yml` exists            | `bitbucket` |
| 4        | `.circleci/config.yml` exists               | `circleci`  |
| 5        | `gitlab.com` in `.git/config` remote URL    | `gitlab`    |
| 6        | `bitbucket.org` in `.git/config` remote URL | `bitbucket` |
| 7        | `github.com` in `.git/config` remote URL    | `github`    |
| 8        | Default                                     | `github`    |

Directory signals (1–4) take precedence over remote URL signals (5–7). Use `--ci <provider>` to bypass detection entirely.

### Examples

**Auto-detect CI provider (most common):**

```bash
clef policy init
```

**Force GitLab, skip workflow if already customised:**

```bash
clef policy init --ci gitlab --policy-only
```

**Re-scaffold and overwrite:**

```bash
clef policy init --force
```

### Output paths

| Provider  | Workflow file                             | Notes                                         |
| --------- | ----------------------------------------- | --------------------------------------------- |
| GitHub    | `.github/workflows/clef-compliance.yml`   | Runs as a standalone Actions workflow         |
| GitLab    | `.gitlab/clef-compliance.yml`             | Requires `include:` in `.gitlab-ci.yml`       |
| Bitbucket | `.clef/workflows/bitbucket-pipelines.yml` | Requires merge into `bitbucket-pipelines.yml` |
| CircleCI  | `.clef/workflows/circleci-config.yml`     | Requires merge into `.circleci/config.yml`    |

The scaffolded workflow:

1. Installs `@clef-sh/cli`
2. Runs `clef policy check` (fails the job if any files are overdue)
3. Runs `clef policy report --output compliance.json` (always, even if check fails)
4. Uploads `compliance.json` as an artifact (90-day retention)

`clef init` also calls `clef policy init` automatically on first-time repo setup, so you may not need to run this separately.

---

## clef policy show

Print the active rotation policy — from `.clef/policy.yaml` if present, otherwise the built-in default.

### Syntax

```bash
clef policy show [flags]
```

### Flags

| Flag     | Type      | Default | Description   |
| -------- | --------- | ------- | ------------- |
| `--json` | `boolean` | `false` | Print as JSON |

### Example

```bash
clef policy show
```

```yaml
version: 1
rotation:
  max_age_days: 90
  environments:
    production:
      max_age_days: 30
```

---

## clef policy check

Evaluate every encrypted file in the matrix against the rotation policy and print a per-file verdict.

### Syntax

```bash
clef policy check [flags]
```

### Flags

| Flag                       | Type       | Default | Description                                                       |
| -------------------------- | ---------- | ------- | ----------------------------------------------------------------- |
| `-n, --namespace <ns...>`  | `string[]` | all     | Limit to specific namespaces (repeatable)                         |
| `-e, --environment <e...>` | `string[]` | all     | Limit to specific environments (repeatable)                       |
| `--strict`                 | `boolean`  | `false` | Treat files without `sops.lastmodified` as failures (exit code 3) |
| `--json`                   | `boolean`  | `false` | Machine-readable JSON output                                      |

### Exit codes

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| `0`  | All evaluated files are compliant                              |
| `1`  | One or more files are overdue for rotation                     |
| `2`  | Configuration error — missing manifest, invalid policy         |
| `3`  | `--strict` mode: one or more files have unknown `lastmodified` |

### Examples

**Check all files:**

```bash
clef policy check
```

```
FILE                          AGE      LIMIT    STATUS
database/production.enc.yaml  12 days  30 days  ✓ ok
payments/production.enc.yaml  45 days  30 days  ✗ overdue (15 days)
auth/staging.enc.yaml         8 days   90 days  ✓ ok

1 of 3 files overdue.
```

**Check only production environments:**

```bash
clef policy check --environment production
```

**Check specific namespace in CI:**

```bash
clef policy check --namespace payments --json
```

**Strict mode — treat missing SOPS metadata as a failure:**

```bash
clef policy check --strict
```

### JSON output

```json
{
  "files": [
    {
      "path": "payments/production.enc.yaml",
      "environment": "production",
      "last_modified": "2024-01-15T00:00:00Z",
      "last_modified_known": true,
      "rotation_due": "2024-02-14T00:00:00Z",
      "rotation_overdue": true,
      "days_overdue": 15,
      "compliant": false
    }
  ],
  "summary": {
    "total_files": 3,
    "compliant": 2,
    "rotation_overdue": 1
  }
}
```

---

## clef policy report

Generate a full `ComplianceDocument` artifact — the same JSON file the CI workflow uploads as an artifact.

The document includes rotation policy verdicts, plaintext secret scan results, and lint results bundled with a policy snapshot and Git context, making it self-contained for offline audit and drift detection.

### Syntax

```bash
clef policy report [flags]
```

### Flags

| Flag                       | Type       | Default | Description                                                 |
| -------------------------- | ---------- | ------- | ----------------------------------------------------------- |
| `-o, --output <file>`      | `string`   | stdout  | Write JSON to a file instead of stdout                      |
| `--sha <sha>`              | `string`   | auto    | Override commit SHA (auto-detected from CI env / git)       |
| `--repo <owner/name>`      | `string`   | auto    | Override repo slug (auto-detected from CI env / git remote) |
| `-n, --namespace <ns...>`  | `string[]` | all     | Limit to specific namespaces                                |
| `-e, --environment <e...>` | `string[]` | all     | Limit to specific environments                              |
| `--no-scan`                | `boolean`  | `false` | Skip plaintext secret scan                                  |
| `--no-lint`                | `boolean`  | `false` | Skip lint checks                                            |
| `--no-rotation`            | `boolean`  | `false` | Skip rotation policy evaluation                             |

`clef policy report` always exits `0` on successful artifact generation regardless of policy violations — the `passed` field in the JSON document carries the actual verdict. Use `clef policy check` when you want a non-zero exit on violation.

### Examples

**Generate and print to stdout:**

```bash
clef policy report
```

**Write to file for CI artifact upload:**

```bash
clef policy report --output compliance.json
```

**Quick report — rotation check only, no scan/lint overhead:**

```bash
clef policy report --no-scan --no-lint --output rotation-only.json
```

### Document schema

```json
{
  "schema_version": "1",
  "generated_at": "2024-03-01T12:00:00Z",
  "sha": "abc123",
  "repo": "acme/payments",
  "policy_hash": "sha256:e3b0c44...",
  "policy_snapshot": { "version": 1, "rotation": { "max_age_days": 90 } },
  "summary": {
    "total_files": 6,
    "compliant": 5,
    "rotation_overdue": 1,
    "scan_violations": 0,
    "lint_errors": 0
  },
  "files": [ ... ],
  "scan": { ... },
  "lint": { ... }
}
```

`schema_version` is frozen at `"1"` until a breaking change requires a bump. `policy_hash` is a canonical-JSON SHA-256 digest of the policy — identical policy across commits produces identical hashes, enabling drift detection.

---

## Policy file reference

`.clef/policy.yaml` is checked into your repository alongside `clef.yaml`.

```yaml
version: 1
rotation:
  max_age_days: 90 # Global default
  environments:
    production:
      max_age_days: 30 # Stricter limit for production
```

If `.clef/policy.yaml` does not exist, Clef uses a built-in default of `max_age_days: 90` for all environments.

## Related

- [Compliance guide](/guide/compliance) — rotation policy concepts and CI/CD setup
- [`clef scan`](/cli/scan) — scan for plaintext secrets outside the matrix
- [`clef lint`](/cli/lint) — validate matrix structure and SOPS integrity
- [`clef report`](/cli/report) — metadata report (separate from compliance artifact)
