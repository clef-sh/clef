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
3. **Generates an age key pair** — creates a unique per-repo label (e.g., `coral-tiger`) and stores the private key in the OS keychain (or at `~/.config/clef/keys/{label}/keys.txt` as a fallback). The label and storage method are recorded in `.clef/config.yaml` (gitignored via `.clef/.gitignore`). Uses the `age-encryption` npm package — no age binary required (age backend only)
4. **Scaffolds the matrix** — creates an encrypted file for every namespace/environment combination
5. **Installs the pre-commit hook** — a git hook that blocks commits containing unencrypted secret files
6. **Configures the SOPS merge driver** — a custom git merge driver that resolves encrypted file conflicts at the plaintext level (see [Merge Conflicts](/guide/merge-conflicts))

`clef init` is safe to run at any time — it detects what already exists and does only what is needed:

- **Nothing set up yet** — full initialisation: creates the manifest, generates an age key pair, scaffolds the matrix, installs the pre-commit hook.
- **`clef.yaml` exists but `.clef/config.yaml` does not** — a new developer cloning the repo for the first time. `clef init` prompts for the path to their age private key, writes their local `.clef/config.yaml`, and leaves the manifest untouched.
- **Both `clef.yaml` and `.clef/config.yaml` already exist** — nothing to do. Prints "Already initialised" and exits.

## Flags

| Flag                        | Type      | Default                    | Description                                                     |
| --------------------------- | --------- | -------------------------- | --------------------------------------------------------------- |
| `--environments <envs>`     | `string`  | `"dev,staging,production"` | Comma-separated list of environment names                       |
| `--namespaces <namespaces>` | `string`  | —                          | Comma-separated list of namespace names (required)              |
| `--backend <backend>`       | `string`  | `"age"`                    | SOPS encryption backend: `age`, `awskms`, `gcpkms`, or `pgp`    |
| `--secrets-dir <dir>`       | `string`  | `"secrets"`                | Base directory for encrypted secret files                       |
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
Secrets directory [secrets]: secrets
```

### Custom secrets directory

```bash
clef init --namespaces database,auth --secrets-dir config/encrypted --non-interactive
```

This creates the file pattern `config/encrypted/{namespace}/{environment}.enc.yaml` instead of the default `secrets/...`.

### Initialise with AWS KMS

```bash
clef init \
  --namespaces database,auth \
  --backend awskms \
  --non-interactive
```

### New developer joining a repo

If a developer clones a repository that already has `clef.yaml`, running `clef init` sets up their local key configuration without touching the manifest:

```
ℹ clef.yaml found — setting up your local key for this machine.
✓ Generated age key pair (label: azure-hawk)
✓ Private key stored in OS keychain
✓ Created .clef/config.yaml

Next steps:
  Share your public key with a teammate so they can add you as a recipient:
    grep "public key" ~/.config/clef/keys/azure-hawk/keys.txt
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

- **Already initialised:** If both `clef.yaml` and `.clef/config.yaml` already exist, `clef init` prints "Already initialised" and exits without making changes.
- **No namespaces provided:** At least one namespace is required. Either pass `--namespaces` or provide them interactively.
- **Not a git repository:** `clef init` refuses to run outside a git repository to prevent accidental initialisation in arbitrary directories.

## Related commands

- [`clef lint --fix`](/cli/lint) — scaffold missing matrix files after key generation
- [`clef hooks install`](/cli/hooks) — reinstall the pre-commit hook
- [`clef set`](/cli/set) — add your first secret after initialisation
