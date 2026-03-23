# @clef-sh/cli

CLI for [Clef](https://clef.sh) — git-native secrets management built on [Mozilla SOPS](https://github.com/getsops/sops). Adds structure, visibility, and guardrails to encrypted secrets without servers, databases, or vendor lock-in.

## Install

```bash
npm install -g @clef-sh/cli
```

## Prerequisites

- [SOPS](https://github.com/getsops/sops) v3.8+
- [age](https://age-encryption.org) (or another SOPS-supported backend)
- Git
- Node.js 18+

Run `clef doctor` to verify your environment.

## Quick start

```bash
# Initialise a new Clef repo
clef init --namespaces database,payments,auth --non-interactive

# Set and retrieve secrets
clef set database/staging DB_PASSWORD
clef get database/staging DB_HOST

# Compare environments
clef diff database dev staging

# Validate the repo
clef lint

# Run a command with injected secrets
clef exec payments/production -- ./deploy.sh

# Launch the local web UI
clef ui
```

## Commands

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `clef doctor`        | Check dependencies and configuration      |
| `clef init`          | Initialise a new Clef repo                |
| `clef update`        | Scaffold missing matrix cells             |
| `clef get`           | Retrieve a single decrypted value         |
| `clef set`           | Set a secret value                        |
| `clef compare`       | Compare a stored secret with a value      |
| `clef delete`        | Remove a key from an encrypted file       |
| `clef diff`          | Compare secrets between two environments  |
| `clef lint`          | Full repo health check                    |
| `clef rotate`        | Re-encrypt with a new recipient key       |
| `clef scan`          | Scan for plaintext secrets in the repo    |
| `clef import`        | Import secrets from `.env`, JSON, or YAML |
| `clef export`        | Print secrets as shell export statements  |
| `clef recipients`    | Manage age recipients and access requests |
| `clef hooks install` | Install the pre-commit hook               |
| `clef exec`          | Run a command with injected secrets       |
| `clef ui`            | Start the local web UI                    |
| `clef merge-driver`  | Git merge driver for encrypted files      |

## Global options

```bash
clef --version                          # Print version
clef --help                             # Print help
clef <cmd> --help                       # Help for a specific command
clef --dir <path> <cmd> ...             # Run against a different local directory
clef --plain <cmd> ...                  # Plain output without emoji/color
```

## Documentation

Full docs at [clef.sh/docs](https://clef.sh/docs/).

## License

MIT
