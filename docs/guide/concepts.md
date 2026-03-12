# Core Concepts

Clef is built around a small set of concepts that, together, make secrets management structured, visible, and safe. This page explains the mental model.

## The two-axis model

Every secret in a Clef-managed repository lives at the intersection of two axes:

| Axis            | Answers                                      | Examples                                |
| --------------- | -------------------------------------------- | --------------------------------------- |
| **Namespace**   | What part of the system does this belong to? | `database`, `auth`, `payments`, `email` |
| **Environment** | Which deployment does this apply to?         | `dev`, `staging`, `production`          |

This produces a matrix. Each cell in the matrix is a single encrypted YAML file containing the key-value pairs for that namespace in that environment.

```
                 dev        staging     production
  ┌─────────────┬──────────┬───────────┬────────────┐
  │ database    │ 5 keys   │ 5 keys    │ 5 keys     │
  │ payments    │ 3 keys   │ 3 keys    │ 4 keys     │
  │ auth        │ 7 keys   │ 7 keys    │ 7 keys     │
  └─────────────┴──────────┴───────────┴────────────┘
```

On disk, the matrix maps to a directory structure:

```
your-repo/
├── database/
│   ├── dev.enc.yaml
│   ├── staging.enc.yaml
│   └── production.enc.yaml
├── payments/
│   ├── dev.enc.yaml
│   ├── staging.enc.yaml
│   └── production.enc.yaml
└── auth/
    ├── dev.enc.yaml
    ├── staging.enc.yaml
    └── production.enc.yaml
```

The two-axis model makes two problems visible that are otherwise invisible with raw SOPS:

1. **Missing cells** — a namespace/environment combination that should exist but does not. This means someone added a new environment but forgot to create files for it.
2. **Key drift** — a cell with fewer keys than its siblings. This means a key was added to `dev` but never promoted to `staging` or `production`.

Both problems are caught by `clef lint` and visualised in the UI matrix view.

## The manifest

The manifest is a file called `clef.yaml` at the root of your repository. It is the single source of truth for Clef's understanding of your project:

```yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Pre-production
  - name: production
    description: Live system
    protected: true

namespaces:
  - name: database
    description: Database connection config
    schema: schemas/database.yaml
  - name: auth
    description: Auth and identity secrets
  - name: payments
    description: Payment provider credentials

sops:
  default_backend: age

file_pattern: "{namespace}/{environment}.enc.yaml"
```

The manifest declares:

- Which **environments** exist and whether any are protected (requiring confirmation before writes)
- Which **namespaces** exist, with optional schema references and team ownership
- The **SOPS configuration** — which encryption backend to use
- The **file pattern** — how namespace and environment map to file paths on disk

::: tip Age key location
When using the age backend, each developer's private key path is stored in `.clef/config.yaml` (gitignored) — not in the manifest. The key itself lives outside the repository at `~/.config/clef/keys.txt` by default.
:::

Clef reads this file at the start of every operation. The manifest is committed to git alongside your encrypted files, so every team member shares the same structure.

For a full field-by-field reference, see the [Manifest Reference](/guide/manifest).

## Schemas

A schema defines the expected keys for a namespace: which keys are required, what type each value should be, and optional regex patterns for validation.

```yaml
# schemas/database.yaml
keys:
  DATABASE_URL:
    type: string
    required: true
    pattern: "^postgres://"
    description: PostgreSQL connection string
  DATABASE_POOL_SIZE:
    type: integer
    required: false
    default: 10
  DATABASE_SSL:
    type: boolean
    required: true
```

When a namespace has a schema, Clef validates every encrypted file against it during `clef lint`. The UI also shows schema compliance inline in the editor view.

Schemas catch three categories of problems:

| Category                 | Example                                                        |
| ------------------------ | -------------------------------------------------------------- |
| **Missing required key** | `DATABASE_URL` is required but absent in `production`          |
| **Type mismatch**        | `DATABASE_POOL_SIZE` should be an integer but contains `"abc"` |
| **Undeclared key**       | `LEGACY_DB_HOST` exists in the file but is not in the schema   |

For the full schema specification, see the [Schema Reference](/schemas/reference).

## Git-native philosophy

Clef treats git as the only persistence layer. There is no external database, no cloud sync service, and no server component. This means:

- **Branching works.** Secrets changes live on branches just like code changes. You can review them in pull requests (the encrypted diff shows which keys changed even if the values are opaque).
- **History is free.** Git log shows who changed a secret, when, and why. No separate audit trail is needed.
- **Collaboration is pull-and-push.** Team members get secret changes by pulling the repository. There is no separate sync step.
- **Backups are git remotes.** Pushing to GitHub, GitLab, or any git remote backs up your encrypted secrets automatically.

The Clef UI surfaces git state throughout: the sidebar shows the current branch and uncommitted file count, the editor has a commit flow, and the lint view shows whether changes are staged.

## Protected environments

Any environment marked `protected: true` in the manifest requires explicit confirmation before Clef writes to it. Production is the most common protected environment.

In the CLI, writing to a protected environment triggers a confirmation prompt:

```
This is a protected environment (production). Confirm? (y/N)
```

In the UI, the editor shows a persistent red warning banner when the production tab is active. This makes editing production feel meaningfully different from editing dev — without blocking the workflow.

## The SOPS layer

Clef never implements any cryptography. All encryption and decryption is performed by the `sops` binary running as a subprocess. Clef communicates with SOPS via stdin/stdout pipes:

```
              Clef (in memory)
                    │
        ┌───────────┼───────────┐
        │           │           │
        ▼           ▼           ▼
   sops decrypt  sops encrypt  sops rotate
   (stdout →     (stdin →      (in-place
    memory)       stdout →      re-encrypt)
                  write file)
```

