#!/usr/bin/env pwsh
# Clef installer for Windows — https://clef.sh
#
# Usage:
#   irm https://clef.sh/install.ps1 | iex
#
# Environment variables:
#   CLEF_VERSION      — Install a specific version (default: latest)
#   CLEF_INSTALL_DIR  — Installation directory (default: $HOME\.clef\bin)
#   SOPS_VERSION      — Override sops version (default: 3.9.4, from sops-version.json)
#   SOPS_SKIP         — Set to 1 to skip sops download
#

$ErrorActionPreference = "Stop"

$ClefRepo = "clef-sh/clef"
$DefaultSopsVersion = "3.9.4"  # keep in sync with sops-version.json
$DefaultInstallDir = Join-Path $HOME ".clef\bin"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Info {
  param([string]$Message)
  Write-Host "  > " -ForegroundColor Blue -NoNewline
  Write-Host $Message
}

function Write-Success {
  param([string]$Message)
  Write-Host "  √ " -ForegroundColor Green -NoNewline
  Write-Host $Message
}

function Write-Warn {
  param([string]$Message)
  Write-Host "  ! " -ForegroundColor Yellow -NoNewline
  Write-Host $Message
}

function Write-Fatal {
  param([string]$Message)
  Write-Host "  x " -ForegroundColor Red -NoNewline
  Write-Host $Message
  exit 1
}

function Get-Download {
  param(
    [string]$Url,
    [string]$OutFile
  )
  try {
    # Prefer curl.exe (ships with Windows 10 1803+) for progress and speed
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      curl.exe -fsSL -o $OutFile $Url
      if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
    } else {
      $ProgressPreference = "SilentlyContinue"
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
    }
  } catch {
    throw "Failed to download $Url : $_"
  }
}

function Get-DownloadString {
  param([string]$Url)
  try {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      $result = curl.exe -fsSL $Url
      if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
      return ($result -join "`n")
    } else {
      $ProgressPreference = "SilentlyContinue"
      return (Invoke-WebRequest -Uri $Url -UseBasicParsing).Content
    }
  } catch {
    throw "Failed to download $Url : $_"
  }
}

function Test-Checksum {
  param(
    [string]$FilePath,
    [string]$Expected
  )
  $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $Expected.ToLower()) {
    Write-Fatal "Checksum mismatch for $(Split-Path $FilePath -Leaf): expected $Expected, got $actual"
  }
}

# ── Platform detection ───────────────────────────────────────────────────────

function Get-Platform {
  # Detect architecture — read from registry to handle WoW64 correctly (like Bun)
  $arch = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment").PROCESSOR_ARCHITECTURE
  switch ($arch) {
    "AMD64" { return "windows-x64" }
    default { Write-Fatal "Unsupported architecture: $arch. Clef currently supports Windows x64." }
  }
}

# ── Version resolution ───────────────────────────────────────────────────────

function Get-LatestVersion {
  Write-Info "Detecting latest CLI version..."

  try {
    $releases = Get-DownloadString "https://api.github.com/repos/$ClefRepo/releases"
  } catch {
    Write-Fatal "Failed to query GitHub API. Set `$env:CLEF_VERSION to skip version detection."
  }

  # Stable releases are tagged @clef-sh/cli@X.Y.Z
  if ($releases -match '"tag_name":\s*"@clef-sh/cli@([^"]+)"') {
    return $Matches[1]
  }

  Write-Fatal "Could not detect latest version. Set `$env:CLEF_VERSION to install manually."
}

# ── Main ─────────────────────────────────────────────────────────────────────

