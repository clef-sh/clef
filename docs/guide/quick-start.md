# Quick Start

::: tip Pattern A (co-located)
This walkthrough uses **Pattern A** — secrets live alongside your application code in the same repository. This is the simplest setup. For a standalone secrets repository (Pattern B), see [Choosing a repository structure](/guide/concepts#choosing-a-repository-structure).
:::

This walkthrough takes you from an empty git repository to a fully managed secrets setup with encrypted files, schema validation, and a running web UI. Every command is copy-pasteable.

## Install Clef

```bash
npm install -g @clef-sh/cli
```

Verify:

```bash
clef --version
```

## Prerequisites

Before starting, ensure you have installed:

- **sops** — `brew install sops` (macOS) or see [installation guide](./installation.md)

Verify sops is ready:

```bash
clef doctor
```

## 1. Initialise a Clef repository

Start in an existing git repository (or create a new one):

```bash
mkdir my-project && cd my-project
git init
```

Run `clef init` to generate the manifest and scaffold the encrypted file matrix:

```bash
clef init --namespaces database,payments,auth --non-interactive
# Creates three default environments: dev, staging, production
```

This creates:

- `clef.yaml` — the manifest declaring your namespaces, environments, and SOPS configuration
- `.sops.yaml` — SOPS creation rules that tell the `sops` binary how to encrypt new files
- `.sops/` directory with a `.gitignore` that excludes your private key
- One encrypted file per namespace/environment cell (e.g., `database/dev.enc.yaml`, `payments/staging.enc.yaml`)
- A pre-commit hook that blocks unencrypted secret commits

::: tip
When using the age backend, `clef init` automatically generates an age key pair and stores the private key at `.clef/key.txt` (gitignored). No manual key generation is required.
:::

> **Migrating from an existing project?** If you already have secrets in `.env` files or a secrets manager, use `clef import` to bulk-migrate them. See the [migration guide](migrating.md).

## 2. Set a secret

Add a secret to the `payments` namespace in the `staging` environment:

```bash
clef set payments/staging STRIPE_SECRET_KEY
```

Because the value argument is omitted, Clef prompts for it with hidden input — the value is never echoed to the terminal or written to disk as plaintext. You can also provide the value directly:

```bash
clef set payments/staging STRIPE_PUBLIC_KEY pk_test_abc123
```

> **Note:** Passing a secret value directly on the command line shows a warning — the value will be visible in your shell history. For sensitive values, omit the value argument and Clef will prompt you interactively:
>
> ```bash
> clef set payments/staging STRIPE_PUBLIC_KEY
> Enter value: (hidden)
> ```
>
> Or use `--random` to scaffold a placeholder.

## 3. Retrieve a secret

Read the value back:

```bash
clef get payments/staging STRIPE_SECRET_KEY
```

The output is raw (no labels, no colour) so it pipes cleanly into other tools:

```bash
clef get payments/staging STRIPE_SECRET_KEY | pbcopy
```

## 4. Compare environments

See what differs between `dev` and `staging` for the `payments` namespace:

```bash
clef diff payments dev staging
```

Output shows a table of keys with their values in each environment and a status column indicating which keys are changed, identical, or missing from one side. If keys are missing, Clef prints the exact `clef set` command to fix the gap.

## 5. Run the linter

Validate the entire repository — matrix completeness, schema compliance, and SOPS integrity:

```bash
clef lint
```

A healthy repo prints:

```
All clear — 9 files healthy
```

If there are issues, Clef groups them by severity (errors, warnings, info) and provides a fix command for each one. To auto-fix safe issues like missing matrix files:

```bash
clef lint --fix
```

## 6. Open the web UI

Launch the local web UI:

```bash
clef ui
```

Your browser opens to `http://127.0.0.1:7777` where you can:

- Browse the namespace-by-environment matrix and spot missing cells or key drift at a glance
- Click into a namespace to view and edit secrets with masked values
- Diff two environments side-by-side
- Run lint and see validation issues with inline fix commands

The server binds to `127.0.0.1` only — it is never accessible from the network.

Press `Ctrl+C` in the terminal to stop the server.

## Full example session

```bash
# Set up the repository
mkdir acme-secrets && cd acme-secrets
git init

# Initialise Clef with three namespaces
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

## Next steps

Now that you have a working Clef setup, learn about the core concepts that make it work.

[Next: Core Concepts](/guide/concepts)
