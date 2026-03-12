# clef get

Retrieve and print a single decrypted secret value. The output is raw — no labels, no colour — so it can be piped safely into other commands.

## Syntax

```bash
clef get <target> <key>
```

## Arguments

| Argument | Description                                                                                   |
| -------- | --------------------------------------------------------------------------------------------- |
| `target` | Namespace and environment in the format `namespace/environment` (e.g., `payments/production`) |
| `key`    | The key name to retrieve from the encrypted file                                              |

## Description

`clef get` decrypts the specified namespace/environment file, extracts the value for the given key, and prints it to stdout followed by a newline. The output contains no formatting, no labels, and no colour codes, making it suitable for piping into other commands or assigning to shell variables.

If the key does not exist in the file, Clef prints an error listing the available keys and exits with code 1.

The decrypted file contents exist only in memory during the operation. No plaintext is ever written to disk.

## Exit codes

| Code | Meaning                           |
| ---- | --------------------------------- |
| `0`  | Value found and printed           |
| `1`  | Key not found or decryption error |

## Examples

### Basic retrieval

```bash
clef get payments/production STRIPE_SECRET_KEY
```

```
sk_live_abc123xyz
```

### Pipe to clipboard

```bash
clef get payments/production STRIPE_SECRET_KEY | pbcopy
```

### Assign to a shell variable

```bash
export DB_URL=$(clef get database/staging DATABASE_URL)
```

### Use in a script

```bash
#!/bin/bash
STRIPE_KEY=$(clef get payments/production STRIPE_SECRET_KEY)
curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com/v1/charges
```

### Key not found

```bash
clef get payments/production NONEXISTENT_KEY
```

```
✗ Key 'NONEXISTENT_KEY' not found in payments/production. Available keys: STRIPE_SECRET_KEY, STRIPE_PUBLIC_KEY, WEBHOOK_SECRET
```

## Related commands

- [`clef set`](/cli/set) — set or update a secret value
- [`clef delete`](/cli/delete) — remove a key from an encrypted file
- [`clef diff`](/cli/diff) — compare values between environments