function Install-Clef {
  Write-Host ""
  Write-Host "  Clef Installer" -ForegroundColor White
  Write-Host ""

  $platform = Get-Platform
  Write-Info "Platform: $platform"

  # Resolve version
  if ($env:CLEF_VERSION) {
    $version = $env:CLEF_VERSION
    Write-Info "Using specified version: $version"
  } else {
    $version = Get-LatestVersion
    Write-Info "Latest version: $version"
  }

  $installDir = if ($env:CLEF_INSTALL_DIR) { $env:CLEF_INSTALL_DIR } else { $DefaultInstallDir }
  $sopsVer = if ($env:SOPS_VERSION) { $env:SOPS_VERSION } else { $DefaultSopsVersion }

  # Stable releases are tagged @clef-sh/cli@X.Y.Z by semantic-release.
  # Beta/alpha releases are tagged vX.Y.Z-{pre}.N by publish-prerelease.yml.
  $tag = if ($version -match '-(?:beta|alpha)\.') { "v$version" } else { "@clef-sh/cli@$version" }

  $baseUrl = "https://github.com/$ClefRepo/releases/download/$tag"

  $clefAsset = "clef-${platform}.exe"
  $clefUrl = "$baseUrl/$clefAsset"
  $checksumUrl = "$baseUrl/${clefAsset}.sha256"

  # Create temp directory
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "clef-install-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
  New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

  try {
    # ── Download clef ──────────────────────────────────────────────────────

    Write-Info "Downloading clef $version for $platform..."
    try {
      Get-Download -Url $clefUrl -OutFile (Join-Path $tmpDir "clef.exe")
    } catch {
      Write-Fatal "Failed to download clef binary. Check that version $version has a release for $platform."
    }

    try {
      Get-Download -Url $checksumUrl -OutFile (Join-Path $tmpDir "clef.sha256")
    } catch {
      Write-Fatal "Failed to download checksum file."
    }

    # Extract expected hash (format: "<hash>  <filename>")
    $checksumLine = Get-Content (Join-Path $tmpDir "clef.sha256") -Raw
    $expectedHash = ($checksumLine -split "\s+")[0]
    Test-Checksum -FilePath (Join-Path $tmpDir "clef.exe") -Expected $expectedHash
    Write-Success "Checksum verified"

    # ── Download sops ──────────────────────────────────────────────────────

    if ($env:SOPS_SKIP -eq "1") {
      Write-Info "Skipping sops download (SOPS_SKIP=1)"
    } else {
      $sopsAsset = "sops-v${sopsVer}.exe"
      $sopsUrl = "https://github.com/getsops/sops/releases/download/v${sopsVer}/${sopsAsset}"
      $sopsChecksumsUrl = "https://github.com/getsops/sops/releases/download/v${sopsVer}/sops-v${sopsVer}.checksums.txt"

      Write-Info "Downloading sops $sopsVer for $platform..."
      try {
        Get-Download -Url $sopsUrl -OutFile (Join-Path $tmpDir "sops.exe")
      } catch {
        Write-Fatal "Failed to download sops binary."
      }

      # Verify sops checksum against the official getsops checksums file
      try {
        Get-Download -Url $sopsChecksumsUrl -OutFile (Join-Path $tmpDir "sops.checksums.txt")
        $checksumLines = Get-Content (Join-Path $tmpDir "sops.checksums.txt")
        $sopsChecksumLine = $checksumLines | Where-Object { $_ -match "  $([regex]::Escape($sopsAsset))$" }
        if ($sopsChecksumLine) {
          $sopsExpectedHash = ($sopsChecksumLine -split "\s+")[0]
          Test-Checksum -FilePath (Join-Path $tmpDir "sops.exe") -Expected $sopsExpectedHash
          Write-Success "sops checksum verified"
        } else {
          Write-Warn "No checksum entry for $sopsAsset -- skipping sops verification"
        }
      } catch {
        Write-Warn "Could not download sops checksums -- skipping sops verification"
      }

      Write-Success "Downloaded sops"
    }

    # ── Install ────────────────────────────────────────────────────────────

    if (-not (Test-Path $installDir)) {
      try {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
      } catch {
        Write-Fatal "$installDir does not exist and could not be created."
      }
    }

    Copy-Item (Join-Path $tmpDir "clef.exe") (Join-Path $installDir "clef.exe") -Force
    Write-Success "Installed clef to $installDir\clef.exe"

    if ($env:SOPS_SKIP -ne "1") {
      Copy-Item (Join-Path $tmpDir "sops.exe") (Join-Path $installDir "sops.exe") -Force
      Write-Success "Installed sops to $installDir\sops.exe"
    }

    # ── PATH registration ──────────────────────────────────────────────────

    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -split ";" -notcontains $installDir) {
      [System.Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")

      # Broadcast WM_SETTINGCHANGE so other processes pick up the new PATH
      if (-not ([System.Management.Automation.PSTypeName]"Win32.NativeMethods").Type) {
        Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
      }
      $HWND_BROADCAST = [IntPtr]0xFFFF
      $WM_SETTINGCHANGE = 0x1A
      $result = [UIntPtr]::Zero
      [Win32.NativeMethods]::SendMessageTimeout(
        $HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero,
        "Environment", 2, 5000, [ref]$result
      ) | Out-Null

      Write-Success "Added $installDir to your PATH"

      # Also update the current session PATH
      $env:Path = "$installDir;$env:Path"
    }

    # ── Done ───────────────────────────────────────────────────────────────

    Write-Host ""
    Write-Host "  Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Info "Run 'clef --version' to verify"
    Write-Info "Run 'clef doctor' to check your environment"
    Write-Info "Run 'clef init' to set up a new repo"
    Write-Host ""
    Write-Info "Restart your terminal if 'clef' is not found."
    Write-Host ""

  } finally {
    # Clean up temp directory
    if (Test-Path $tmpDir) {
      Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Install-Clef
