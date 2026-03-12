# age (Recommended)

[age](https://age-encryption.org/) is the recommended default encryption backend for Clef. It is a modern, simple file encryption tool designed by Filippo Valsorda. It requires no infrastructure, no cloud accounts, and no key servers — just a key file on disk.

## When to use age

- You are getting started with Clef and want the simplest setup
- Your team is small to medium (under ~20 people)
- You do not need IAM-based access control
- You want to avoid cloud vendor dependencies
- You are working in development, open source, or early-stage projects

For teams that need IAM integration or centralised key management, consider [AWS KMS](/backends/aws-kms) or [GCP KMS](/backends/gcp-kms).

## Key generation

`clef init` automatically generates an age key pair using the `age-encryption` npm package — no age binary is required. The private key is written to `~/.config/clef/keys.txt` by default (outside the repository, outside any git working tree). The path to the key is stored in `.clef/config.yaml` (gitignored via `.clef/.gitignore`). No manual key generation is required.

To find your public key:

```bash
grep "public key" ~/.config/clef/keys.txt
```

**Important:** The private key must be kept secret and must never reside inside a git repository. The default location (`~/.config/clef/keys.txt`) enforces this automatically.

## Configuring SOPS to find your key

Clef reads the age key path from `.clef/config.yaml` (gitignored) and sets `SOPS_AGE_KEY_FILE` automatically before every SOPS subprocess call. In most cases you do not need to configure anything manually — `clef init` handles this during setup.

If you need to override the key location (for example, in CI), set the environment variable directly:

```bash
export SOPS_AGE_KEY_FILE=/path/to/your/keys.txt
```

SOPS checks `SOPS_AGE_KEY_FILE` first, so this override takes precedence over the path stored in `.clef/config.yaml`.

## Manifest configuration

In your `clef.yaml`, configure the age backend:

```yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Staging environment
  - name: production
    description: Production environment
    protected: true

namespaces:
  - name: database
    description: Database credentials
  - name: payments
    description: Payment provider secrets

sops:
  default_backend: age

file_pattern: "{namespace}/{environment}.enc.yaml"
```

The age private key path is **not** stored in `clef.yaml`. It is stored in `.clef/config.yaml` on each developer's machine (gitignored).

## Full working example

From scratch to first encrypted secret:

```bash
# 1. Create a new project
mkdir my-secrets && cd my-secrets
git init

# 2. Initialise Clef — generates an age key pair automatically
clef init --namespaces database,auth --non-interactive
# Private key written to ~/.config/clef/keys.txt (outside the repo)
# Path stored in .clef/config.yaml (gitignored)

# 3. Set your first secret
clef set database/dev DB_PASSWORD mydevpassword

# 4. Verify it worked
clef get database/dev DB_PASSWORD
# Output: mydevpassword

# 5. Check the encrypted file — plaintext is never on disk
cat database/dev.enc.yaml
# Output: SOPS-encrypted YAML with age metadata
```

## Multiple recipients for team access

age supports multiple recipients. Each team member generates their own key pair and shares their public key. All public keys are listed as recipients so any team member can decrypt.

### Adding a recipient

When a new team member joins:

1. They run `clef init` in a clone of the repository — a key pair is generated and stored at `~/.config/clef/keys.txt` on their machine (outside the repo)
2. They share their public key: `grep "public key" ~/.config/clef/keys.txt`
3. An existing team member adds them as a recipient:

```bash
clef rotate database/dev --new-key age1newmember...
clef rotate database/staging --new-key age1newmember...
clef rotate database/production --new-key age1newmember... --confirm
```

4. Commit and push the re-encrypted files

### Configuring multiple recipients in SOPS

In your `.sops.yaml` creation rules, list all public keys:

```yaml
creation_rules:
  - path_regex: ".*\\.enc\\.yaml$"
    age: >-
      age1alice...,
      age1bob...,
      age1carol...
```

New files created by SOPS will be encrypted for all listed recipients.

## Security considerations

- **Private keys stay local.** Each team member's private key lives only on their machine. It is never committed to git or shared over the network.
- **Public keys are safe to share.** The public key is needed by anyone who encrypts files that the key holder should be able to decrypt.
- **Revoking access.** Remove the former member's public key from `.sops.yaml` and re-encrypt all files using `sops updatekeys`. They can still decrypt old git commits but not the current files.

## See also

- [Installation](/guide/installation) — installing SOPS
- [clef rotate](/cli/rotate) — adding new recipient keys
- [AWS KMS](/backends/aws-kms) — cloud-based alternative with IAM integration
