# Installation

Clef is distributed as a single npm package. It requires Node.js 18+ and the Mozilla SOPS binary.

## System requirements

| Dependency                              | Minimum version | Required for                  |
| --------------------------------------- | --------------- | ----------------------------- |
| [SOPS](https://github.com/getsops/sops) | 3.8.0           | All encryption and decryption |
| [git](https://git-scm.com/)             | 2.28.0          | All git operations            |
| [Node.js](https://nodejs.org/)          | 18.0.0          | Running Clef                  |

After installation, run `clef doctor` to verify everything is configured correctly.

## Prerequisites

1. **Node.js 18 or later** — [nodejs.org](https://nodejs.org)
2. **Mozilla SOPS**

### Install SOPS

::: code-group

```bash [macOS]
brew install sops
```

```bash [Linux]
# Download the latest binary from GitHub releases
curl -LO https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.amd64
sudo mv sops-v3.9.4.linux.amd64 /usr/local/bin/sops
sudo chmod +x /usr/local/bin/sops
```

```bash [Windows (WSL)]
# Inside your WSL distribution
curl -LO https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.amd64
sudo mv sops-v3.9.4.linux.amd64 /usr/local/bin/sops
sudo chmod +x /usr/local/bin/sops
```

:::

Verify the installation:

```bash
sops --version
```

## Install Clef

```bash
npm install -g @clef-sh/cli
```

## Verify the installation

```bash
clef --version
clef doctor
```

`clef doctor` checks that all required binaries meet version requirements and prints the fix command for any failure. A healthy output looks like:

```
Clef environment check

✓ clef          v0.1.0
✓ sops          v3.9.4    (required >= 3.8.0)
✓ git           v2.43.0   (required >= 2.28.0)
✓ manifest      clef.yaml found
✓ age key       loaded (from OS keychain, label: coral-tiger)
✓ .sops.yaml    found
✓ scanner       .clefignore found (3 rules)

✓ Everything looks good.
```

Missing `manifest` or `.sops.yaml` is expected before `clef init`.

## Troubleshooting

### SOPS not found

1. Verify: `which sops`
2. If installed but not on PATH: `export PATH="/usr/local/bin:$PATH"`
3. Restart your terminal or run `source ~/.zshrc`

### age key not configured

1. Check `.clef/config.yaml` for the key label and storage method.
2. Verify the key file exists: `ls ~/.config/clef/keys/<label>/keys.txt`
3. If needed, re-run `clef init` to generate a new key.

### Node.js version too old

```bash
node --version
nvm install 18 && nvm use 18
```

## Setting up your first repo

```bash
cd my-app
clef init --namespaces database,payments --non-interactive
clef scan  # check for existing plaintext secrets
```

## Next steps

[Next: Quick Start](/guide/quick-start)
