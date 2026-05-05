# PGP

[PGP (Pretty Good Privacy)](https://www.openpgp.org/) is one of the encryption backends supported by SOPS. It uses GPG key pairs for encryption and decryption, and remains in wide use in organizations with established GPG infrastructure.

## When to use PGP

- Your team already has an established GPG key infrastructure
- You need compatibility with existing PGP-based workflows
- You are integrating with systems that require PGP

For new projects, [age](/backends/age) is strongly recommended over PGP. age is simpler, faster, and has a smaller attack surface. PGP support exists primarily for backward compatibility and integration with legacy workflows.

## Prerequisites

- **GPG** (GnuPG) installed on your machine
- A **GPG key pair** generated or imported

### Install GPG

::: code-group

```bash [macOS]
brew install gnupg
```

```bash [Linux]
sudo apt-get install gnupg
# or
sudo yum install gnupg2
```

:::

### Generate a GPG key pair

```bash
gpg --full-generate-key
```

Follow the prompts to create a key. When finished, list your keys to find the fingerprint:

```bash
gpg --list-keys --keyid-format long
```

Output:

```
pub   rsa4096/ABCDEF1234567890 2024-01-15 [SC]
      ABCDEF1234567890ABCDEF1234567890ABCDEF12
uid                 [ultimate] Developer <developer@example.com>
sub   rsa4096/1234567890ABCDEF 2024-01-15 [E]
```

The fingerprint is the 40-character hex string: `ABCDEF1234567890ABCDEF1234567890ABCDEF12`.

## Manifest configuration

In your `clef.yaml`:

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

sops:
  default_backend: pgp
  pgp_fingerprint: "ABCDEF1234567890ABCDEF1234567890ABCDEF12"

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

## Example workflow

```bash
# Initialise Clef with PGP
clef init --namespaces database --backend pgp --non-interactive

# Set a secret
clef set database/dev DB_PASSWORD mydevpassword

# Retrieve the secret
clef get database/dev DB_PASSWORD
```

## Multiple recipients

To grant multiple team members access, list their GPG fingerprints in `.sops.yaml`:

```yaml
creation_rules:
  - path_regex: ".*\\.enc\\.yaml$"
    pgp: >-
      ABCDEF1234567890ABCDEF1234567890ABCDEF12,
      FEDCBA0987654321FEDCBA0987654321FEDCBA09
```

Each team member must import the others' public keys:

```bash
# Export your public key
gpg --armor --export developer@example.com > my-public-key.asc

# Import a teammate's public key
gpg --import teammate-public-key.asc
```

## PGP vs age

|                              | PGP                                             | age                                          |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------- |
| Key generation               | Complex (interactive prompts, key type choices) | Automatic (`clef init` generates a key pair) |
| Key format                   | GPG keyring (binary, opaque)                    | Plain text file                              |
| Key size                     | Variable (RSA 2048-4096, etc.)                  | Fixed (X25519)                               |
| Web of trust                 | Full WoT model                                  | None (by design)                             |
| Key expiration               | Supported                                       | Not applicable                               |
| Ecosystem                    | Large, complex                                  | Minimal, focused                             |
| Recommended for new projects | No                                              | Yes                                          |

## See also

- [age](/backends/age) — recommended modern alternative
- [AWS KMS](/backends/aws-kms) — cloud-managed alternative
- [clef init](/cli/init) — initialising with a PGP backend
