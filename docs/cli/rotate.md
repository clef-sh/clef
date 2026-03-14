# clef rotate

Re-encrypt a file with a new recipient key. Used when adding a new team member, replacing a compromised key, or migrating to a different key.

## Syntax

```bash
clef rotate <target> --new-key <key> [options]
```

## Arguments

| Argument | Description                                                                                   |
| -------- | --------------------------------------------------------------------------------------------- |
| `target` | Namespace and environment in the format `namespace/environment` (e.g., `payments/production`) |

## Description

`clef rotate` adds a new age public key as a recipient on the specified encrypted file. Under the hood, it calls `sops rotate` with the `--add-age` flag, which re-encrypts the file's data key for all existing recipients plus the new one.

This command is essential for two scenarios:

1. **Adding a team member.** When a new developer joins and generates an age key, their public key needs to be added to every file they should be able to decrypt.
2. **Key compromise.** If a private key is leaked, rotate all affected files to a new key and revoke the old one.

For protected environments, an interactive confirmation prompt is shown before proceeding.

## Flags

| Flag        | Type     | Default | Description                                                 |
| ----------- | -------- | ------- | ----------------------------------------------------------- |
| `--new-key` | `string` | —       | **(Required)** The new age public key to add as a recipient |

## Examples

### Add a new team member's key

A new developer runs `clef init` in a clone of the repository to generate their key pair, then shares their public key:

```bash
# The new developer runs:
clef init
# Label: azure-hawk (shown during init, stored in .clef/config.yaml)
grep "public key" ~/.config/clef/keys/azure-hawk/keys.txt
# Output: # public key: age1abc123...

# A team member with existing access runs:
clef rotate payments/dev --new-key age1abc123def456
clef rotate payments/staging --new-key age1abc123def456
clef rotate payments/production --new-key age1abc123def456
```

```
✓ Rotated key for payments/dev
  Previous recipients: age1existing...
  New recipient added: age1abc123def456
```

### Rotate after key compromise

When a key is compromised, rotate every file to exclude the old key. First, remove the compromised key from your `.sops.yaml` creation rules, then re-encrypt:

```bash
clef rotate database/production --new-key age1newkey789
```

```
✓ Rotated key for database/production
  Previous recipients: age1compromised..., age1existing...
  New recipient added: age1newkey789
```

After rotation, the compromised key can still decrypt old git commits but not the current version of the file.

### Protected environment

When the target environment is marked as `protected` in the manifest, Clef prompts for interactive confirmation before rotating:

```bash
clef rotate database/production --new-key age1abc123
```

```
? production is a protected environment. Rotate key anyway? (y/N)
```

## Important notes

- Rotation adds a new recipient; it does not remove old ones. To remove a recipient, edit `.sops.yaml` and re-encrypt the file manually using `sops updatekeys`.
- After rotating, commit the changed files to git so other team members receive the updated encryption.
- Rotation requires that you can currently decrypt the file (you must have one of the existing recipient keys).

## Related commands

- [`clef lint`](/cli/lint) — verify SOPS metadata after rotation
- [`clef set`](/cli/set) — modify values in the rotated file
- [`clef init`](/cli/init) — initial key and recipient setup
