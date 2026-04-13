# CLI Overview

The CLI is built on [commander.js](https://github.com/tj/commander.js) and follows Unix conventions: raw output for piping, meaningful exit codes, and no colour when stdout is not a TTY.

## Command summary

### Setup & diagnostics

| Command                            | Description                                           | Flags                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`clef init`](/cli/init)           | Initialise a new Clef repo or onboard a new developer | `--namespaces <ns>`, `--environments <envs>`, `--backend <backend>`, `--secrets-dir <dir>`, `--non-interactive`, `--random-values`, `--include-optional` |
| [`clef doctor`](/cli/doctor)       | Check dependencies, keys, and configuration           | `--json`, `--fix`                                                                                                                                        |
| [`clef update`](/cli/update)       | Scaffold missing matrix cells after manifest changes  | —                                                                                                                                                        |
| [`clef hooks install`](/cli/hooks) | Install or reinstall the pre-commit hook              | —                                                                                                                                                        |

### Reading & writing secrets

| Command                        | Description                                   | Arguments & flags                                                                                               |
| ------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`clef get`](/cli/get)         | Retrieve a single decrypted value (pipe-safe) | `<target> <key>`                                                                                                |
| [`clef set`](/cli/set)         | Set a secret value (prompts for hidden input) | `<target> <key> [value]`, `--random`                                                                            |
| [`clef compare`](/cli/compare) | Compare a stored secret with a supplied value | `<target> <key> [value]`                                                                                        |
| [`clef delete`](/cli/delete)   | Remove a key from an encrypted file           | `<target> <key>`, `--all-envs`                                                                                  |
| [`clef import`](/cli/import)   | Bulk-import from `.env`, JSON, or YAML        | `<target> [source]`, `--format <fmt>`, `--prefix <str>`, `--keys <keys>`, `--overwrite`, `--dry-run`, `--stdin` |

### Validation & visibility

| Command                      | Description                                           | Arguments & flags                                                                 |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`clef lint`](/cli/lint)     | Full repo health check — matrix, schemas, drift, SOPS | `--fix`, `--json`, `--push`                                                       |
| [`clef diff`](/cli/diff)     | Compare secrets between two environments              | `<namespace> <env-a> <env-b>`, `--show-identical`, `--show-values`, `--json`      |
| [`clef scan`](/cli/scan)     | Scan repo for leaked plaintext secrets                | `[paths...]`, `--staged`, `--severity <level>`, `--json`                          |
| [`clef drift`](/cli/drift)   | Detect drift between manifest and encrypted files     | `--json`, `--push`                                                                |
| [`clef report`](/cli/report) | Generate a metadata report for the repository         | `--json`, `--push`, `--at <sha>`, `--since <sha>`, `--namespace`, `--environment` |

### Key & recipient management

| Command                                      | Description                                | Arguments & flags                     |
| -------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| [`clef rotate`](/cli/rotate)                 | Re-encrypt with a new recipient key        | `<target>`, `--new-key <key>`         |
| [`clef recipients list`](/cli/recipients)    | List current recipients                    | `-e <env>`                            |
| [`clef recipients add`](/cli/recipients)     | Add an age recipient to an environment     | `<key>`, `--label <name>`, `-e <env>` |
| [`clef recipients remove`](/cli/recipients)  | Remove an age recipient                    | `<key>`, `-e <env>`                   |
| [`clef recipients request`](/cli/recipients) | Request access (publishes your public key) | `--label <name>`, `-e <env>`          |
| [`clef recipients pending`](/cli/recipients) | List pending access requests               | —                                     |
| [`clef recipients approve`](/cli/recipients) | Approve a pending request                  | `<identifier>`, `-e <env>`            |

### Consumption & deployment

| Command                      | Description                                     | Arguments & flags                                                                          |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`clef exec`](/cli/exec)     | Run a command with secrets injected as env vars | `<target> -- <cmd>`, `--only <keys>`, `--prefix <str>`, `--also <target>`, `--no-override` |
| [`clef export`](/cli/export) | Print secrets as shell export statements        | `<target>`, `--format <fmt>`, `--no-export`                                                |
| [`clef serve`](/cli/serve)   | Start a local secrets server for development    | `--identity <name>`, `--env <env>`, `--port <port>`                                        |

