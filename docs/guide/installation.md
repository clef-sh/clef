# Installation

## Quick install

```bash
curl -fsSL https://clef.sh/install.sh | sh
```

The installer downloads the Clef binary and sops for your platform, verifies checksums, and places them in `/usr/local/bin`.

### Options

| Variable           | Default          | Description                      |
| ------------------ | ---------------- | -------------------------------- |
| `CLEF_VERSION`     | latest           | Install a specific version       |
| `CLEF_INSTALL_DIR` | `/usr/local/bin` | Installation directory           |
| `SOPS_VERSION`     | `3.9.4`          | Override bundled sops version    |
| `SOPS_SKIP`        | `0`              | Set to `1` to skip sops download |

```bash
# Install a specific version to a custom directory
CLEF_VERSION=1.2.0 CLEF_INSTALL_DIR=~/.local/bin curl -fsSL https://clef.sh/install.sh | sh
```

## Manual download

Download binaries directly from [GitHub Releases](https://github.com/clef-sh/clef/releases).

::: code-group

```bash [macOS (Apple Silicon)]
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-darwin-arm64
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-darwin-arm64.sha256
shasum -a 256 -c clef-darwin-arm64.sha256
chmod +x clef-darwin-arm64
sudo mv clef-darwin-arm64 /usr/local/bin/clef
```

```bash [macOS (Intel)]
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-darwin-x64
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-darwin-x64.sha256
shasum -a 256 -c clef-darwin-x64.sha256
chmod +x clef-darwin-x64
sudo mv clef-darwin-x64 /usr/local/bin/clef
```

```bash [Linux (x64)]
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-linux-x64
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-linux-x64.sha256
sha256sum -c clef-linux-x64.sha256
chmod +x clef-linux-x64
sudo mv clef-linux-x64 /usr/local/bin/clef
```

```bash [Linux (ARM64)]
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-linux-arm64
curl -fsSLO https://github.com/clef-sh/clef/releases/latest/download/clef-linux-arm64.sha256
sha256sum -c clef-linux-arm64.sha256
chmod +x clef-linux-arm64
sudo mv clef-linux-arm64 /usr/local/bin/clef
```

:::

::: tip
Manual downloads use GitHub's `/latest/download/` URL which redirects to the most recent `@clef-sh/cli@*` release. To pin a version, replace `latest/download` with `download/@clef-sh/cli@X.Y.Z`.
:::

## npm

For Node.js environments, install via npm:

```bash
npm install -g @clef-sh/cli
```

The npm package bundles a platform-specific sops binary automatically via optional dependencies. This is a good choice for CI pipelines that already have Node.js.

## System requirements

| Dependency                              | Minimum version | Notes                                         |
| --------------------------------------- | --------------- | --------------------------------------------- |
| [git](https://git-scm.com/)             | 2.28.0          | Required for all git operations               |
| [SOPS](https://github.com/getsops/sops) | 3.8.0           | Installed automatically by the install script |
| [Node.js](https://nodejs.org/)          | 18.0.0          | Only required for the npm install path        |

## Verify

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

## Windows

Windows is supported via npm or manual download:

```bash
npm install -g @clef-sh/cli
```

Or download `clef-windows-x64.exe` from the [Releases page](https://github.com/clef-sh/clef/releases) and add it to your PATH.

## Troubleshooting

### SOPS not found

1. Verify: `which sops`
2. If installed but not on PATH: `export PATH="/usr/local/bin:$PATH"`
3. Restart your terminal or run `source ~/.zshrc`

### age key not configured

1. Check `.clef/config.yaml` for the key label and storage method.
2. Verify the key file exists: `ls ~/.config/clef/keys/<label>/keys.txt`
3. If needed, re-run `clef init` to generate a new key.

### Install script: permission denied

Run the installer with `sudo`:

```bash
curl -fsSL https://clef.sh/install.sh | sudo sh
```

Or install to a user-writable directory:

```bash
CLEF_INSTALL_DIR=~/.local/bin curl -fsSL https://clef.sh/install.sh | sh
```

### Install script: GitHub API rate limit

Set the version explicitly to skip the API call:

```bash
CLEF_VERSION=1.2.0 curl -fsSL https://clef.sh/install.sh | sh
```

### Node.js version too old (npm path)

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
