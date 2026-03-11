# clef delete

Remove a key from an encrypted file. Supports deleting from a single environment or from all environments in a namespace at once.

## Syntax

```bash
clef delete <target> <key> [options]
```

## Arguments

| Argument | Description                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `target` | Namespace and environment in the format `namespace/environment` (e.g., `payments/staging`). When using `--all-envs`, provide just the namespace name (e.g., `payments`). |
| `key`    | The key name to delete                                                                                                                                                   |

## Description

`clef delete` decrypts the target file, removes the specified key, and re-encrypts the file. Clef prompts for confirmation before proceeding.

With the `--all-envs` flag, the key is removed from every environment in the namespace in a single operation. This is useful for cleaning up deprecated secrets.

If the key does not exist in the file, Clef exits with an error.

## Flags

| Flag         | Type      | Default | Description                                           |
| ------------ | --------- | ------- | ----------------------------------------------------- |
| `--all-envs` | `boolean` | `false` | Delete the key from all environments in the namespace |

## Examples

### Delete from a single environment

```bash
clef delete payments/staging STRIPE_LEGACY_KEY
```

```
Delete 'STRIPE_LEGACY_KEY' from payments/staging? (y/N) y
✓ Deleted 'STRIPE_LEGACY_KEY' from payments/staging
```

### Delete from all environments

```bash
clef delete payments STRIPE_LEGACY_KEY --all-envs
```

```
Delete 'STRIPE_LEGACY_KEY' from payments in all environments (dev, staging, production)? (y/N) y
✓ Deleted 'STRIPE_LEGACY_KEY' from payments in all environments
```

### Key not found

```bash
clef delete auth/dev NONEXISTENT_KEY
```

```
Delete 'NONEXISTENT_KEY' from auth/dev? (y/N) y
✗ Key 'NONEXISTENT_KEY' not found in auth/dev.
```

## Related commands

- [`clef set`](/cli/set) — add or update a key
- [`clef get`](/cli/get) — check a key's value before deleting
- [`clef lint`](/cli/lint) — verify the repo is consistent after deletion
