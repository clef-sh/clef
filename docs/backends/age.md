# age (Recommended)

[age](https://age-encryption.org/) is the recommended default encryption backend for Clef. It uses X25519 for key agreement and ChaCha20-Poly1305 for encryption, with a compact ASCII-armored format. It requires no infrastructure, no cloud accounts, and no key servers — just a key stored in your OS keychain.

## When to use age

- You are getting started with Clef and want the simplest setup
- Your team is small to medium (under ~20 people)
- You do not need IAM-based access control
- You want to avoid cloud vendor dependencies
- You are working in development, open source, or early-stage projects

For teams that need IAM integration or centralised key management, consider [AWS KMS](/backends/aws-kms) or [GCP KMS](/backends/gcp-kms).

## Key generation

`clef init` generates an age key pair with a unique per-repo label (e.g., `coral-tiger`) using the `age-encryption` npm package — no age binary required. The private key is stored in your OS keychain (macOS Keychain, Linux libsecret, Windows Credential Manager), falling back to `~/.config/clef/keys/{label}/keys.txt` after explicit confirmation. Each repository gets its own key so compromising one does not expose any other. See [Key Storage](/guide/key-storage) for details.

To find your public key (when using filesystem storage):

```bash
# The label is shown during init and stored in .clef/config.yaml
grep "public key" ~/.config/clef/keys/<label>/keys.txt
```

**Important:** The private key must be kept secret and must never reside inside a git repository.

## Configuring SOPS to find your key

Clef reads the age key path from `.clef/config.yaml` (gitignored) and passes it to SOPS via `SOPS_AGE_KEY_FILE` — no manual configuration needed in most cases. To override the key location (e.g., in CI):

```bash
export CLEF_AGE_KEY_FILE=/path/to/your/keys.txt
```

`CLEF_AGE_KEY_FILE` takes precedence over the path stored in `.clef/config.yaml`.

::: info
Clef uses `CLEF_AGE_KEY` and `CLEF_AGE_KEY_FILE` (not `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`) to avoid silent cross-tool credential leakage. Clef passes the resolved key to the SOPS subprocess directly — it never mutates the parent process environment.
:::

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

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

The private key path and label are stored in `.clef/config.yaml` on each developer's machine (gitignored), not in `clef.yaml`.

## Full working example

From scratch to first encrypted secret:

```bash
# 1. Inside your existing project
cd my-app

# 2. Initialise Clef — generates an age key pair with a unique label
clef init --namespaces database,auth --non-interactive
# Key label: coral-tiger (unique to this repo)
# Private key stored in OS keychain (or ~/.config/clef/keys/coral-tiger/keys.txt)
# Label and storage method stored in .clef/config.yaml (gitignored)

# 3. Set your first secret
clef set database/dev DB_PASSWORD mydevpassword

# 4. Verify it worked
clef get database/dev DB_PASSWORD
# Output: mydevpassword

# 5. Check the encrypted file — plaintext is never on disk
cat secrets/database/dev.enc.yaml
# Output: SOPS-encrypted YAML with age metadata
```

## Multiple recipients for team access

age supports multiple recipients. Each team member generates their own key pair and shares their public key.

### Adding a recipient

1. New member runs `clef init` — key pair generated, stored in their keychain (or `~/.config/clef/keys/{label}/keys.txt`)
2. They share their public key: `grep "public key" ~/.config/clef/keys/<label>/keys.txt`
3. An existing member adds them:

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

New files are encrypted for all listed recipients.

## Security considerations

- **Private keys stay local.** Never committed to git or shared over the network.
- **Public keys are safe to share.** Required by anyone encrypting files the key holder should decrypt.
- **Revoking access.** Remove the key from `.sops.yaml` and re-encrypt with `sops updatekeys`. The former member retains access to old git commits but not current files.

## See also

- [Key Storage](/guide/key-storage) — keychain vs filesystem storage, security tradeoffs
- [Installation](/guide/installation) — installing SOPS
- [clef rotate](/cli/rotate) — adding new recipient keys
- [AWS KMS](/backends/aws-kms) — cloud-based alternative with IAM integration
