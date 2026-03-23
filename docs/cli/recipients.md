# clef recipients

Manage age public keys that can decrypt this repository's secrets.

## Synopsis

```bash
clef recipients list [-e <environment>]
clef recipients add <age-public-key> [--label <name>] -e <environment>
clef recipients remove <age-public-key> [-e <environment>]
clef recipients request [--label <name>] [-e <environment>]
clef recipients pending
clef recipients approve <label-or-key> [-e <environment>]
```

## Description

A recipient is an age public key — anyone with the corresponding private key can decrypt. `clef recipients` manages the recipient list globally or scoped to a specific environment via `-e`.

## Subcommands

### list

List all recipients that can currently decrypt the repository, or a specific environment.

```bash
clef recipients list
clef recipients list -e production
```

Output:

```
Recipients — 3 keys can decrypt this repository

  age1…xyz1abc   Alice
  age1…uvw2def   Bob
  age1…rst3ghi   CI deploy key
```

### add

Add a new recipient and re-encrypt files for a specific environment. The `-e` flag is required — recipients must be added per-environment.

```bash
clef recipients add age1abc... --label "Alice" -e dev
clef recipients add age1abc... --label "Alice" -e production
```

Validates the key, adds it to `clef.yaml`, and re-encrypts the environment's files. Run once per environment the recipient needs access to.

### remove

Remove a recipient and re-encrypt files.

```bash
clef recipients remove age1def...
clef recipients remove age1def... -e production
```

With `-e`, only the specified environment's files are re-encrypted and the recipient is removed from that environment's list only.

This command requires interactive input and cannot be run in CI. See [Re-encryption vs revocation](#re-encryption-vs-revocation) for why.

### request

Publish your public key so a team member can approve it — no out-of-band key exchange needed.

```bash
clef recipients request
clef recipients request --label "Alice"
clef recipients request --label "Alice" -e staging
```

Derives your public key from the private key created during `clef init`, writes it to `.clef-requests.yaml`, and prints a commit hint. The label defaults to `git config user.name` if not provided.

### pending

List pending access requests.

```bash
clef recipients pending
```

Shows all requests in `.clef-requests.yaml` with labels, key previews, age, and environment scope.

### approve

Approve a pending request and re-encrypt files for an environment. Uses the environment from the request if one was specified, otherwise `-e` is required.

```bash
clef recipients approve Alice -e dev
clef recipients approve Alice    # uses environment from request
```

Runs the same confirmation and re-encryption flow as `add`, then removes the request from `.clef-requests.yaml`.

## Re-encryption vs revocation

::: warning Important
Re-encryption removes **future** access, not **past** access.
:::

Re-encryption removes future access only. If the removed recipient previously decrypted any file, they may retain the plaintext. **To fully revoke access, rotate the secret values:**

```bash
clef rotate database/staging
clef rotate database/production
```

This is fundamental to how asymmetric encryption works.

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

Both the object form and plain string form are valid. `--label` uses the object form; omitting it uses the string form.

## Per-environment recipients

Recipients can be scoped to a specific environment using `-e`. Per-environment recipients are stored in the environment's `recipients` array in `clef.yaml`:

```yaml
environments:
  - name: dev
    description: Local development
  - name: production
    description: Production environment
    protected: true
    recipients:
      - key: age1abc...
        label: Ops team
      - age1def...
```

See [Per-environment recipients](/guide/manifest#per-environment-recipients) for details.

## Flags

| Flag                      | Type   | Default | Description                               |
| ------------------------- | ------ | ------- | ----------------------------------------- |
| `-e, --environment <env>` | string | —       | Scope operation to a specific environment |
| `--label <name>`          | string | —       | Human-readable label (add only)           |
| `--dir <path>`            | string | cwd     | Override repository root                  |

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

### Add a recipient to a specific environment

```bash
clef recipients add age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p \
  --label "Ops team" -e production
```

### List current recipients

```bash
clef recipients list
clef recipients list -e production
```

## Related commands

- [`clef rotate`](rotate.md) — rotate encryption keys after removing a recipient
- [`clef doctor`](doctor.md) — verify your SOPS and age setup
