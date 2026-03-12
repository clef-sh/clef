# clef exec

Run a command with decrypted secrets injected as environment variables. This is the recommended way to consume Clef secrets in CI/CD pipelines and local development — values stay in memory and are never written to disk.

## Syntax

```bash
clef exec <namespace/environment> [options] -- <command> [args...]
```

The `--` separator is **required**. Everything before `--` is parsed as Clef flags; everything after `--` is the command to execute.

## Arguments

| Argument                | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `namespace/environment` | The target file to decrypt (e.g. `payments/production`) |
| `command`               | The command to spawn with the injected environment      |

## Flags

| Flag                | Type    | Default | Description                                                                                                                                      |
| ------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--only <keys>`     | string  | —       | Comma-separated list of keys to inject. All other keys are excluded.                                                                             |
| `--prefix <string>` | string  | —       | Prefix all injected key names. `--prefix APP_` turns `DB_URL` into `APP_DB_URL`.                                                                 |
| `--no-override`     | boolean | `false` | Do not override environment variables that already exist in the current shell. Existing values take precedence.                                  |
| `--also <target>`   | string  | —       | Also inject secrets from another namespace/environment. Can be specified multiple times. Later targets override earlier ones for duplicate keys. |

> `--repo` is a global option. See [Global options](overview.md#global-options).

## Exit Codes

The exit code of `clef exec` matches the child process exactly. If `node server.js` exits with code 0, `clef exec` exits with 0. If it exits with 42, `clef exec` exits with 42. This is critical for CI pipelines where exit codes determine pass/fail.

If Clef itself fails (e.g. decryption error, missing manifest), it exits with code 1.

## Examples

### Basic usage — inject secrets into a Node.js server

```bash
clef exec payments/production -- node server.js
```

All keys from `payments/production` are available as `process.env.*` inside `server.js`.

### Run a deploy script with production secrets

```bash
clef exec database/production -- ./deploy.sh
```

### Inject only specific keys

```bash
clef exec payments/staging --only STRIPE_KEY,STRIPE_WEBHOOK -- node worker.js
```

All `clef exec` flags must appear before the `--` separator.

### Prefix all keys to avoid collisions

```bash
clef exec payments/production --prefix PAYMENTS_ -- node server.js
```

Inside the process, the key `STRIPE_KEY` is available as `PAYMENTS_STRIPE_KEY`.

### Preserve existing environment variables

```bash
export DATABASE_URL=postgres://localhost/dev
clef exec database/production --no-override -- node server.js
```

The local `DATABASE_URL` is kept; the production value from Clef is not injected.

### Multi-namespace with `--also`

```bash
clef exec database/production \
  --also auth/production \
  --also payments/production \
  -- node server.js
```

All three namespaces are decrypted and merged into one environment. Later `--also` targets override earlier ones for duplicate keys. Use `--no-override` to keep existing values instead.

### Multi-namespace composition (chaining)

Alternatively, chain `clef exec` calls:

```bash
clef exec database/production -- \
  clef exec auth/production -- \
  node server.js
```

Each `clef exec` wraps the next, building up the environment. Later namespaces override earlier ones for duplicate keys. Use `--no-override` to reverse this precedence.

## Security

- Values are injected via `child_process.spawn` environment, never via shell interpolation. They do not appear in `ps aux` output.
- Values never touch disk — they exist in memory only during the lifetime of the child process.
- Error messages from Clef never contain decrypted values.

## Related Commands

- [`clef export`](/cli/export) — Print secrets as shell export statements (for cases where `exec` is not possible)
- [`clef get`](/cli/get) — Retrieve a single key value
- [`clef set`](/cli/set) — Set a secret value
