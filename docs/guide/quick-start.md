# Quick Start

From an existing git repository to a fully managed secrets setup. Every command is copy-pasteable.

## Install Clef

```bash
curl -fsSL https://clef.sh/install.sh | sh
```

This installs both `clef` and `sops` to `/usr/local/bin`. Alternatively, install via npm: `npm install -g @clef-sh/cli`.

Verify:

```bash
clef --version
```

::: tip
The install script handles sops automatically. If you installed via npm, the bundled sops binary is included via optional dependencies. Run `clef doctor` to verify your setup regardless of install method.
:::

## 1. Initialise a Clef repository

```bash
cd my-project
clef init --namespaces database,payments,auth --non-interactive
# Creates three default environments: dev, staging, production
```

This creates `clef.yaml`, `.sops.yaml`, `.clef/config.yaml` (gitignored), namespace directories with one encrypted file per namespace/environment cell, and a pre-commit hook.

::: tip
`clef init` generates an age key pair automatically — no manual key generation or age binary needed. The private key is stored in your OS keychain (or `~/.config/clef/keys/{label}/keys.txt` as a fallback).
:::

> **Migrating from .env files or a secrets manager?** Use `clef import`. See the [migration guide](migrating.md).

## 2. Set a secret

```bash
clef set payments/staging STRIPE_SECRET_KEY
```

Omitting the value prompts for hidden input — the value is never echoed or written to disk as plaintext. You can provide it inline, but the value will appear in shell history:

```bash
clef set payments/staging STRIPE_PUBLIC_KEY pk_test_abc123
```

Use `--random` to scaffold a placeholder when you don't have the real value yet.

## 3. Retrieve a secret

```bash
clef get payments/staging STRIPE_SECRET_KEY
```

## 4. Compare environments

```bash
clef diff payments dev staging
```

Shows a table of keys with status (changed, identical, or missing). For missing keys, Clef prints the exact `clef set` command to fix the gap.

## 5. Run the linter

```bash
clef lint
```

A healthy repo prints `All clear — 9 files healthy`. Issues are grouped by severity with fix commands. To auto-fix missing matrix files:

```bash
clef lint --fix
```

## 6. Open the web UI

```bash
clef ui
```

Opens `http://127.0.0.1:7777` — browse the matrix, edit secrets with masked values, diff environments, and run lint. Press `Ctrl+C` to stop.

## Full example session

```bash
# Initialise Clef in your existing project
cd my-project
clef init --namespaces database,payments,auth --non-interactive

# Add secrets to dev
clef set database/dev DB_HOST localhost
clef set database/dev DB_PORT 5432
clef set database/dev DB_PASSWORD devpass123

# Add secrets to staging
clef set database/staging DB_HOST staging-db.internal
clef set database/staging DB_PORT 5432
clef set database/staging DB_PASSWORD staging-secret

# Add secrets to production (prompts for confirmation)
clef set database/production DB_HOST prod-db.internal
clef set database/production DB_PORT 5432
clef set database/production DB_PASSWORD

# Compare dev and production
clef diff database dev production

# Validate everything
clef lint

# Open the UI
clef ui
```

## age vs KMS: choosing an encryption backend

This walkthrough uses the **age** backend for every environment — the simplest configuration. age keys are free, require no cloud infrastructure, and work offline. The tradeoff is no built-in audit logging and you are responsible for distributing and rotating keys yourself.

Two mechanisms restrict access within a repo:

1. **Per-environment recipients** — scope age recipients to specific environments with `clef recipients add <key> -e production`. See [Team Setup](/guide/team-setup).
2. **Per-environment backends** — configure production to use AWS KMS or GCP KMS for IAM-based access control and server-side audit logging. See [Per-environment SOPS override](/guide/manifest#per-environment-sops-override).

|                      | age (all envs) | Per-env age recipients | Per-env KMS              |
| -------------------- | -------------- | ---------------------- | ------------------------ |
| **Setup complexity** | Lowest         | Low                    | Medium                   |
| **Access control**   | All-or-nothing | Per-environment        | Per-environment + IAM    |
| **Audit logging**    | None           | None                   | Server-side (CloudTrail) |
| **Key management**   | Self-managed   | Self-managed           | Cloud-managed            |
| **Cost**             | Free           | Free                   | KMS API charges          |

For most teams, age for all environments is the right starting point. Add per-environment recipients for access restrictions; move to KMS for audit logging.

## Next steps

[Next: Core Concepts](/guide/concepts)
