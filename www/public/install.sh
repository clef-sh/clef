#!/bin/sh
# Clef installer — https://clef.sh
#
# Usage:
#   curl -fsSL https://clef.sh/install.sh | sh
#
# Environment variables:
#   CLEF_VERSION      — Install a specific version (default: latest)
#   CLEF_INSTALL_DIR  — Installation directory (default: /usr/local/bin)
#   SOPS_VERSION      — Override sops version (default: 3.9.4, from sops-version.json)
#   SOPS_SKIP         — Set to 1 to skip sops download
#
set -eu

CLEF_REPO="clef-sh/clef"
DEFAULT_SOPS_VERSION="3.9.4"  # keep in sync with sops-version.json
DEFAULT_INSTALL_DIR="/usr/local/bin"

# ── Helpers ──────────────────────────────────────────────────────────────────

info() {
  printf '  \033[1;34m>\033[0m %s\n' "$@"
}

success() {
  printf '  \033[1;32m✓\033[0m %s\n' "$@"
}

warn() {
  printf '  \033[1;33m!\033[0m %s\n' "$@" >&2
}

fatal() {
  printf '  \033[1;31m✗\033[0m %s\n' "$@" >&2
  exit 1
}

# Detect downloader: curl preferred, wget fallback
download() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    fatal "Neither curl nor wget found. Install one and retry."
  fi
}

# Download to stdout (for API calls)
download_stdout() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    fatal "Neither curl nor wget found. Install one and retry."
  fi
}

verify_checksum() {
  file="$1"
  expected="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    fatal "No sha256sum or shasum found — cannot verify checksum"
  fi
  if [ "$actual" != "$expected" ]; then
    fatal "Checksum mismatch for $(basename "$file"): expected $expected, got $actual"
  fi
}

# ── Platform detection ───────────────────────────────────────────────────────

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    linux)  ;;
    darwin) ;;
    mingw*|msys*|cygwin*|windows*)
      fatal "Use the PowerShell installer on Windows:
       irm https://clef.sh/install.ps1 | iex
       Or install via npm: npm install -g @clef-sh/cli"
      ;;
    *)
      fatal "Unsupported operating system: $OS"
      ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
      fatal "Unsupported architecture: $ARCH"
      ;;
  esac

  PLATFORM="${OS}-${ARCH}"
}

# Map clef platform to sops asset suffix
sops_asset_suffix() {
  case "$1" in
    linux-x64)   echo "linux.amd64" ;;
    linux-arm64)  echo "linux.arm64" ;;
    darwin-x64)   echo "darwin.amd64" ;;
    darwin-arm64)  echo "darwin.arm64" ;;
    *)
      fatal "No sops binary available for platform: $1"
      ;;
  esac
}

# ── Version resolution ───────────────────────────────────────────────────────

