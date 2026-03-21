# clef compare

Compare a stored secret with a supplied value without exposing either.

## Synopsis

```bash
clef compare <target> <key> [value]
```

## Description

Decrypts the stored value and compares it against the supplied value. Outputs match or no-match — neither value is ever printed. Uses constant-time comparison to avoid timing side-channels.

If `value` is omitted, prompts with hidden input. If provided as a command-line argument, warns about shell history visibility.

## Arguments

| Argument | Description                                       |
| -------- | ------------------------------------------------- |
| `target` | `namespace/environment` (e.g. `payments/staging`) |
| `key`    | The secret key name to compare                    |
| `value`  | Optional — if omitted, prompts with hidden input  |

## Exit codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | Values match                            |
| 1    | Values do not match or operation failed |

## Examples

```bash
# Interactive (hidden input)
clef compare payments/staging STRIPE_KEY

# Inline (warns about shell history)
clef compare payments/staging STRIPE_KEY "sk_test_abc123"

# Scripting — exit code indicates match
if clef compare database/production DB_PASSWORD "$EXPECTED"; then
  echo "Password matches"
fi
```

## Related commands

- [`clef get`](get.md) — retrieve and print the decrypted value
- [`clef set`](set.md) — set a secret value
