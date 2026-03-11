# Team Setup

This guide covers adding and removing team members from a Clef-managed repository.

## Adding your first team member

When adding a new developer, you need their age public key. Ask them to run:

```bash
age-keygen -o ~/.clef-key.txt
cat ~/.clef-key.txt | grep "public key"
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

## The CI key

CI systems should have their own age key pair — not a team member's personal key. Generate it in your CI system:

```bash
age-keygen -o ci-key.txt
```

Store the private key as a CI secret. Add the public key as a recipient:

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

Clef does not maintain an access log — SOPS does not provide one. Access control is entirely key-based. If you need an audit trail of who decrypted what, that is outside Clef's scope.

For teams with strict audit requirements, consider using a KMS backend (AWS KMS, GCP KMS) instead of age. Age is the simplest default but KMS backends provide server-side logging of key usage.
