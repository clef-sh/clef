# clef-sh/homebrew-tap

Homebrew tap for [Clef](https://clef.sh) — git-native
secrets management built on SOPS.

## Install

```bash
brew install clef-sh/tap/clef-secrets
```

The binary is installed as `clef`.

## Why clef-secrets and not clef?

The formula is named `clef-secrets` because `clef` is
already taken in homebrew-core by an unrelated tool.
The installed binary is still called `clef` — the
formula name and binary name are independent in Homebrew.

## Updating

```bash
brew upgrade clef-sh/tap/clef-secrets
```
