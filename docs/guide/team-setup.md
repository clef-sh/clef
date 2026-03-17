# Team Setup

This guide covers adding and removing team members from a Clef-managed repository.

## Adding your first team member

Ask the new developer to run `clef init` in a clone of the repository — it generates a key pair and stores the private key in their OS keychain (or `~/.config/clef/keys/{label}/keys.txt`). They find their public key from:

```bash
# The label is shown during init and stored in .clef/config.yaml
grep "public key" ~/.config/clef/keys/<label>/keys.txt
```

Then add them:

```bash
clef recipients add age1abc... --label "Alice"
```

This re-encrypts all files so Alice can decrypt them. Commit and push:

```bash
git add clef.yaml && git add -A && git commit -m "add recipient: Alice"
```

### Scoping recipients to an environment

Use `-e` to restrict a recipient to a specific environment:

```bash
clef recipients add age1abc... --label "Alice" -e production
```

See [Per-environment recipients](/guide/manifest#per-environment-recipients). List and remove scoped recipients the same way:

```bash
clef recipients list -e production
clef recipients remove age1abc... -e production
```

## Removing a team member

```bash
clef recipients remove age1def...
```

Re-encryption removes future access, but if Bob previously decrypted any values he may still have them. To complete revocation, rotate the secret values too:

```bash
clef rotate database/production
clef rotate payments/production
```

## How multi-user encryption works

SOPS uses a **data encryption key (DEK)** model. When a file is encrypted:

1. SOPS generates a random DEK.
2. Every secret value is encrypted with the DEK (AES-GCM).
3. The DEK is encrypted with each recipient's public key and stored in `sops:` metadata.

The result looks like this:

```yaml
# production/database.enc.yaml (simplified)

DB_PASSWORD: ENC[AES256_GCM,data:xK9z...] # encrypted once with the DEK
DB_HOST: ENC[AES256_GCM,data:mR3q...]

sops:
  age:
    - recipient: age1alice...
      enc: | # DEK encrypted with Alice's public key
        -----BEGIN AGE ENCRYPTED FILE-----
        YWdlLWVuY3J5cHRpb24ub3JnL3YxCg...
        -----END AGE ENCRYPTED FILE-----
    - recipient: age1bob...
      enc: | # DEK encrypted with Bob's public key
        -----BEGIN AGE ENCRYPTED FILE-----
        dGhpcyBpcyBub3QgdGhlIHJlYWwgZGF0YQ...
        -----END AGE ENCRYPTED FILE-----
    - recipient: age1charlie...
      enc: | # DEK encrypted with Charlie's public key
        -----BEGIN AGE ENCRYPTED FILE-----
        ZW5jcnlwdGVkIGtleSBkYXRhIGhlcmUK...
        -----END AGE ENCRYPTED FILE-----
```

N recipients produce N encrypted copies of the DEK and one encrypted copy of each secret. Any recipient's private key unwraps their copy of the DEK to decrypt secrets.

### Adding a recipient

`clef recipients add age1dave...` calls `sops rotate --add-age`, which decrypts the DEK with the operator's key and re-encrypts it for Dave. Dave's private key never leaves his machine.

### Removing a recipient

`clef recipients remove` rotates the DEK — a new DEK is generated, all secrets are re-encrypted, and only remaining recipients get a copy. This removes future access only. Anyone who already held the DEK can still decrypt older git history — rotating the secret values is the only way to fully revoke access.

## The CI key

CI should use its own age key pair, not a team member's. Generate one with `clef init` on the CI machine, store the private key as a CI secret, and add the public key as a recipient:

```bash
grep "public key" /path/to/ci-keys.txt
clef recipients add age1ghi... --label "CI deploy key"
```

When a team member leaves, rotate the CI key as well to prevent impersonation.

## Viewing current recipients

```bash
clef recipients list
```

Or open `clef ui` and navigate to Recipients.

## Auditing access

Clef has no access log — access control is key-based. See who has access with `clef recipients list` (or `clef recipients list -e <env>`). For server-side audit logging, use a KMS backend. See [age vs KMS](/guide/quick-start#age-vs-kms-choosing-an-encryption-backend).
