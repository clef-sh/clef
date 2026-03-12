# CLI Overview

Clef provides sixteen commands that cover the full secrets lifecycle — from verifying your environment to injecting secrets into running processes. The CLI is built on [commander.js](https://github.com/tj/commander.js) and follows Unix conventions: raw output for piping, meaningful exit codes, and no colour when stdout is not a TTY.

## Command summary

| Command                              | Description                               | Common flags                                                     |
| ------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| [`clef doctor`](/cli/doctor)         | Check dependencies and configuration      | `--json`, `--fix`                                                |
| [`clef init`](/cli/init)             | Initialise a new Clef repo                | `--namespaces`, `--environments`, `--backend`, `--random-values` |
| [`clef update`](/cli/update)         | Scaffold missing matrix cells             | —                                                                |
| [`clef get`](/cli/get)               | Retrieve a single decrypted value         | —                                                                |
| [`clef set`](/cli/set)               | Set a secret value                        | `--random`                                                       |
| [`clef delete`](/cli/delete)         | Remove a key from an encrypted file       | `--all-envs`                                                     |
| [`clef diff`](/cli/diff)             | Compare secrets between two environments  | `--show-identical`, `--json`                                     |
| [`clef lint`](/cli/lint)             | Full repo health check                    | `--fix`, `--json`                                                |
| [`clef rotate`](/cli/rotate)         | Re-encrypt with a new recipient key       | `--new-key`                                                      |
| [`clef scan`](/cli/scan)             | Scan for plaintext secrets in the repo    | `--staged`, `--json`                                             |
| [`clef import`](/cli/import)         | Import secrets from external formats      | `--format`, `--namespace`, `--environment`                       |
| [`clef recipients`](/cli/recipients) | Manage age recipients (list, add, remove) | —                                                                |
| [`clef hooks install`](/cli/hooks)   | Install the pre-commit hook               | —                                                                |
| [`clef exec`](/cli/exec)             | Run a command with injected secrets       | `--only`, `--prefix`, `--also`                                   |
| [`clef export`](/cli/export)         | Print secrets as shell export statements  | `--format`, `--no-export`                                        |
| [`clef ui`](/cli/ui)                 | Start the local web UI                    | `--port`, `--no-open`                                            |

## Global options

```bash
clef --version                          # Print the version number
clef --help                             # Print help for all commands
clef <cmd> --help                       # Print help for a specific command
clef --repo <path|url> <cmd> ...        # Use a different repo root (path or git URL)
clef --repo <url> --branch <branch> ... # Use a specific branch of a remote repo
```

### `--repo <path|url>`

Override the default repository root. Accepts either a local path or a git URL (SSH or HTTPS).

**Local path** — point at a directory on disk:

```bash
clef --repo ../acme-secrets get database/production DB_URL
clef --repo /opt/secrets lint
clef --repo ../acme-secrets exec payments/production -- ./deploy.sh
```

**Git URL** — Clef clones the repository into a local cache (`~/.cache/clef/`) and uses it directly. No separate checkout step is required:

```bash
# SSH
clef --repo git@github.com:acme/secrets.git get database/production DB_URL

# HTTPS
clef --repo https://github.com/acme/secrets.git exec payments/production -- ./deploy.sh
```

On subsequent calls, Clef fetches the latest changes and resets to the tip of the branch before running the command.

::: warning Read-only when using a URL
Write commands (`set`, `delete`, `rotate`, `init`, `import`, `ui`, `hooks install`, `recipients add/remove`) are blocked when `--repo` is a URL. Clone the repository locally to make changes.
:::

### `--branch <branch>`

When `--repo` is a git URL, check out a specific branch instead of the remote's default branch. Ignored when `--repo` is a local path.

```bash
clef --repo git@github.com:acme/secrets.git --branch feature/new-payment-gateway \
  get payments/staging STRIPE_KEY
```

This is useful in CI when testing an application branch against a matching secrets branch before either is merged:

```yaml
# GitHub Actions example
- run: clef --repo ${{ vars.SECRETS_REPO }} --branch ${{ github.head_ref || 'main' }} \
    exec payments/staging -- npm test
  env:
    SOPS_AGE_KEY: ${{ secrets.AGE_PRIVATE_KEY }}
```

This flag works with every read command and is essential for the [Pattern B (standalone secrets repo)](/guide/concepts#choosing-a-repository-structure) workflow.

## Exit codes

All commands follow the same exit code convention:

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success (for `diff`: no differences found)                                    |
| `1`  | Error or differences found                                                    |
| `2`  | Precondition failure — command could not start or complete (`scan`, `import`) |

`clef exec` is an exception: its exit code matches the child process exactly.

## Target syntax

Several commands accept a `<target>` argument in the format `namespace/environment`:

```bash
clef get payments/production STRIPE_KEY
clef set database/staging DB_HOST db.staging.internal
clef delete auth/dev LEGACY_TOKEN
clef rotate payments/production --new-key age1...
clef exec payments/production -- node server.js
clef export payments/staging --format env
```

The namespace and environment must match entries in your `clef.yaml` manifest.

## Piping and scripting

`clef get` outputs raw values without labels or colour, making it safe for piping:

```bash
# Copy a secret to the clipboard
clef get payments/production STRIPE_KEY | pbcopy

# Use a secret in another command
export DB_URL=$(clef get database/staging DATABASE_URL)

# Compare values programmatically
clef diff payments dev staging --json | jq '.rows[] | select(.status != "identical")'
```

`clef lint` and `clef diff` support `--json` for machine-readable output in CI pipelines.

## Configuration

Clef reads its configuration from `clef.yaml` in the current working directory (or the directory specified by `--repo`). There are no global configuration files specific to Clef. Per-repo local settings live in `.clef/config.yaml` (gitignored). SOPS-related environment variables (`SOPS_AGE_KEY_FILE`, `SOPS_AGE_RECIPIENTS`, etc.) are passed through to the SOPS binary.
