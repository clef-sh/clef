# clef recipients

Manage age public keys that can decrypt this repository's secrets.

## Synopsis

```bash
clef recipients list
clef recipients add <age-public-key> [--label <name>]
clef recipients remove <age-public-key>
```

## Description

Every encrypted file in a Clef repository is encrypted for all current recipients. A recipient is an age public key — anyone with the corresponding private key can decrypt the secrets.

`clef recipients` manages this list. It handles adding new team members, removing departing team members, and listing who currently has access.

## Subcommands

### list

List all recipients that can currently decrypt the repository.

```bash
clef recipients list
```

Output:

```
Recipients — 3 keys can decrypt this repository

  age1…xyz1abc   Alice
  age1…uvw2def   Bob
  age1…rst3ghi   CI deploy key
```

### add

Add a new recipient and re-encrypt all files.

```bash
clef recipients add age1abc... --label "Alice"
```

This will:

1. Validate the age public key format
2. Add the key to `clef.yaml`
3. Re-encrypt every encrypted file in the matrix

The new recipient will be able to decrypt all secrets after pulling the updated files.

**Always run `--dry-run` first when importing secrets. For recipients, the confirmation prompt serves the same purpose — review the details before confirming.**

### remove

Remove a recipient and re-encrypt all files.

```bash
clef recipients remove age1def...
```

This command requires interactive input and cannot be run in CI. See [Re-encryption vs revocation](#re-encryption-vs-revocation) for why.

## Re-encryption vs revocation

::: warning Important
Re-encryption removes **future** access, not **past** access.
:::

When you remove a recipient, Clef re-encrypts all files so the removed key cannot decrypt future versions. However, if the removed recipient previously decrypted any file, they may have the plaintext value in memory or on disk.

**To fully revoke access, you must also rotate the secret values themselves:**

```bash
clef rotate database/staging
clef rotate database/production
```

This distinction is fundamental to how asymmetric encryption works. Clef surfaces it prominently because getting it wrong is a security risk.

## Labels

Recipients can have optional human-readable labels stored in `clef.yaml`:

```yaml
sops:
  default_backend: age
  age:
    recipients:
      - key: age1abc...
        label: Alice
      - key: age1def...
        label: Bob
      - age1ghi... # no label — plain string form
```

Labels are purely for display. Changing a label does not require re-encryption.

Both the object form (`key` + `label`) and the plain string form are valid. When adding a recipient with `--label`, the object form is used. Without `--label`, the plain string form is used.

## Flags

| Flag             | Type   | Default | Description                     |
| ---------------- | ------ | ------- | ------------------------------- |
| `--label <name>` | string | —       | Human-readable label (add only) |
| `--repo <path>`  | string | cwd     | Override repository root        |

## Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | Operation completed successfully                   |
| 1    | Operation failed (rollback attempted)              |
| 2    | Invalid input (key format, key not found, non-TTY) |

## Examples

### Add a team member

```bash
clef recipients add age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p \
  --label "Alice"
```

### Remove a team member

```bash
clef recipients remove age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

After removing, rotate all secrets:

```bash
clef rotate database/staging
clef rotate database/production
clef rotate payments/staging
clef rotate payments/production
```

### List current recipients

```bash
clef recipients list
```

## Related commands

- [`clef rotate`](rotate.md) — rotate encryption keys after removing a recipient
- [`clef doctor`](doctor.md) — verify your SOPS and age setup