resolve_version() {
  if [ -n "${CLEF_VERSION:-}" ]; then
    info "Using specified version: $CLEF_VERSION"
    VERSION="$CLEF_VERSION"
    return
  fi

  info "Detecting latest CLI version..."
  # Cannot use /latest endpoint — repo has multiple release streams (core, agent, cli).
  # Query the releases API and grep for the first @clef-sh/cli@ tag.
  RELEASES=$(download_stdout "https://api.github.com/repos/$CLEF_REPO/releases") || {
    fatal "Failed to query GitHub API. Set CLEF_VERSION=X.Y.Z to skip version detection."
  }

  VERSION=$(printf '%s' "$RELEASES" | \
    grep -o '"tag_name": "@clef-sh/cli@[^"]*"' | \
    head -1 | \
    sed 's/.*@clef-sh\/cli@//;s/"//')

  if [ -z "$VERSION" ]; then
    # ── PRE-LAUNCH ONLY: remove this block after the first stable release ──
    # Before go-live there are no @clef-sh/cli@ tags, so fall back to the
    # latest beta so the install script works during the pre-launch period.
    # Once a stable release ships this branch will never be reached.
    VERSION=$(printf '%s' "$RELEASES" | \
      grep -o '"tag_name": "v[^"]*-beta\.[^"]*"' | \
      head -1 | \
      sed 's/.*"v//;s/"//')

    if [ -z "$VERSION" ]; then
      fatal "Could not detect latest version. Set CLEF_VERSION=X.Y.Z to install manually."
    fi

    warn "No stable release found — installing latest beta: $VERSION"
    warn "Beta builds are functional but may change without notice."
    # ── END PRE-LAUNCH BLOCK ───────────────────────────────────────────────
  fi

  info "Latest version: $VERSION"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  printf '\n\033[1m  Clef Installer\033[0m\n\n'

  detect_platform
  info "Platform: $PLATFORM"

  resolve_version

  INSTALL_DIR="${CLEF_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
  SOPS_VER="${SOPS_VERSION:-$DEFAULT_SOPS_VERSION}"

  # Stable releases are tagged @clef-sh/cli@X.Y.Z by semantic-release.
  # Beta/alpha releases are tagged vX.Y.Z-{pre}.N by publish-prerelease.yml.
  case "$VERSION" in
    *-beta.*|*-alpha.*) TAG="v${VERSION}" ;;
    *)                  TAG="@clef-sh/cli@${VERSION}" ;;
  esac

  BASE_URL="https://github.com/$CLEF_REPO/releases/download/$TAG"

  CLEF_ASSET="clef-${PLATFORM}"
  CLEF_URL="${BASE_URL}/${CLEF_ASSET}"
  CHECKSUM_URL="${BASE_URL}/${CLEF_ASSET}.sha256"

  # Create a temporary directory for downloads
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  # ── Download clef ────────────────────────────────────────────────────────

  info "Downloading clef ${VERSION} for ${PLATFORM}..."
  download "$CLEF_URL" "$TMPDIR/clef" || fatal "Failed to download clef binary. Check that version $VERSION has a release for $PLATFORM."
  download "$CHECKSUM_URL" "$TMPDIR/clef.sha256" || fatal "Failed to download checksum file."

  # Extract expected hash (format: "<hash>  <filename>")
  EXPECTED_HASH=$(awk '{print $1}' "$TMPDIR/clef.sha256")
  verify_checksum "$TMPDIR/clef" "$EXPECTED_HASH"
  success "Checksum verified"

  # ── Download sops ────────────────────────────────────────────────────────

  if [ "${SOPS_SKIP:-0}" = "1" ]; then
    info "Skipping sops download (SOPS_SKIP=1)"
  else
    SOPS_SUFFIX=$(sops_asset_suffix "$PLATFORM")
    SOPS_ASSET="sops-v${SOPS_VER}.${SOPS_SUFFIX}"
    SOPS_URL="https://github.com/getsops/sops/releases/download/v${SOPS_VER}/${SOPS_ASSET}"
    SOPS_CHECKSUMS_URL="https://github.com/getsops/sops/releases/download/v${SOPS_VER}/sops-v${SOPS_VER}.checksums.txt"

    info "Downloading sops ${SOPS_VER} for ${PLATFORM}..."
    download "$SOPS_URL" "$TMPDIR/sops" || fatal "Failed to download sops binary."

    # Verify sops checksum against the official getsops checksums file
    # (mirrors the approach used in publish-sops.yml)
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL -o "$TMPDIR/sops.checksums.txt" "$SOPS_CHECKSUMS_URL" 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$TMPDIR/sops.checksums.txt" "$SOPS_CHECKSUMS_URL" 2>/dev/null || true
    fi
    if [ -s "$TMPDIR/sops.checksums.txt" ]; then
      SOPS_EXPECTED_HASH=$(grep "  ${SOPS_ASSET}$" "$TMPDIR/sops.checksums.txt" | awk '{print $1}')
      if [ -n "$SOPS_EXPECTED_HASH" ]; then
        verify_checksum "$TMPDIR/sops" "$SOPS_EXPECTED_HASH"
        success "sops checksum verified"
      else
        warn "No checksum entry for ${SOPS_ASSET} — skipping sops verification"
      fi
    else
      warn "Could not download sops checksums — skipping sops verification"
    fi

    success "Downloaded sops"
  fi

  # ── Install ──────────────────────────────────────────────────────────────

  # Check if we can write to INSTALL_DIR
  if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || {
      fatal "$INSTALL_DIR does not exist and could not be created. Try:
       sudo sh -c 'mkdir -p $INSTALL_DIR'
       Or set CLEF_INSTALL_DIR to a writable directory."
    }
  fi

  if [ ! -w "$INSTALL_DIR" ]; then
    fatal "$INSTALL_DIR is not writable. Try:
       curl -fsSL https://clef.sh/install.sh | sudo sh
       Or set CLEF_INSTALL_DIR to a writable directory."
  fi

  chmod +x "$TMPDIR/clef"
  mv "$TMPDIR/clef" "$INSTALL_DIR/clef"
  success "Installed clef to $INSTALL_DIR/clef"

  if [ "${SOPS_SKIP:-0}" != "1" ]; then
    chmod +x "$TMPDIR/sops"
    mv "$TMPDIR/sops" "$INSTALL_DIR/sops"
    success "Installed sops to $INSTALL_DIR/sops"
  fi

  # ── PATH check ───────────────────────────────────────────────────────────

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      warn "$INSTALL_DIR is not on your PATH. Add it:"
      warn "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac

  # ── Done ─────────────────────────────────────────────────────────────────

  printf '\n\033[1;32m  Installation complete!\033[0m\n\n'
  info "Run 'clef --version' to verify"
  info "Run 'clef doctor' to check your environment"
  info "Run 'clef init' to set up a new repo"
  printf '\n'
}

main
