# age (Recommended)

[age](https://age-encryption.org/) is the recommended default encryption backend for Clef. It is a modern, simple file encryption tool designed by Filippo Valsorda. It requires no infrastructure, no cloud accounts, and no key servers — just a key file on disk.

## When to use age

- You are getting started with Clef and want the simplest setup
- Your team is small to medium (under ~20 people)
- You do not need IAM-based access control
- You want to avoid cloud vendor dependencies
- You are working in development, open source, or early-stage projects

For teams that need IAM integration or centralised key management, consider [AWS KMS](/backends/aws-kms) or [GCP KMS](/backends/gcp-kms).

## Prerequisites

- **age** binary installed on your machine
- **age-keygen** for generating key pairs

### Install age

::: code-group

```bash [macOS]
brew install age
```

```bash [Linux]
curl -LO https://github.com/FiloSottile/age/releases/download/v1.2.0/age-v1.2.0-linux-amd64.tar.gz
tar xzf age-v1.2.0-linux-amd64.tar.gz
sudo mv age/age /usr/local/bin/
sudo mv age/age-keygen /usr/local/bin/
```

:::

Verify the installation:

```bash
age --version
```

## Key generation

Generate an age key pair:

```bash
age-keygen -o key.txt
```

Output:

```
Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

The file `key.txt` contains your private key. The public key is printed to the terminal and also included as a comment in the file.

**Important:** The private key must be kept secret. Never commit it to git. Clef's `clef init` command creates a `.sops/.gitignore` that excludes `keys.txt` automatically.

## Configuring SOPS to find your key

SOPS looks for age keys in two locations, checked in order:

1. The `SOPS_AGE_KEY_FILE` environment variable
2. The default path `~/.config/sops/age/keys.txt`

### Option A: Default path (recommended for personal use)

```bash
mkdir -p ~/.config/sops/age
cp key.txt ~/.config/sops/age/keys.txt
```

### Option B: Environment variable (recommended for CI and custom setups)

```bash
export SOPS_AGE_KEY_FILE=/path/to/your/key.txt
```

Add the export to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) so it persists across sessions.

### Option C: Repo-local key file

Clef's `clef init` defaults to `.sops/keys.txt` relative to the repo root and sets `age_key_file` in the manifest. SOPS will use this path when Clef sets the `SOPS_AGE_KEY_FILE` environment variable before calling the `sops` binary.

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
  age_key_file: .sops/keys.txt

file_pattern: "{namespace}/{environment}.enc.yaml"
```

## Full working example

From scratch to first encrypted secret:

```bash
# 1. Create a new project
mkdir my-secrets && cd my-secrets
git init

# 2. Generate an age key
mkdir -p .sops
age-keygen -o .sops/keys.txt
# Note the public key printed to the terminal: age1abc123...

# 3. Configure SOPS to find the key
export SOPS_AGE_KEY_FILE="$(pwd)/.sops/keys.txt"

# 4. Set the age recipient (your public key) for SOPS
export SOPS_AGE_RECIPIENTS="age1abc123..."

# 5. Initialise Clef
clef init --namespaces database,auth --non-interactive

# 6. Set your first secret
clef set database/dev DB_PASSWORD mydevpassword

# 7. Verify it worked
clef get database/dev DB_PASSWORD
# Output: mydevpassword

# 8. Check the encrypted file — plaintext is never on disk
cat database/dev.enc.yaml
# Output: SOPS-encrypted YAML with age metadata
```

## Multiple recipients for team access

age supports multiple recipients. Each team member generates their own key pair and shares their public key. All public keys are listed as recipients so any team member can decrypt.

### Adding a recipient

When a new team member joins:

1. They generate a key: `age-keygen -o ~/age-key.txt`
2. They share their public key (e.g., `age1newmember...`)
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

- [Installation](/guide/installation) — installing SOPS and age
- [clef rotate](/cli/rotate) — adding new recipient keys
- [AWS KMS](/backends/aws-kms) — cloud-based alternative with IAM integration
