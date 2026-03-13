# Team Setup

This guide covers adding and removing team members from a Clef-managed repository.

## Adding your first team member

When adding a new developer, you need their age public key. Ask them to run `clef init` in a clone of the repository — it automatically generates an age key pair and stores the private key at `~/.config/clef/keys.txt` on their machine (outside the repository, never committed to git). They can find their public key with:

```bash
grep "public key" ~/.config/clef/keys.txt
```

Then add them:

```bash
clef recipients add age1abc... --label "Alice"
```

This re-encrypts all files so Alice can decrypt them. Commit the changes:

```bash
git add clef.yaml && git add -A && git commit -m "add recipient: Alice"
```

Push so Alice can pull the updated encrypted files.

### Scoping recipients to an environment

By default, a recipient can decrypt every environment. To restrict a recipient to a specific environment, use the `-e` flag:

```bash
clef recipients add age1abc... --label "Alice" -e production
```

Alice can now decrypt production files only. She will not be able to decrypt dev or staging. Per-environment recipients are declared in the manifest under each environment's `recipients` array — see [Per-environment recipients](/guide/manifest#per-environment-recipients).

List and remove scoped recipients the same way:

```bash
clef recipients list -e production
clef recipients remove age1abc... -e production
```

## Removing a team member

```bash
clef recipients remove age1def...
```

**This is not enough on its own.** Re-encrypting the files removes future access, but if Bob previously decrypted any values, he may still have them. To complete revocation, rotate the secrets:

```bash
clef rotate database/production
clef rotate payments/production
```

Commit everything and push.

## How multi-user encryption works

Clef uses SOPS with a **data encryption key (DEK)** model. Understanding this is useful when reasoning about access control.

When a file is first encrypted:

1. SOPS generates a random DEK for the file.
2. Every secret value in the file is encrypted once using the DEK (AES-GCM).
3. The DEK itself is encrypted with each recipient's **public key** and stored in the file's `sops:` metadata block.

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

**For N recipients there are N encrypted copies of the DEK, and one encrypted copy of each secret.**

When Alice decrypts the file, her **private key** unwraps her copy of the DEK, which then decrypts the secret values. Bob and Charlie do the same independently with their own copies.

### Adding a recipient

When you run `clef recipients add age1dave...`, the person running the command must already have decryption access. Clef calls `sops rotate --add-age` which:

1. Uses the operator's **private key** to decrypt the DEK.
2. Encrypts the DEK with Dave's **public key**.
3. Appends the new entry to the `sops.age` array in every matrix file.

Dave's private key never leaves his machine. The operator never sees Dave's private key — only Dave's public key is needed.

### Removing a recipient

When you run `clef recipients remove`, SOPS rotates the DEK — a new random DEK is generated, all secrets are re-encrypted with it, and only the remaining recipients get an encrypted copy. This invalidates all old DEK copies, including the removed recipient's.

**Important:** rotation removes future access only. Anyone who already held the DEK (from a prior `clef get` or `git clone` when they were a recipient) retains the ability to decrypt older versions from git history. This is why rotating the secret _values_ themselves is the only way to fully revoke access.

## The CI key

CI systems should have their own age key pair — not a team member's personal key. Generate a dedicated key pair for CI by running `clef init` in a fresh checkout on the CI machine, or generate a standalone key using the age tooling of your choice. The key must be stored outside the repository.

The CI public key can be found from the key file:

```bash
grep "public key" /path/to/ci-keys.txt
```

Store the private key content as a CI secret (e.g., in your CI provider's secrets store) and set `SOPS_AGE_KEY_FILE` to point at the file during the CI run. Add the public key as a recipient:

```bash
clef recipients add age1ghi... --label "CI deploy key"
```

When a team member leaves, rotating the CI key along with team keys ensures the former team member cannot impersonate the CI system.

## Viewing current recipients

```bash
clef recipients list
```

Or open `clef ui` and navigate to Recipients.

## Auditing access

Clef does not maintain an access log — SOPS does not provide one. Access control is entirely key-based. You can see who currently has access with `clef recipients list` (or `clef recipients list -e <env>` for per-environment recipients).

For teams with strict audit requirements, consider using a KMS backend (AWS KMS, GCP KMS) instead of age. KMS backends provide server-side logging of every decryption event (e.g., via AWS CloudTrail). For a comparison, see [age vs KMS](/guide/quick-start#age-vs-kms-choosing-an-encryption-backend).
