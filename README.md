# Clef

[![CI](https://github.com/clef-sh/clef/actions/workflows/ci.yml/badge.svg)](https://github.com/clef-sh/clef/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@clef-sh/cli.svg)](https://www.npmjs.com/package/@clef-sh/cli)

**Git-native config and secrets management built on [Mozilla SOPS](https://github.com/getsops/sops).**

Clef adds structure, visibility, and guardrails on top of SOPS — without servers, databases, or vendor lock-in. Your secrets stay encrypted in git. Clef gives you a CLI, a local web UI, schema validation, and drift detection to manage them.

## Why Clef?

SOPS is a great encryption engine, but at team scale it falls short:

- No standard way to organise secrets across namespaces and environments
- No visibility into key drift between environments until something breaks
- No schema validation for secret values
- No UI — every operation requires memorising SOPS flags
- No guardrails against committing plaintext secrets

Clef solves all of these while keeping SOPS as the encryption engine and git as the source of truth.

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
# Homebrew
brew install clef-sh/tap/clef-secrets

# npm
npm install -g @clef-sh/cli
```

> The formula is named `clef-secrets` to avoid a naming collision with an existing Homebrew formula. The installed binary is `clef` — you use it as normal.

### Prerequisites

- [SOPS](https://github.com/getsops/sops) v3.7+
- [age](https://github.com/FiloSottile/age) (or another supported KMS backend)
- Git
- Node.js 18+

Run `clef doctor` after installing to verify your environment.

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

| Command       | Description                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `clef init`   | Initialise a Clef repo with manifest, encrypted file matrix, and pre-commit hook |
| `clef get`    | Retrieve a single decrypted value                                                |
| `clef set`    | Set a secret value (supports hidden input and random generation)                 |
| `clef delete` | Delete a key from an encrypted file (`--all-envs` for bulk)                      |
| `clef diff`   | Compare secrets between two environments                                         |
| `clef lint`   | Validate matrix completeness, schema compliance, and SOPS integrity              |
| `clef rotate` | Rotate encryption keys for a namespace/environment                               |
| `clef hooks`  | Install the pre-commit hook                                                      |
| `clef exec`   | Run a command with decrypted secrets as environment variables                    |
| `clef export` | Print decrypted secrets as shell export statements                               |
| `clef doctor` | Check for required dependencies and configuration                                |
| `clef ui`     | Launch the local web UI                                                          |

## Web UI

Run `clef ui` to open a local web interface at `http://127.0.0.1:7777` (binds to localhost only). From the UI you can:

- Browse the namespace-by-environment matrix and spot drift
- Click into a namespace to view and edit secrets with masked values
- Diff two environments side-by-side
- Run lint and see validation issues with inline fix commands

## How It Works

Clef uses a **manifest file** (`clef.yaml`) to declare your namespaces, environments, and encryption settings. From this, it manages a matrix of encrypted SOPS files — one per namespace/environment pair.

```
clef.yaml          # Manifest — declares structure and config
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
