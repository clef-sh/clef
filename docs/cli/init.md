# clef init

Initialise a new Clef-managed repository. Creates the manifest file, SOPS configuration, generates an age key pair, and scaffolds the encrypted file matrix.

## Syntax

```bash
clef init [options]
```

## Description

`clef init` sets up everything Clef needs:

1. Creates `clef.yaml`, `.sops.yaml`, and `.clef/config.yaml` (gitignored)
2. Generates an age key pair with a unique per-repo label stored in the OS keychain (or `~/.config/clef/keys/{label}/keys.txt`). No age binary required.
3. Scaffolds an encrypted file for every namespace/environment cell
4. Installs a pre-commit hook and SOPS merge driver (see [Merge Conflicts](/guide/merge-conflicts))
5. Scaffolds `.clef/policy.yaml` (90-day rotation default) and a CI compliance workflow (auto-detected provider)

`clef init` is safe to run at any time:

- **Nothing set up** — full initialisation.
- **`clef.yaml` exists, `.clef/config.yaml` does not** — new developer cloning the repo. Sets up local key config without touching the manifest.
- **Both exist** — prints "Already initialised" and exits.

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

Without `--non-interactive`, Clef prompts for environments and namespaces:

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

Creates the file pattern `config/encrypted/{namespace}/{environment}.enc.yaml`.

### Initialise with AWS KMS

```bash
clef init \
  --namespaces database,auth \
  --backend awskms \
  --non-interactive
```

### New developer joining a repo

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

When namespaces have schemas, `--random-values` scaffolds required keys with random placeholders:

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

> **Note:** Requires at least one namespace with a `schema` field pointing to a valid schema YAML file. Namespaces without schemas are skipped.

#### Recommended workflow

1. Create schema files first (`schemas/database.yaml`, etc.)
2. Reference them in the manifest via the `schema` field on each namespace
3. Run `clef init --random-values --non-interactive`
4. Open `clef ui` and replace pending values as real credentials become available

See [Pending Values](/guide/pending-values) for details.

### Scaffolding after manifest changes

After adding namespaces or environments to `clef.yaml`, use `clef update` to scaffold the new encrypted files:

```bash
# 1. Edit clef.yaml to add new namespaces or environments
# 2. Scaffold missing files
clef update
```

## Error cases

- **Already initialised:** Both files exist — prints "Already initialised" and exits.
- **No namespaces provided:** At least one namespace is required via `--namespaces` or interactively.
- **Not a git repository:** `clef init` refuses to run outside a git repository.

## Related commands

- [`clef lint --fix`](/cli/lint) — scaffold missing matrix files after key generation
- [`clef hooks install`](/cli/hooks) — reinstall the pre-commit hook
- [`clef set`](/cli/set) — add your first secret after initialisation
- [`clef policy init`](/cli/policy) — re-scaffold or customise `.clef/policy.yaml` and the CI workflow
- [Compliance guide](/guide/compliance) — rotation policy concepts and CI/CD setup
