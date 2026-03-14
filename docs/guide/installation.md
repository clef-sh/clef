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

Before installing Clef, ensure you have:

1. **Node.js 18 or later** — [download from nodejs.org](https://nodejs.org) or install via your system package manager
2. **Mozilla SOPS** — the encryption engine that Clef wraps

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
```

You should see output like:

```
0.1.0
```

### Run the environment check

```bash
clef doctor
```

This checks that all required binaries (SOPS, git) are installed and meet the minimum version requirements. If any check fails, `clef doctor` prints the exact install or upgrade command to fix it.

A healthy output looks like:

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

If `manifest` or `.sops.yaml` show as missing, that is expected before running `clef init`.

## Troubleshooting

### SOPS not found

If you see an error like `sops: command not found` when running Clef commands:

1. Verify SOPS is installed: `which sops`
2. If installed but not on your PATH, add its location to your shell profile:
   ```bash
   export PATH="/usr/local/bin:$PATH"
   ```
3. Restart your terminal or run `source ~/.zshrc` (or `~/.bashrc`)

### age key not configured

If you see `No decryption key found` errors:

1. Check `.clef/config.yaml` in the repo for the key label and storage method.
2. If using filesystem storage, verify the key file exists: `ls ~/.config/clef/keys/<label>/keys.txt`
3. If needed, re-run `clef init` in the repository to generate a new key and configure the local config.

### Node.js version too old

Clef requires Node.js 18 or later. Check your version:

```bash
node --version
```

If your version is older than v18, upgrade via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 18
nvm use 18
```

## Setting up your first repo

Run `clef init` inside your existing application repository. Clef recommends **co-locating secrets with code** — secrets live alongside the code that uses them.

```bash
cd my-app
clef init --namespaces database,payments --non-interactive
```

This creates a `secrets/` directory containing encrypted files, plus `clef.yaml` and `.sops.yaml` at the project root. See [Recommended approach](/guide/concepts#recommended-approach-co-located-secrets) for why co-locating secrets with code is preferred over a standalone secrets repo.

After `clef init`, run `clef scan` to check whether your repository contains any existing plaintext secrets that should be moved into Clef before you begin.

```bash
clef scan
```

## Next steps

Follow the Quick Start guide to set your first secrets and explore the full workflow.

[Next: Quick Start](/guide/quick-start)