Decrypted values exist only in memory. They are never written to temporary files, never logged, and never printed to stdout with labels or formatting (the `clef get` command outputs raw values for piping, but never logs them).

This architecture means Clef inherits all of SOPS's backend support — age, AWS KMS, GCP KMS, and PGP — without having to implement any of it.

## Design decision: all namespaces are encrypted

Clef does not support unencrypted namespaces. Every file in the namespace/environment matrix is encrypted by SOPS — there is no `encrypted: false` option on the namespace definition.

This is an intentional architectural constraint, not a missing feature. The reasons:

1. **Security simplicity.** A single rule ("every file is encrypted") is easier to audit, enforce, and explain than "some files are encrypted and some aren't". Mixed-mode repos create a class of bugs where a namespace is accidentally left unencrypted.
2. **Pre-commit hook reliability.** The hook checks for SOPS encryption markers. With mixed-mode, the hook would need to consult the manifest to decide whether a file should be encrypted — adding fragile coupling between the hook and the manifest parser.
3. **SOPS overhead is negligible.** For non-sensitive configuration that doesn't need encryption, use a regular config file outside the Clef matrix. Clef manages secrets; plain config belongs elsewhere.

If you have configuration values that are not secret, keep them in a non-Clef config file (e.g. `config/defaults.yaml`). Only values that must be encrypted belong in the Clef matrix.

## Choosing a repository structure

Clef supports two patterns for organising secrets alongside code. Both are first-class — choose the one that fits your team.

### Pattern A — Co-located secrets

Encrypted files live in the same repository as the application code:

```
my-app/
├── src/
├── package.json
├── clef.yaml
├── database/
│   ├── dev.enc.yaml
│   ├── staging.enc.yaml
│   └── production.enc.yaml
└── auth/
    ├── dev.enc.yaml
    ├── staging.enc.yaml
    └── production.enc.yaml
```

**Pros:**

- Secrets and code change together in the same PR — reviewers see the full picture
- No separate checkout step in CI
- Simple `clef init` in the project root — works immediately
- Developers never need to think about which repo to look in

**Cons:**

- With a single age backend, the recipient list is flat — every recipient can decrypt every environment, and any recipient can add new recipients without approval
- Multi-service teams end up with secrets for unrelated services in the same repo

::: warning Access control depends on your backend configuration
**With a single age backend (the default),** every recipient in `clef.yaml` can decrypt **every** file in the matrix — including production. A developer added with `clef recipients add` immediately gains the ability to run `clef get payments/production` and read live credentials. There is also nothing preventing a recipient from adding another person without approval.

**With per-environment backends,** you can mitigate this by configuring production to use a KMS backend (AWS KMS, GCP KMS) while dev/staging use age. Decryption of production files then requires cloud IAM credentials — developers with only an age key cannot decrypt them. See [Per-environment SOPS override](/guide/manifest#per-environment-sops-override).

If you need access control **and** cannot use a KMS backend, use Pattern B with restricted access on the secrets repository.
:::

**Best for:** single-service repositories, small teams, and projects where all contributors are trusted with all environments.

### Pattern B — Standalone secrets repository

A dedicated repository contains only the manifest and encrypted files. Application repositories reference it at deploy time:

```
acme-secrets/                    my-app/
├── clef.yaml            ├── src/
├── database/                    ├── package.json
│   ├── dev.enc.yaml             └── deploy.sh
│   ├── staging.enc.yaml
│   └── production.enc.yaml
└── auth/
    ├── dev.enc.yaml
    └── production.enc.yaml
```

**Pros:**

- Secrets are audited, reviewed, and access-controlled independently of application code
- A single secrets repo can serve multiple applications — no duplication
- Developers who do not need secret access never see the ciphertext
- Compliance teams can restrict the secrets repo without restricting the main codebase

**Cons:**

- Write operations (`set`, `delete`, `rotate`, `recipients`) require a local checkout of the secrets repo
- Secret and code changes are in separate PRs — harder to review atomically

**Best for:** multi-service organisations, regulated environments, and teams with strict separation between infrastructure/secrets and application code.

### Using `--repo` with Pattern B

When secrets live in a separate repository, pass its path or git URL directly to `--repo`:

```bash
# Local checkout
clef --repo ../acme-secrets get database/production DB_URL
clef --repo ../acme-secrets exec payments/production -- node server.js

# Git URL — Clef clones/updates automatically, no checkout step needed
clef --repo git@github.com:acme/secrets.git exec payments/production -- ./deploy.sh
clef --repo https://github.com/acme/secrets.git lint
```

When a URL is passed, Clef caches the clone in `~/.cache/clef/` and fetches fresh on every invocation. Use `--branch` to target a specific branch:

```bash
clef --repo git@github.com:acme/secrets.git --branch feature/xyz get payments/staging STRIPE_KEY
```

Write operations are blocked when `--repo` is a URL — clone the repo locally to make changes.

## Pending values

When you set up a new namespace, you often don't have real credentials yet. Clef solves this with **pending values** — cryptographically random placeholders that keep your encrypted files valid and your matrix complete while you wait for real secrets.

```bash
# Scaffold a key with a random placeholder
clef set payments/staging STRIPE_SECRET_KEY --random

# Later, replace with the real value
clef set payments/staging STRIPE_SECRET_KEY sk_live_abc123
```

Pending state is tracked in `.clef-meta.yaml` sidecar files (plaintext, committed, containing only key names — never secret values). The UI, `clef lint`, and the matrix view all surface pending keys so nothing is forgotten.

For the full pending workflow, see [Pending Values](/guide/pending-values).

## Next steps

Learn the full manifest specification and every configuration option available.

[Next: Manifest Reference](/guide/manifest)
