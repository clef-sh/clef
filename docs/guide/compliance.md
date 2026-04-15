# Rotation Policy & Compliance

Clef can enforce a secret rotation schedule and produce a machine-readable compliance artifact on every CI run. This gives you an audit trail and an automated gate that fails PRs when secrets go stale.

## How it works

1. **`.clef/policy.yaml`** declares how long any secret file may go without rotation.
2. **`clef policy check`** reads the `sops.lastmodified` timestamp from each encrypted file's SOPS metadata — no decryption required — and compares it to the policy limit.
3. **`clef policy report`** assembles a `ComplianceDocument` JSON artifact combining rotation verdicts, scan results, and lint results for storage and audit.

The `sops.lastmodified` timestamp is updated automatically any time a file is re-encrypted — by `clef set`, `clef rotate`, `clef recipients add`, or direct SOPS operations.

## Quick start

Run `clef policy init` inside a Clef-managed repo:

```bash
clef policy init
```

This scaffolds two files:

- `.clef/policy.yaml` — rotation policy (default: 90-day limit for all environments)
- A CI workflow for the detected provider (see below)

Commit both files and push. The workflow will run on your next pull request.

::: tip Already ran `clef init`?
`clef init` calls `clef policy init` automatically during first-time repo setup. Check whether `.clef/policy.yaml` already exists before running it again.
:::

### How the provider is detected

Clef inspects your repo in this order and picks the first match:

1. **`.github/` directory** → GitHub Actions
2. **`.gitlab-ci.yml`** → GitLab CI
3. **`bitbucket-pipelines.yml`** → Bitbucket Pipelines
4. **`.circleci/config.yml`** → CircleCI
5. **Git remote URL** — looks for `gitlab.com`, `bitbucket.org`, or `github.com` in `.git/config`
6. **Default** → GitHub Actions

Override at any time with `--ci <provider>`:

```bash
clef policy init --ci circleci
```

### What gets scaffolded

| Provider  | File written                              | How to activate                                                   |
| --------- | ----------------------------------------- | ----------------------------------------------------------------- |
| GitHub    | `.github/workflows/clef-compliance.yml`   | Picked up automatically by GitHub Actions                         |
| GitLab    | `.gitlab/clef-compliance.yml`             | Add `include: '/.gitlab/clef-compliance.yml'` to `.gitlab-ci.yml` |
| Bitbucket | `.clef/workflows/bitbucket-pipelines.yml` | Merge into your `bitbucket-pipelines.yml`                         |
| CircleCI  | `.clef/workflows/circleci-config.yml`     | Merge into your `.circleci/config.yml`                            |

When the scaffolded file needs a manual merge step (GitLab, Bitbucket, CircleCI), Clef prints the exact instruction after writing the file.

To regenerate the workflow after a CLI upgrade:

```bash
clef policy init --force
```

## Policy file

`.clef/policy.yaml` lives alongside `clef.yaml` in your repo root:

```yaml
version: 1
rotation:
  max_age_days: 90
```

### Per-environment limits

Production secrets often need stricter rotation schedules than staging. Override the global limit per environment:

```yaml
version: 1
rotation:
  max_age_days: 90 # staging, dev, and everything else
  environments:
    production:
      max_age_days: 30 # production must rotate at least monthly
```

`clef policy show` prints the resolved policy including per-environment overrides.

## CI/CD setup

### GitHub Actions

`clef policy init` generates this workflow automatically. For reference:

```yaml
name: Clef Compliance
on:
  pull_request:
  push:
    branches: [main]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Clef
        run: npm install -g @clef-sh/cli

      - name: Check rotation policy
        run: clef policy check

      - name: Generate compliance artifact
        if: always()
        run: clef policy report --output compliance.json

      - name: Upload compliance artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: compliance
          path: compliance.json
          retention-days: 90
```

The `if: always()` on the report and upload steps ensures the artifact is produced even when `clef policy check` fails — so you can inspect which files caused the failure.

### GitLab CI

`clef policy init --ci gitlab` generates `.gitlab/clef-compliance.yml`. Add it to your pipeline with `include:`:

```yaml
# .gitlab-ci.yml
include:
  - local: ".gitlab/clef-compliance.yml"
```

### Bitbucket Pipelines / CircleCI

Use `--ci bitbucket` or `--ci circleci`. The generated file includes merge instructions in comments explaining which sections to copy into your existing pipeline definition.

## Checking compliance locally

Before pushing, run:

```bash
# See which files are due for rotation
clef policy check

# Check only production
clef policy check --environment production

# Strict mode — treat files with no SOPS timestamp as failures
clef policy check --strict
```

`clef policy check` exits `1` when any file is overdue. Pipe it into your local pre-push hook or use it as a pre-deploy gate.

## Rotating overdue files

When `clef policy check` flags a file, rotate it with `clef rotate`:

```bash
# Re-encrypt with the same recipients, updating lastmodified
clef rotate payments/production
```

`clef rotate` re-encrypts the file in place, which updates `sops.lastmodified` to the current timestamp. Run `clef policy check` again to confirm the file is now compliant.

## Compliance artifact

`clef policy report` produces a `ComplianceDocument` JSON file. This is a stable, self-contained artifact designed for long-term storage — it includes an inline policy snapshot and a `policy_hash` (canonical-JSON SHA-256) so the document can be interpreted months later without needing the original `.clef/policy.yaml`.

Key fields:

| Field             | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `schema_version`  | Always `"1"` — bumped only on breaking changes                       |
| `generated_at`    | ISO 8601 timestamp of when the artifact was produced                 |
| `sha`             | Git commit SHA (from CI env or `git rev-parse`)                      |
| `repo`            | `owner/name` slug (from CI env or git remote)                        |
| `policy_hash`     | `sha256:` digest — identical policy → identical hash across commits  |
| `policy_snapshot` | Full inline copy of the policy used for this run                     |
| `summary`         | Aggregated counts: total files, compliant, overdue, scan/lint errors |
| `files`           | Per-file rotation verdicts                                           |
| `scan`            | Plaintext secret scan results                                        |
| `lint`            | Lint results                                                         |

To reproduce a CI compliance run locally:

```bash
clef policy report --sha $(git rev-parse HEAD) --output compliance.json
```

## Skipping checks

To speed up the report in contexts where you only need one check type:

```bash
# Rotation only — skip scan and lint
clef policy report --no-scan --no-lint

# No rotation check — scan and lint only
clef policy report --no-rotation
```

## Compliance and Clef Cloud

When the Clef bot is installed (via `clef cloud init`), the CI workflow uploads compliance artifacts to your Cloud dashboard automatically. The bot parses `compliance.json` on each PR and posts a status check summarising which files are overdue and by how many days.

## Related

- [`clef policy`](/cli/policy) — full CLI reference for all policy subcommands
- [`clef rotate`](/cli/rotate) — re-encrypt a file to update its `lastmodified` timestamp
- [`clef scan`](/cli/scan) — scan for plaintext secrets outside the matrix
- [CI/CD Integration](/guide/ci-cd) — patterns for consuming secrets in CI pipelines
