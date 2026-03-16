# Clef

[![CI](https://github.com/clef-sh/clef/actions/workflows/ci.yml/badge.svg)](https://github.com/clef-sh/clef/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@clef-sh/cli.svg)](https://www.npmjs.com/package/@clef-sh/cli)

**Git-native secrets management built on [Mozilla SOPS](https://github.com/getsops/sops) — structured, validated, and always encrypted in your own repo.**

Clef adds a namespace-by-environment matrix, schema validation, drift detection, and a local web UI on top of SOPS. Your secrets stay in git, encrypted by your KMS. The RBAC, audit logs, and short-lived credential access you need for enterprise compliance come from your KMS — not from a new intermediary.

## Why Clef?

SOPS is a great encryption engine, but at team scale it falls short:

- No standard way to organise secrets across namespaces and environments
- No visibility into key drift between environments until something breaks
- No schema validation for secret values
- No UI — every operation requires memorising SOPS flags
- No guardrails against committing plaintext secrets

Clef solves all of these while keeping SOPS as the encryption engine and git as the source of truth.

### Bring Your Own KMS — and inherit enterprise-grade security

When you pair Clef with AWS KMS or GCP KMS, you get:

- **RBAC via IAM** — access to a secret is an IAM policy; no separate permission system to learn
- **Audit logs via CloudTrail / Cloud Audit Logs** — every decryption is a KMS API call, captured in your existing SIEM
- **Zero-secret CI via OIDC** — GitHub Actions and GitLab CI authenticate directly to KMS; no long-lived credential stored anywhere

You are not choosing between developer ergonomics and enterprise compliance. Clef provides the workflow layer. Your KMS provides the security posture.

## Features

- **Namespace-by-environment matrix** — organise secrets logically and detect missing cells at a glance
- **Schema validation** — enforce required keys, types, and patterns per namespace
- **Environment diffing** — compare secrets across environments and see exactly what's changed or missing
- **Local web UI** — browse the matrix, edit secrets, diff environments, and run lint checks visually
- **Pre-commit hook** — blocks accidental plaintext commits automatically
- **`clef exec`** — inject decrypted secrets as environment variables into any command
- **`clef doctor`** — diagnose your environment setup in one command
- **All SOPS backends** — age, AWS KMS, GCP KMS, and PGP

## Install

```bash
npm install -g @clef-sh/cli
```

### Prerequisites

- Git
- Node.js 18+

**sops** is bundled automatically via platform-specific optional dependencies — no manual install required. If the bundled binary is not available for your platform, Clef falls back to any `sops` on your system PATH. You can also override the binary path with the `CLEF_SOPS_PATH` environment variable.

Run `clef doctor` after installing to verify your environment. It shows where sops was resolved from (`[bundled]`, `[system]`, or `[CLEF_SOPS_PATH]`).

When using the age backend (the default), `clef init` generates your age key pair automatically — no separate age binary needed.

## Quick Start

```bash
# Initialise Clef in a git repo
clef init --namespaces database,payments,auth --non-interactive

# Set a secret (hidden input — value never echoed)
clef set database/staging DB_PASSWORD

# Set a secret with an inline value
clef set database/staging DB_HOST staging-db.internal

# Retrieve a secret (raw output, pipes cleanly)
clef get database/staging DB_HOST

# Compare environments
clef diff database dev staging

# Validate the entire repo
clef lint

# Auto-fix safe issues (e.g. missing matrix files)
clef lint --fix

# Run a command with secrets injected as env vars
clef exec database/staging -- env

# Open the local web UI
clef ui
```

## CLI Commands

| Command             | Description                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `clef init`         | Initialise a Clef repo (idempotent — safe to re-run for second-developer onboarding) |
| `clef update`       | Scaffold missing matrix cells after adding namespaces or environments to `clef.yaml` |
| `clef get`          | Retrieve a single decrypted value                                                    |
| `clef set`          | Set a secret value (supports hidden input and random generation)                     |
| `clef delete`       | Delete a key from an encrypted file (`--all-envs` for bulk)                          |
| `clef diff`         | Compare secrets between two environments                                             |
| `clef lint`         | Validate matrix completeness, schema compliance, and SOPS integrity                  |
| `clef rotate`       | Rotate encryption keys for a namespace/environment                                   |
| `clef recipients`   | Manage age recipients — list, add, or remove keys that can decrypt the repo          |
| `clef hooks`        | Install the pre-commit hook                                                          |
| `clef exec`         | Run a command with decrypted secrets as environment variables                        |
| `clef export`       | Print decrypted secrets as shell export statements                                   |
| `clef import`       | Bulk-import secrets from a dotenv, JSON, or YAML file                                |
| `clef scan`         | Scan the repository for secrets that have escaped the Clef matrix                    |
| `clef doctor`       | Check for required dependencies and configuration                                    |
| `clef merge-driver` | SOPS-aware three-way merge driver for encrypted files                                |
| `clef service`      | Manage service identities for serverless/machine workloads                           |
| `clef bundle`       | Generate runtime JS bundles encrypted to a service identity                          |
| `clef ui`           | Launch the local web UI                                                              |

## Web UI

Run `clef ui` to open a local web interface at `http://127.0.0.1:7777` (binds to localhost only). From the UI you can:

- Browse the namespace-by-environment matrix and spot drift
- Click into a namespace to view and edit secrets with masked values
- Diff two environments side-by-side
- Run lint and see validation issues with inline fix commands

## How It Works

Clef uses a **manifest file** (`clef.yaml`) to declare your namespaces, environments, and encryption settings. From this, it manages a matrix of encrypted SOPS files — one per namespace/environment pair. The base directory defaults to `secrets/` and can be customised during `clef init` with `--secrets-dir` or interactively.

```
clef.yaml          # Manifest — declares structure and config
secrets/
  database/
    dev.enc.yaml             # Encrypted secrets for database/dev
    staging.enc.yaml         # Encrypted secrets for database/staging
    production.enc.yaml      # Encrypted secrets for database/production
  payments/
    dev.enc.yaml
    staging.enc.yaml
    production.enc.yaml
schemas/
  database.yaml            # Optional schema for the database namespace
```

All encryption and decryption is performed by SOPS via subprocess — Clef never implements any cryptography. Decrypted values exist only in memory and are never written to disk.

## Architecture

Clef is a TypeScript monorepo with three packages:

| Package         | Description                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------- |
| `@clef-sh/core` | Manifest parsing, matrix management, schema validation, SOPS client, diff engine, lint runner |
| `@clef-sh/cli`  | Commander.js CLI wrapping the core library                                                    |
| `@clef-sh/ui`   | React + Vite local web interface served by Express                                            |

## Security

Clef is designed around the principle that secrets management tools must not become attack vectors themselves. The following invariants are enforced across the codebase:

### Plaintext never touches disk

All encryption and decryption is performed by SOPS via subprocess using stdin/stdout pipes. Decrypted values exist only in memory. No temporary files, no swap-eligible buffers, no debug dumps. This is verified by the review protocol and integration tests.

### No custom cryptography

Clef delegates all cryptographic operations to SOPS. There is no custom encryption, hashing, or key derivation anywhere in the codebase. `crypto.randomBytes` is used only for generating random placeholder values and authentication tokens.

### Credential isolation

Clef uses its own environment variables (`CLEF_AGE_KEY`, `CLEF_AGE_KEY_FILE`) which are translated to SOPS equivalents (`SOPS_AGE_KEY`, `SOPS_AGE_KEY_FILE`) and passed directly to the SOPS subprocess environment. `SOPS_*` variables in the parent process environment are never inherited — this prevents cross-tool credential leakage for users who also use SOPS directly.

### Bundled sops binary integrity

The sops binary is distributed via platform-specific npm packages (`@clef-sh/sops-{platform}-{arch}`). Supply chain integrity is enforced through:

- **Pinned version** — `sops-version.json` at the repo root locks the exact sops version
- **SHA256 checksums** — every platform binary is verified against a known digest before packaging
- **npm provenance** — platform packages are published with `--provenance` for audit trail
- **Binary verification** — the CI workflow runs `sops --version` on the downloaded binary before publishing
- **Resolution transparency** — `clef doctor` shows the binary source (`[bundled]`, `[system]`, or `[CLEF_SOPS_PATH]`) so users can verify what is running

The resolution chain (`CLEF_SOPS_PATH` env → bundled package → system PATH) ensures the bundled binary is used by default, while allowing explicit overrides for environments with specific requirements.

### UI binds localhost only

The web UI server binds to `127.0.0.1` exclusively — never `0.0.0.0` or `localhost` (which can resolve to `::` on dual-stack systems). All API routes require bearer token authentication. Host header validation rejects non-loopback requests.

### Pre-commit scanning

`clef scan` and the pre-commit hook detect plaintext secrets that have escaped the Clef matrix using pattern matching and Shannon entropy analysis. The hook blocks commits containing high-confidence matches.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and submission guidelines.

```bash
git clone https://github.com/clef-sh/clef.git
cd clef
npm install
npm test
```

Security vulnerabilities should be reported to **security@clef.sh** — please do not open public issues for security reports.

## Documentation

- [Website](https://clef.sh)
- [Documentation](https://docs.clef.sh)

## License

[MIT](LICENSE)
