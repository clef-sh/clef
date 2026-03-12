# CLI Overview

Clef provides twelve commands that cover the full secrets lifecycle — from verifying your environment to injecting secrets into running processes. The CLI is built on [commander.js](https://github.com/tj/commander.js) and follows Unix conventions: raw output for piping, meaningful exit codes, and no colour when stdout is not a TTY.

## Command summary

| Command                            | Description                              | Common flags                                                     |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| [`clef doctor`](/cli/doctor)       | Check dependencies and configuration     | `--json`                                                         |
| [`clef init`](/cli/init)           | Initialise a new Clef repo               | `--namespaces`, `--environments`, `--backend`, `--random-values` |
| [`clef get`](/cli/get)             | Retrieve a single decrypted value        | —                                                                |
| [`clef set`](/cli/set)             | Set a secret value                       | `--random`, `--all-envs`                                         |
| [`clef delete`](/cli/delete)       | Remove a key from an encrypted file      | `--all-envs`                                                     |
| [`clef diff`](/cli/diff)           | Compare secrets between two environments | `--show-identical`, `--json`                                     |
| [`clef lint`](/cli/lint)           | Full repo health check                   | `--fix`, `--json`                                                |
| [`clef rotate`](/cli/rotate)       | Re-encrypt with a new recipient key      | `--new-key`, `--confirm`                                         |
| [`clef hooks install`](/cli/hooks) | Install the pre-commit hook              | —                                                                |
| [`clef exec`](/cli/exec)           | Run a command with injected secrets      | `--only`, `--prefix`, `--also`                                   |
| [`clef export`](/cli/export)       | Print secrets as shell export statements | `--format`, `--no-export`                                        |
| [`clef ui`](/cli/ui)               | Start the local web UI                   | `--port`, `--no-open`                                            |

## Global options

```bash
clef --version                  # Print the version number
clef --help                     # Print help for all commands
clef <cmd> --help               # Print help for a specific command
clef --repo <path> <cmd> ...    # Use a different repo root
```

### `--repo <path>`

Override the default repository root. By default, Clef looks for `clef.yaml` in the current working directory. Use `--repo` to point at a different directory — for example, a separate secrets repository:

```bash
clef --repo ../acme-secrets get database/production DB_URL
clef --repo /opt/secrets lint
clef --repo ../acme-secrets exec payments/production -- ./deploy.sh
```

This flag works with every command and is essential for the [Pattern B (standalone secrets repo)](/guide/concepts#choosing-a-repository-structure) workflow.

## Exit codes

All commands follow the same exit code convention:

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | Success (for `diff`: no differences found) |
| `1`  | Error or differences found                 |

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

Clef reads its configuration from `clef.yaml` in the current working directory (or the directory specified by `--repo`). There are no global configuration files or environment variables specific to Clef. SOPS-related environment variables (`SOPS_AGE_KEY_FILE`, `SOPS_AGE_RECIPIENTS`, etc.) are passed through to the SOPS binary.
