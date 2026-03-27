# clef get

Retrieve and print a single decrypted secret value.

## Syntax

```bash
clef get <target> <key>
```

## Arguments

| Argument | Description                                                                                   |
| -------- | --------------------------------------------------------------------------------------------- |
| `target` | Namespace and environment in the format `namespace/environment` (e.g., `payments/production`) |
| `key`    | The key name to retrieve from the encrypted file                                              |

## Flags

| Flag    | Type    | Default | Description                                                |
| ------- | ------- | ------- | ---------------------------------------------------------- |
| `--raw` | boolean | `false` | Print the plaintext value to stdout (for piping/scripting) |

> `--dir` is a global option. See [Global options](overview.md#global-options).

## Description

By default, `clef get` copies the decrypted value to the system clipboard and prints a masked placeholder on screen. This is safe for screen sharing and terminal recordings.

Use `--raw` to print the plaintext value to stdout instead — useful for piping or scripting.

If the key does not exist in the file, Clef prints an error listing the available keys and exits with code 1.

The decrypted file contents exist only in memory during the operation. No plaintext is ever written to disk.

## Exit codes

| Code | Meaning                           |
| ---- | --------------------------------- |
| `0`  | Value found and printed           |
| `1`  | Key not found or decryption error |

## Examples

### Default (clipboard)

```bash
clef get payments/production STRIPE_SECRET_KEY
```

```
  STRIPE_SECRET_KEY: ●●●●●●●● (copied to clipboard)
```

### Raw output (for piping)

```bash
clef get payments/production STRIPE_SECRET_KEY --raw
```

```
sk_live_abc123xyz
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
