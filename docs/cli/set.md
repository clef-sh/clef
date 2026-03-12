# clef set

Set a secret value in an encrypted file. If the value argument is omitted, Clef prompts for it with hidden input so the value never appears in your terminal history.

## Syntax

```bash
clef set <target> <key> [value]
```

## Arguments

| Argument | Description                                                                                |
| -------- | ------------------------------------------------------------------------------------------ |
| `target` | Namespace and environment in the format `namespace/environment` (e.g., `payments/staging`) |
| `key`    | The key name to set                                                                        |
| `value`  | The secret value (optional — prompts with hidden input if omitted)                         |

## Description

`clef set` decrypts the target file, sets the specified key to the given value, and re-encrypts the file. The plaintext value is never written to disk or printed to stdout.

If the key already exists, its value is overwritten. If the key does not exist, it is added to the file.

For protected environments (those with `protected: true` in the manifest), Clef prompts for confirmation before proceeding:

```
This is a protected environment (production). Confirm? (y/N)
```

## Flags

| Flag       | Type    | Default | Description                                                                       |
| ---------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `--random` | boolean | `false` | Generate a cryptographically random placeholder value and mark the key as pending |

## Examples

### Set with inline value

```bash
clef set payments/staging STRIPE_SECRET_KEY sk_test_abc123
```

```
✓ Set payments/staging STRIPE_SECRET_KEY
```

### Set with hidden prompt

When you omit the value, Clef prompts securely — the input is not echoed to the terminal:

```bash
clef set payments/staging STRIPE_SECRET_KEY
```

```
Enter value for STRIPE_SECRET_KEY: ********
✓ Set payments/staging STRIPE_SECRET_KEY
```

This is the recommended approach for sensitive values because the value never appears in your shell history.

### Set in a protected environment

```bash
clef set database/production DB_PASSWORD
```

```
This is a protected environment (production). Confirm? (y/N) y
Enter value for DB_PASSWORD: ********
✓ Set database/production DB_PASSWORD
```

### Set via pipe

You can pipe a value from another command:

```bash
openssl rand -base64 32 | clef set auth/staging JWT_SECRET
```

### Set with random placeholder

When you don't have the real credential yet, use `--random` to scaffold a pending value:

```bash
clef set payments/staging STRIPE_SECRET_KEY --random
```

```
✓ Set payments/staging STRIPE_SECRET_KEY (random placeholder — pending)
```

Later, when the real value is available:

```bash
clef set payments/staging STRIPE_SECRET_KEY sk_live_abc123
```

```
✓ Set payments/staging STRIPE_SECRET_KEY
```

The pending state clears automatically when a real value is set. See [Pending Values](/guide/pending-values) for more details.

## Security notes

- The plaintext value exists only in memory during the operation
- When using the inline value form (`clef set ... key value`), the value will appear in your shell history — use the prompt form for sensitive values
- The confirmation step for protected environments cannot be bypassed via flags; it requires interactive input

## Related commands

- [`clef get`](/cli/get) — retrieve a secret value
- [`clef delete`](/cli/delete) — remove a key
- [`clef diff`](/cli/diff) — see what differs between environments after setting a value
