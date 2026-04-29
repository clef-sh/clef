# Installation

## Quick install

::: code-group

```bash [macOS / Linux]
curl -fsSL https://clef.sh/install.sh | sh
```

```powershell [Windows]
irm https://clef.sh/install.ps1 | iex
```

```bash [npm]
npm install -g @clef-sh/cli
```

```bash [npx (no install)]
npx @clef-sh/cli --help
```

:::

The installer downloads the Clef binary and sops for your platform, verifies checksums, and places them on your PATH.

### Options

Both installers support the same environment variables:

| Variable           | Default (Unix) | Default (Windows) | Description                      |
| ------------------ | -------------- | ----------------- | -------------------------------- |
| `CLEF_VERSION`     | latest         | latest            | Install a specific version       |
| `CLEF_INSTALL_DIR` | `~/.local/bin` | `$HOME\.clef\bin` | Installation directory           |
| `SOPS_VERSION`     | `3.12.2`        | `3.12.2`           | Override bundled sops version    |
| `SOPS_SKIP`        | `0`            | `0`               | Set to `1` to skip sops download |

::: code-group

```bash [macOS / Linux]
# Install a specific version to a custom directory
CLEF_VERSION=1.2.0 CLEF_INSTALL_DIR=~/.local/bin curl -fsSL https://clef.sh/install.sh | sh
```

```powershell [Windows]
# Install a specific version to a custom directory
$env:CLEF_VERSION = "1.2.0"
$env:CLEF_INSTALL_DIR = "$HOME\.clef\bin"
irm https://clef.sh/install.ps1 | iex
```

:::

## Windows

Windows is a first-class supported platform. The recommended installation method is the PowerShell installer:

```powershell
irm https://clef.sh/install.ps1 | iex
```

This downloads `clef.exe` and `sops.exe`, verifies SHA-256 checksums, installs to `$HOME\.clef\bin`, and adds it to your user PATH automatically. Restart your terminal after installation.

::: tip
The PowerShell installer works in PowerShell 5.1+ (built into Windows 10/11) and PowerShell 7+. It uses `curl.exe` (ships with Windows 10 1803+) when available, falling back to `Invoke-WebRequest`.
:::

### Manual download (Windows)

Download `clef-windows-x64.exe` from [GitHub Releases](https://github.com/clef-sh/clef/releases), rename it to `clef.exe`, and add its directory to your PATH.

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

For Node.js environments (all platforms including Windows), install via npm:

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

::: code-group

```bash [macOS / Linux]
clef --version
clef doctor
```

```powershell [Windows]
clef --version
clef doctor
```

:::

`clef doctor` checks that all required binaries meet version requirements and prints the fix command for any failure. A healthy output looks like:

```
Clef environment check

✓ clef          v0.1.0
✓ sops          v3.12.2    (required >= 3.8.0)
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

::: code-group

```bash [macOS / Linux]
which sops
# If installed but not on PATH:
export PATH="$HOME/.local/bin:$PATH"
# Restart your terminal or run: source ~/.zshrc
```

```powershell [Windows]
Get-Command sops
# If installed but not on PATH, add it:
# $env:Path = "$HOME\.clef\bin;$env:Path"
# Restart your terminal for permanent PATH changes to take effect.
```

:::

### age key not configured

1. Check `.clef/config.yaml` for the key label and storage method.
2. Verify the key file exists: `ls ~/.config/clef/keys/<label>/keys.txt` (or `$HOME\.config\clef\keys\<label>\keys.txt` on Windows).
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

::: code-group

```bash [macOS / Linux]
CLEF_VERSION=1.2.0 curl -fsSL https://clef.sh/install.sh | sh
```

```powershell [Windows]
$env:CLEF_VERSION = "1.2.0"; irm https://clef.sh/install.ps1 | iex
```

:::

### Node.js version too old (npm path)

```bash
node --version
nvm install 18 && nvm use 18
```

### Windows: "running scripts is disabled"

If you see a script execution policy error, run the following in an elevated PowerShell:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then retry the install command.

## Setting up your first repo

```bash
cd my-app
clef init --namespaces database,payments --non-interactive
clef scan  # check for existing plaintext secrets
```

## Next steps

[Next: Quick Start](/guide/quick-start)