### Service identities & artifacts

| Command                               | Description                                          | Arguments & flags                              |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| [`clef service create`](/cli/service) | Create a service identity with per-env age key pairs | `<name>`, `--namespaces <ns>`, `--description` |
| [`clef service list`](/cli/service)   | List all service identities                          | —                                              |
| [`clef service show`](/cli/service)   | Show details of a service identity                   | `<name>`                                       |
| [`clef service rotate`](/cli/service) | Rotate keys for a service identity                   | `<name>`, `-e <env>`                           |
| [`clef pack`](/cli/pack)              | Pack an encrypted artifact for a service identity    | `<identity> <env>`, `-o <path>`, `--ttl <sec>` |
| [`clef revoke`](/cli/revoke)          | Revoke a packed artifact (emergency brake)           | `<identity> <env>`                             |

### Backend migration

| Command                                        | Description                                              | Arguments & flags                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`clef migrate-backend`](/cli/migrate-backend) | Migrate encrypted files from one SOPS backend to another | `--age`, `--aws-kms-arn <arn>`, `--gcp-kms-resource-id <id>`, `--azure-kv-url <url>`, `--pgp-fingerprint <fp>`, `-e <env>`, `--dry-run`, `--skip-verify` |

### Cloud

| Command                           | Description                                      | Arguments & flags |
| --------------------------------- | ------------------------------------------------ | ----------------- |
| [`clef cloud init`](/cli/cloud)    | Sign up, install the Clef bot, scaffold policy  | `--provider`, `--repo` |
| [`clef cloud login`](/cli/cloud)   | Authenticate with Clef Cloud                    | `--provider`           |
| [`clef cloud logout`](/cli/cloud)  | Clear local Clef Cloud credentials              | —                      |
| [`clef cloud status`](/cli/cloud)  | Show account, installation, and plan status     | —                      |
| [`clef cloud doctor`](/cli/cloud)  | Verify Cloud setup: policy, credentials, remote | —                      |
| [`clef cloud upgrade`](/cli/cloud) | Upgrade to a paid Clef Cloud plan               | —                      |

### Interface & integration

| Command                                  | Description                                            | Flags                          |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| [`clef ui`](/cli/ui)                     | Start the local web UI                                 | `--port <port>`, `--no-open`   |
| [`clef merge-driver`](/cli/merge-driver) | Git merge driver for encrypted files (auto-configured) | —                              |
| [`clef agent`](/cli/agent)               | Start the runtime secrets agent sidecar                | See [agent docs](/guide/agent) |

## Global options

```bash
clef --version              # Print the version number
clef --help                 # Print help for all commands
clef <cmd> --help           # Print help for a specific command
clef --dir <path> <cmd>     # Run against a different local directory
clef --plain <cmd>          # Disable emoji and colour output
```

### `--dir <path>`

Override the default repository root. Accepts a local directory path. Defaults to the current working directory.

```bash
clef --dir ../other-project get database/production DB_URL
clef --dir /opt/my-app lint
clef --dir ../other-project exec payments/production -- ./deploy.sh
```

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

Clef reads its configuration from `clef.yaml` in the current working directory (or the directory specified by `--dir`). There are no global configuration files specific to Clef. Per-repo local settings live in `.clef/config.yaml` (gitignored). Clef uses its own environment variables (`CLEF_AGE_KEY`, `CLEF_AGE_KEY_FILE`) which are translated to SOPS equivalents and passed to the SOPS subprocess — `SOPS_*` variables in the parent environment are not inherited by Clef to prevent cross-tool credential leakage.

### sops binary resolution

Clef locates the `sops` binary using a three-tier resolution chain:

1. **`CLEF_SOPS_PATH`** — if set, used as the absolute path to the sops binary
2. **Bundled package** — `@clef-sh/sops-{platform}-{arch}` installed as an optional dependency
3. **System PATH** — falls back to bare `sops` command

Run `clef doctor` to see which source was resolved. The `--json` flag includes `source` and `path` fields in the `sops` object.
