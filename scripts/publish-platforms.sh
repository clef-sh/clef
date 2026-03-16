#!/usr/bin/env bash
# publish-platforms.sh
#
# Publishes every platform/sops-* package to npm.
# Each package already has "publishConfig": { "access": "public", "provenance": true }
# so no extra flags are needed beyond authentication.
#
# Fails gracefully — a failed publish is logged and the script continues.
# Run from an npm-authenticated terminal with id-token access for provenance.
#
# Usage: ./scripts/publish-platforms.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORMS_DIR="$REPO_ROOT/platforms"

# ── Counters ──────────────────────────────────────────────────────────────────
total_published=0
total_skipped=0
total_failed=0

# ── Helpers ───────────────────────────────────────────────────────────────────
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

# ── Discover packages ─────────────────────────────────────────────────────────
echo ""
bold "=== npm publish — platform/sops-* packages ==="
echo ""

packages=()
for dir in "$PLATFORMS_DIR"/sops-*/; do
  [[ -f "$dir/package.json" ]] || continue
  packages+=("$dir")
done

if [[ ${#packages[@]} -eq 0 ]]; then
  yellow "No platform packages found in $PLATFORMS_DIR"
  exit 1
fi

# ── Collect metadata and show plan ───────────────────────────────────────────
bold "Packages to publish:"
echo ""
for dir in "${packages[@]}"; do
  pkg_name=$(node -p "require('$dir/package.json').name")
  pkg_version=$(node -p "require('$dir/package.json').version")
  printf '  • %s@%s  (%s)\n' "$pkg_name" "$pkg_version" "$(basename "$dir")"
done
echo ""

printf 'Type "yes" to confirm: '
read -r confirmation
echo ""

if [[ "$confirmation" != "yes" ]]; then
  yellow "Aborted — nothing was published."
  echo ""
  exit 0
fi

# ── Publish ───────────────────────────────────────────────────────────────────
for dir in "${packages[@]}"; do
  pkg_name=$(node -p "require('$dir/package.json').name")
  pkg_version=$(node -p "require('$dir/package.json').version")
  spec="$pkg_name@$pkg_version"

  bold "── $spec"

  # Check if this exact version is already on the registry
  existing=$(npm view "$spec" version 2>/dev/null || echo "")
  if [[ "$existing" == "$pkg_version" ]]; then
    yellow "  ⚠ Already published — skipping"
    (( total_skipped++ )) || true
    echo ""
    continue
  fi

  if (cd "$dir" && npm publish 2>&1 | sed 's/^/  /'); then
    green "  ✓ Published $spec"
    (( total_published++ )) || true
  else
    red "  ✗ Failed to publish $spec"
    (( total_failed++ )) || true
  fi

  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────────
bold "=== Summary ==="
green "  Published : $total_published package(s)"
yellow "  Skipped   : $total_skipped package(s) (already on registry)"
if [[ $total_failed -gt 0 ]]; then
  red "  Failed    : $total_failed package(s)"
else
  echo  "  Failed    : 0"
fi
echo ""
