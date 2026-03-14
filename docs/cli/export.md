# clef export

Print decrypted secrets as shell export statements to stdout. This is the escape hatch for environments where `clef exec` is not possible — for example, CI systems that require environment variables to be set before the main script runs.

## Syntax

```bash
clef export <namespace/environment> [options]
```

## Arguments

| Argument                | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `namespace/environment` | The target file to decrypt (e.g. `payments/production`) |

## Flags

| Flag                | Type    | Default | Description                                                  |
| ------------------- | ------- | ------- | ------------------------------------------------------------ |
| `--format <format>` | string  | `env`   | Output format. Only `env` is supported.                      |
| `--no-export`       | boolean | `false` | Omit the `export` keyword — output bare `KEY='value'` pairs. |

> `--dir` is a global option. See [Global options](overview.md#global-options).

## Exit Codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | Values printed successfully                                |
| `1`  | Decryption error, invalid arguments, or unsupported format |

## Output Format

Values are single-quoted to correctly handle special characters (`$`, `!`, spaces, etc.):

```bash
export DATABASE_URL='postgres://prod-cluster.internal/myapp'
export DATABASE_POOL_SIZE='50'
export DATABASE_SSL='true'
```

Single quotes within values are escaped as `'\''`:

```bash
export GREETING='it'\''s working'
```

## Examples

### Eval into the current shell

```bash
eval $(clef export payments/production --format env)
echo $STRIPE_KEY   # value is now in your shell
```

### Bare key-value pairs (no export keyword)

```bash
clef export payments/staging --no-export
# Output:
# STRIPE_KEY='sk_test_abc'
# WEBHOOK_SECRET='whsec_xyz'
```

### Pipe to a script that reads stdin

```bash
clef export database/production | while IFS='=' read -r key value; do
  echo "Key: $key"
done
```

## Unsupported Formats

The following formats are explicitly **not supported** because they would write plaintext values to disk or encourage unsafe patterns:

- `--format dotenv` — writes plaintext `.env` file to disk
- `--format json` — writes plaintext JSON to disk
- `--format yaml` — writes plaintext YAML to disk
- `--output <file>` — Clef never writes plaintext to disk

Use `clef exec` instead of `clef export` wherever possible. If you need secrets in a running process, use [`clef exec`](/cli/exec) instead — it injects values directly into the process environment without any intermediate file.

## Security Considerations

When using `eval $(clef export ...)`, the decrypted values are briefly present in the shell environment and visible to any process that can read `/proc/<pid>/environ` on Linux. `clef exec` does not have this exposure because it spawns the child process directly.

**Use `clef exec` whenever possible.** Use `clef export` only when your CI system or workflow cannot support the subprocess wrapping pattern.

## Related Commands

- [`clef exec`](/cli/exec) — Recommended: inject secrets directly into a child process
- [`clef get`](/cli/get) — Retrieve a single key value
