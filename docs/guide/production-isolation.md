# Production Isolation

Clef is a developer-first tool — co-located secrets in the application repo is the default and the best experience for most teams. But developer-first doesn't mean developer-only. When your organization requires production ciphertext in a separate repository, Clef accommodates that without forcing developers onto a different workflow. This guide covers the ops side: why you might separate, how to set it up, and how to use `clef drift` to keep key sets in sync.

## Why separate production secrets

Co-locating secrets in the application repo is the recommended default (see [Core Concepts](/guide/concepts#recommended-approach-co-located-secrets)). However, regulated or security-conscious organizations may need a dedicated production repo for:

- **Least privilege.** Developers who need `dev` and `staging` secrets should not need access to production ciphertext. A separate repo means separate age keys and separate repository access controls.
- **Compliance.** SOC 2, PCI-DSS, and HIPAA frameworks may require that production credentials are stored and audited separately from development environments.
- **Defense in depth.** Splitting repos ensures that production ciphertext is never cloned to developer machines — even accidentally. A leaked dev repo exposes no production material.
- **Blast radius.** Compromising the dev repo (or its age key) does not expose production ciphertext.

## Setting up the production repo

1. Create a new repository for production secrets.

2. Run `clef init` in the new repo. Use the **same namespace names** as your dev repo but only declare the production environment:

```yaml
# clef.yaml in the production repo
version: 1

environments:
  - name: production
    description: Live system
    protected: true

namespaces:
  - name: database
    description: Database connection config
  - name: auth
    description: Auth and identity secrets
  - name: payments
    description: Payment provider credentials

sops:
  default_backend: age

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

3. Generate a dedicated age key for the production repo. This key should only be available to the production CI/CD pipeline and authorized ops engineers.

4. Populate production secrets using `clef set`:

```bash
clef set database/production DB_URL "postgres://prod-host:5432/app"
clef set database/production DB_PASS "..."
```

## CI drift detection

The `clef drift` command compares key sets across two local Clef repos **without decryption**. It reads encrypted YAML files as plain YAML (key names are plaintext in SOPS files), filters out the `sops` metadata key, and reports keys that exist in some environments but not others across shared namespaces.

**This means `clef drift` works without sops installed.** No decryption keys are needed.

### Basic usage

```bash
# From the production repo, compare against a local clone of the dev repo
clef drift /path/to/dev-repo

# Scope to specific namespaces
clef drift /path/to/dev-repo --namespace database payments

# Output JSON for CI parsing
clef drift /path/to/dev-repo --json
```

Exit codes:

- **0** — No drift. All keys in shared namespaces are consistent across environments.
- **1** — Drift found. At least one key exists in some environments but not others.

### Example output

```
✖ 2 drift issue(s) found

  database
    ✖ DB_POOL_SIZE
      present in: dev, staging
      missing from: production
    ✖ DB_SSL_MODE
      present in: dev, staging
      missing from: production

2 namespace(s) compared, 1 clean
```

## Example GitHub Actions workflow

Run drift detection in your production repo's CI to catch missing keys before they cause outages:

```yaml
name: Drift Detection
on:
  schedule:
    - cron: "0 8 * * 1-5" # weekdays at 08:00 UTC
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: your-org/your-app
          path: dev-repo
          token: ${{ secrets.DEV_REPO_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g @clef-sh/cli

      - name: Check for drift
        run: clef drift ./dev-repo --json > drift-result.json

      - name: Report drift
        if: failure()
        run: |
          echo "::error::Key drift detected between production and dev repos"
          cat drift-result.json
```

## Responding to drift

When drift is detected, the workflow is:

1. **Review the drift output.** Identify which keys are missing from which environments.
2. **Determine intent.** Is the key new and needs to be added to production? Or was it removed from dev and should be removed from production?
3. **Add missing keys.** In the production repo:
   ```bash
   clef set database/production DB_POOL_SIZE "20"
   ```
4. **Re-run drift check.** Verify the issue is resolved:
   ```bash
   clef drift /path/to/dev-repo
   ```

## Comparison with co-location

| Concern              | Co-located (single repo)                   | Production isolation (two repos)                         |
| -------------------- | ------------------------------------------ | -------------------------------------------------------- |
| Access control       | Per-environment recipients or KMS backends | Separate repo access + separate age keys                 |
| Drift detection      | `clef lint` catches it automatically       | `clef drift` in CI                                       |
| Operational overhead | Single repo, single PR workflow            | Two repos, need sync process                             |
| Compliance           | May require additional access controls     | Natural separation satisfies auditors                    |
| Best for             | Small teams, startups, internal tools      | Regulated industries, large orgs, strict least-privilege |

Both approaches are first-class in Clef. Choose based on your organization's security posture and compliance requirements.
