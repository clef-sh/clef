# clef init

Initialise a new Clef-managed repository. Creates the manifest file, SOPS configuration, generates an age key pair, and scaffolds the encrypted file matrix.

## Syntax

```bash
clef init [options]
```

## Description

`clef init` sets up everything Clef needs to manage secrets in a repository:

1. **Creates `clef.yaml`** — the manifest declaring namespaces, environments, and SOPS settings
2. **Creates `.sops.yaml`** — SOPS creation rules so the `sops` binary knows how to encrypt new files
3. **Generates an age key pair** — writes the private key to `.clef/key.txt` with a `.clef/.gitignore` that excludes it from version control (age backend only)
4. **Scaffolds the matrix** — creates an encrypted file for every namespace/environment combination
5. **Installs the pre-commit hook** — a git hook that blocks commits containing unencrypted secret files

`clef init` is idempotent in two ways:

- **Both `clef.yaml` and `.clef/key.txt` already exist** — prints "Already initialised" and exits without making changes.
- **`clef.yaml` exists but `.clef/key.txt` does not** — second-developer onboarding mode: generates a key pair and configures `.clef/config.yaml`, but does not overwrite the manifest.

`clef init` refuses to run inside a git repository that already contains a manifest, unless running in second-developer onboarding mode.

## Flags

| Flag                        | Type      | Default                    | Description                                                     |
| --------------------------- | --------- | -------------------------- | --------------------------------------------------------------- |
| `--environments <envs>`     | `string`  | `"dev,staging,production"` | Comma-separated list of environment names                       |
| `--namespaces <namespaces>` | `string`  | —                          | Comma-separated list of namespace names (required)              |
| `--backend <backend>`       | `string`  | `"age"`                    | SOPS encryption backend: `age`, `awskms`, `gcpkms`, or `pgp`    |
| `--non-interactive`         | `boolean` | `false`                    | Skip interactive prompts and use flag values directly           |
| `--random-values`           | `boolean` | `false`                    | Scaffold required schema keys with random pending values        |
| `--include-optional`        | `boolean` | `false`                    | Also scaffold optional schema keys (use with `--random-values`) |

## Examples

### Basic initialisation

```bash
clef init --namespaces database,payments,auth --non-interactive
```

Output:

```
✓ Created clef.yaml
✓ Created .sops.yaml
✓ Scaffolded 9 encrypted file(s)
✓ Installed pre-commit hook

Next steps:
  clef set <namespace>/<env> <KEY> <value>  — add a secret
  clef lint                                 — check repo health
  clef ui                                   — open the web UI
```

### Interactive initialisation

Without the `--non-interactive` flag, Clef prompts for environments and namespaces:

```bash
clef init
```

```
Environments (comma-separated) [dev,staging,production]: dev,staging,production
Namespaces (comma-separated): database,payments
```

### Initialise with AWS KMS

```bash
clef init \
  --namespaces database,auth \
  --backend awskms \
  --non-interactive
```

### Second-developer onboarding

If `clef.yaml` already exists (e.g., a team member cloning the repository for the first time), `clef init` generates a key pair for the new developer without modifying the manifest:

```
ℹ clef.yaml already exists — running in second-developer onboarding mode.
✓ Generated age key pair at .clef/key.txt
✓ Configured .clef/config.yaml

Next steps:
  Share your public key with a teammate so they can add you as a recipient:
    grep "public key" .clef/key.txt
  Then: clef recipients add <your-public-key>
```

### Initialise with random pending values

When namespaces have schemas defined, `--random-values` scaffolds required keys with cryptographically random placeholders:

```bash
clef init --namespaces database,payments --random-values --non-interactive
```

```
✓ Created clef.yaml
✓ Created .sops.yaml
✓ Scaffolded 6 encrypted file(s)
✓ Installed pre-commit hook

Scaffolding random values for namespaces with schemas...

database (3 environments)
  ✓ DATABASE_URL        → random (pending)
  ✓ DATABASE_SSL        → random (pending)
  ✓ DATABASE_POOL_SIZE  skipped (optional)

⚠ payments — no schema, skipped

Scaffolded 2 pending values across 1 namespace.
Run clef ui to replace them with real values,
or: clef set <namespace/environment> <KEY>
```

Use `--include-optional` to also scaffold optional schema keys:

```bash
clef init --namespaces database --random-values --include-optional --non-interactive
```

> **Note:** `--random-values` requires at least one namespace to have a `schema` field pointing to a valid schema YAML file. Namespaces without schemas are skipped. If no namespaces have schemas, the flag has no effect.

#### Recommended workflow

The most reliable way to bootstrap a new repo with pending values:

1. Create schema files first (`schemas/database.yaml`, etc.)
2. Reference them in the manifest via the `schema` field on each namespace
3. Run `clef init --random-values --non-interactive`
4. Open `clef ui` and replace pending values as real credentials become available

See [Pending Values](/guide/pending-values) for more details on the pending workflow.

### Scaffolding after manifest changes

If you have added new namespaces or environments to `clef.yaml` after the initial `clef init`, use `clef update` to scaffold the new encrypted files:

```bash
# 1. Edit clef.yaml to add new namespaces or environments
# 2. Scaffold missing files
clef update
```

## Error cases

- **Already initialised:** If both `clef.yaml` and `.clef/key.txt` already exist, `clef init` prints "Already initialised" and exits without making changes.
- **No namespaces provided:** At least one namespace is required. Either pass `--namespaces` or provide them interactively.
- **Not a git repository:** `clef init` refuses to run outside a git repository to prevent accidental initialisation in arbitrary directories.

## Related commands

- [`clef lint --fix`](/cli/lint) — scaffold missing matrix files after key generation
- [`clef hooks install`](/cli/hooks) — reinstall the pre-commit hook
- [`clef set`](/cli/set) — add your first secret after initialisation
