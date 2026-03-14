#!/usr/bin/env bash
# unpublish-all.sh
#
# Unpublishes every published version of every public workspace package.
# Fails gracefully — a missing package or failed unpublish is logged and skipped.
# Run from an npm-authenticated terminal.
#
# Usage: ./scripts/unpublish-all.sh

set -euo pipefail

# ── Packages to process (private packages excluded) ───────────────────────────
PACKAGES=(
  "@clef-sh/core"
  "@clef-sh/cli"
)

# ── Counters ──────────────────────────────────────────────────────────────────
total_unpublished=0
total_failed=0

# ── Helpers ───────────────────────────────────────────────────────────────────
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
bold "=== npm unpublish — all workspace packages ==="
echo ""

# ── Phase 1: discover what would be unpublished ───────────────────────────────
all_specs=()

for pkg in "${PACKAGES[@]}"; do
  versions_json=$(npm view "$pkg" versions --json 2>/dev/null || echo "")

  if [[ -z "$versions_json" || "$versions_json" == "null" ]]; then
    yellow "  ⚠ $pkg — not found on registry, will skip"
    continue
  fi

  versions=()
  while IFS= read -r v; do
    [[ -n "$v" ]] && versions+=("$v")
  done < <(
    echo "$versions_json" \
      | tr -d '[]"' \
      | tr ',' '\n' \
      | tr -d ' \t' \
      | grep -v '^$'
  )

  if [[ ${#versions[@]} -eq 0 ]]; then
    yellow "  ⚠ $pkg — no versions found, will skip"
    continue
  fi

  for version in "${versions[@]}"; do
    all_specs+=("$pkg@$version")
  done
done

if [[ ${#all_specs[@]} -eq 0 ]]; then
  yellow "Nothing to unpublish."
  echo ""
  exit 0
fi

# ── Phase 2: confirmation prompt ──────────────────────────────────────────────
bold "The following ${#all_specs[@]} version(s) will be permanently unpublished:"
echo ""
for spec in "${all_specs[@]}"; do
  printf '  • %s\n' "$spec"
done
echo ""
red "This cannot be undone. npm will block re-publishing the same version."
echo ""
printf 'Type "yes" to confirm: '
read -r confirmation
echo ""

if [[ "$confirmation" != "yes" ]]; then
  yellow "Aborted — nothing was unpublished."
  echo ""
  exit 0
fi

# ── Phase 3: unpublish ────────────────────────────────────────────────────────
for spec in "${all_specs[@]}"; do
  if npm unpublish "$spec" --force 2>/dev/null; then
    green "  ✓ Unpublished $spec"
    (( total_unpublished++ )) || true
  else
    red "  ✗ Failed to unpublish $spec (may already be gone or outside 72-hour window)"
    (( total_failed++ )) || true
  fi
done
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
bold "=== Summary ==="
green "  Unpublished : $total_unpublished version(s)"
if [[ $total_failed -gt 0 ]]; then
  red   "  Failed      : $total_failed version(s)"
else
  echo  "  Failed      : 0"
fi
echo ""
