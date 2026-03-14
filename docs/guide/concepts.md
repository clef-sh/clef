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

On disk, the matrix maps to a directory structure inside a `secrets/` directory:

```
your-repo/
├── src/
├── clef.yaml
└── secrets/
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
2. **Key drift** — a key that exists in some environments but not others within the same namespace. For example, a key was added to `dev` but never promoted to `staging` or `production`. Clef compares the full set of keys across all environments in a namespace, not just the count.

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

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

The manifest declares:

- Which **environments** exist and whether any are protected (requiring confirmation before writes)
- Which **namespaces** exist, with optional schema references and team ownership
- The **SOPS configuration** — which encryption backend to use
- The **file pattern** — how namespace and environment map to file paths on disk

::: tip age key location
When using the age backend, each developer's key label and storage method are stored in `.clef/config.yaml` (gitignored) — not in the manifest. The private key itself lives in the OS keychain or at `~/.config/clef/keys/{label}/keys.txt`, always outside the repository.
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

## Recommended approach: co-located secrets

SOPS already gives you Secrets as Code — encrypted values committed to git. Clef takes this further by recommending **co-location**: secrets live in the same repository as the code that uses them, inside a `secrets/` directory. This is not just a convenience — it is the recommended approach for security, operability, and drift prevention.

```
my-app/
├── src/
├── package.json
├── clef.yaml
└── secrets/
    ├── database/
    │   ├── dev.enc.yaml
    │   ├── staging.enc.yaml
    │   └── production.enc.yaml
    └── auth/
        ├── dev.enc.yaml
        ├── staging.enc.yaml
        └── production.enc.yaml
```

### Why co-location matters

- **Blast radius containment.** Each repo has its own age key (with a unique per-repo label). Compromising one repo's key does not expose any other repo's secrets.
- **Drift detection.** `clef lint` catches missing keys, schema violations, and environment gaps at the same PR cadence as code changes. Secrets in a separate repo drift silently.
- **One commit hash = complete system state.** When secrets live alongside code, a single git SHA represents everything your system needs to run — code, config, and credentials. CI checks out one ref and has the full picture. Rollbacks are one operation, not a coordination problem across repos. This is what makes truly stateless CI possible: `git checkout <sha> && clef exec ... -- deploy.sh` is a complete, reproducible deployment from a single ref.
- **Atomic reviews.** Secrets and code change together in the same PR — reviewers see the full picture. A separate secrets repo means separate PRs that are harder to review atomically.
- **No sync step.** Developers get secret changes by pulling the repository. There is no separate checkout, clone, or sync operation.
- **Ownership clarity.** The team that owns the code owns the secrets, with the same review process and access controls.

### Why not a standalone secrets repo

A shared, centralised secrets repository is explicitly discouraged:

- **Single point of compromise.** One key grants access to secrets for every service. A leaked key or compromised CI runner exposes everything.
- **Invisible drift.** Secret changes are decoupled from the code that consumes them. A renamed environment variable breaks production with no warning.
- **Unclear ownership.** When multiple teams share a secrets repo, it is unclear who reviews changes and who is responsible for rotation.
- **Operational friction.** Every secret change requires coordinating across two repos, two PRs, and two review cycles.

::: tip Access control
By default, a recipient added with `clef recipients add` can decrypt all environments. Clef provides two ways to restrict access within a repo:

- **Per-environment recipients** — scope recipients to specific environments with `clef recipients add <key> -e production`.
- **Per-environment backends** — configure production to use a KMS backend (AWS KMS, GCP KMS) while dev/staging use age. See [Per-environment SOPS override](/guide/manifest#per-environment-sops-override).

For a comparison of these approaches, see [age vs KMS](/guide/quick-start#age-vs-kms-choosing-an-encryption-backend).
:::

### Using `--dir` for other local repos

The `--dir` flag points Clef at a different local directory instead of the current working directory:

```bash
clef --dir ../other-project get database/production DB_URL
clef --dir /opt/my-app lint
```

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
