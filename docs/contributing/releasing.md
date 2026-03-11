# Releasing

Clef uses automated releases powered by Conventional Commits and release-please. The changelog is generated automatically from commit messages — there is no manual changelog editing.

## Commit message format

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): short description

Optional body explaining why, not what.

Closes #123
```

### Types

| Type       | Purpose                              | Triggers release?        |
| ---------- | ------------------------------------ | ------------------------ |
| `feat`     | New feature                          | Yes (minor version bump) |
| `fix`      | Bug fix                              | Yes (patch version bump) |
| `docs`     | Documentation only                   | No                       |
| `chore`    | Tooling, CI, dependencies            | No                       |
| `refactor` | Code change with no behaviour change | No                       |
| `test`     | Adding or updating tests             | No                       |
| `ci`       | CI configuration changes             | No                       |

### Scopes

Common scopes: `core`, `cli`, `ui`, `docs`, `ci`.

```
feat(cli): add --json flag to clef diff
fix(core): handle empty manifest gracefully
docs(guide): update installation instructions for Linux
chore(deps): bump vitepress to 1.2.0
```

### Breaking changes

A commit with `BREAKING CHANGE:` in the footer (or `!` after the type) triggers a major version bump:

```
feat(cli)!: rename --all-envs to --all-environments

BREAKING CHANGE: The --all-envs flag has been renamed to
--all-environments for consistency.
```

## Release process

### 1. Merge PRs to main

All changes land on `main` via squash-and-merge pull requests. Each squash commit must follow Conventional Commits.

### 2. Release-please creates a release PR

[release-please](https://github.com/googleapis/release-please) monitors `main` and automatically creates a release PR when releasable commits (feat, fix) are detected. The release PR:

- Bumps version numbers in `package.json` files
- Generates a changelog entry from commit messages
- Stays open and auto-updates as more commits land

### 3. Merge the release PR

When you are ready to release, merge the release-please PR. This:

- Creates a git tag (e.g., `v0.2.0`)
- Creates a GitHub Release with the generated changelog
- Triggers the publish workflow

### 4. Publish to npm

The CI pipeline publishes the packages to npm:

- `@clef-sh/core`
- `@clef-sh/cli`
- `@clef-sh/ui`

### 5. Update Homebrew tap

The CI pipeline updates the `clef-sh/homebrew-tap` repository with the new version, making `brew upgrade clef-sh/tap/clef-secrets` work automatically.

### 6. Binary builds

The release workflow (`.github/workflows/release.yml`) builds standalone binaries for four platforms:

- macOS arm64 (Apple Silicon)
- macOS amd64 (Intel)
- Linux amd64
- Linux arm64

Each binary is packaged as a `.tar.gz` archive and attached to the GitHub Release. SHA256 checksums are generated and included in `checksums.txt`.

### 7. Update Homebrew tap

After binaries are built and the GitHub Release is created, the workflow dispatches a `repository_dispatch` event to `clef-sh/homebrew-tap`. The tap's own workflow receives the event, updates the formula with the new version and SHA256 hashes, and pushes the change.

Users who installed via `brew install clef-secrets` will receive the update on their next `brew upgrade`.

The dispatch requires the `HOMEBREW_TAP_TOKEN` secret — a fine-grained personal access token scoped to `clef-sh/homebrew-tap` with contents:write permission.

## Versioning

Clef uses [semantic versioning](https://semver.org/):

- **Major** (1.0.0 -> 2.0.0): Breaking changes to CLI arguments, manifest format, or public API
- **Minor** (1.0.0 -> 1.1.0): New features, new commands, new flags
- **Patch** (1.0.0 -> 1.0.1): Bug fixes, performance improvements

All three packages (`core`, `cli`, `ui`) are versioned in lock-step. A release bumps all three to the same version number.

## Documentation versioning

Documentation is versioned in lock-step with the code. When a release introduces breaking changes or new features, the corresponding documentation updates must be included in the same PR as the code change. This is enforced by code review — there is no automated check.

## Manual release (emergency)

In rare cases where the automated process fails:

```bash
# Update versions manually
npm version 0.2.1 --workspaces --no-git-tag-version

# Commit and tag
git add -A
git commit -m "chore: release v0.2.1"
git tag v0.2.1

# Push
git push origin main --tags

# Publish
npm publish --workspaces
```

This should only be used as a last resort. The automated process is strongly preferred.

## Homebrew tap repository

The `clef-sh/homebrew-tap` repository distributes Clef via Homebrew. It must contain:

```
clef-sh/homebrew-tap/
├── Formula/
│   └── clef-secrets.rb
├── .github/
│   └── workflows/
│       └── update-formula.yml
└── README.md
```

### Formula: `Formula/clef-secrets.rb`

The formula is named `clef-secrets` to avoid conflicts with other Homebrew packages. The installed binary is `clef`.

```ruby
class ClefSecrets < Formula
  desc "Git-native secrets management built on Mozilla SOPS"
  homepage "https://clef.sh"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/clef-sh/clef/releases/download/v#{version}/clef-v#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/clef-sh/clef/releases/download/v#{version}/clef-v#{version}-darwin-amd64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/clef-sh/clef/releases/download/v#{version}/clef-v#{version}-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/clef-sh/clef/releases/download/v#{version}/clef-v#{version}-linux-amd64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  def install
    bin.install "clef"
  end

  test do
    assert_match "clef", shell_output("#{bin}/clef --version")
  end
end
```

Users install with:

```bash
brew tap clef-sh/tap
brew install clef-secrets
```

### Tap update workflow: `.github/workflows/update-formula.yml`

Triggered by `repository_dispatch` event type `release`. Receives version and SHA256 values in the payload from the main release workflow. Updates `Formula/clef-secrets.rb` with the new version and hashes, commits, and pushes directly to `main`.

```yaml
name: Update formula
on:
  repository_dispatch:
    types: [release]

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update formula
        run: |
          VERSION="${{ github.event.client_payload.version }}"
          VERSION="${VERSION#v}"  # strip leading v

          sed -i "s/version \".*\"/version \"${VERSION}\"/" Formula/clef-secrets.rb

          # Update SHA256 for each platform
          # darwin-arm64
          sed -i "/darwin-arm64/,/sha256/{s/sha256 \".*\"/sha256 \"${{ github.event.client_payload.darwin_arm64_sha256 }}\"/}" Formula/clef-secrets.rb
          # darwin-amd64
          sed -i "/darwin-amd64/,/sha256/{s/sha256 \".*\"/sha256 \"${{ github.event.client_payload.darwin_amd64_sha256 }}\"/}" Formula/clef-secrets.rb
          # linux-amd64
          sed -i "/linux-amd64/,/sha256/{s/sha256 \".*\"/sha256 \"${{ github.event.client_payload.linux_amd64_sha256 }}\"/}" Formula/clef-secrets.rb
          # linux-arm64
          sed -i "/linux-arm64/,/sha256/{s/sha256 \".*\"/sha256 \"${{ github.event.client_payload.linux_arm64_sha256 }}\"/}" Formula/clef-secrets.rb

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add Formula/clef-secrets.rb
          git commit -m "chore: update clef-secrets to ${VERSION}"
          git push
```

### Required secrets

The release workflow in the main repository requires a `HOMEBREW_TAP_TOKEN` secret. This must be a fine-grained personal access token with:

- **Resource owner:** `clef-sh`
- **Repository access:** `clef-sh/homebrew-tap` only
- **Permissions:** Contents (read and write)

Set this secret in the main repository's settings at **Settings** → **Secrets and variables** → **Actions** → **Repository secrets**.

## Pre-release checklist

Before merging a release-please PR, verify:

- [ ] All CI checks pass on `main`
- [ ] `npm test` passes locally across all workspaces
- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` succeeds for all packages
- [ ] Documentation is up to date for any new features or breaking changes
- [ ] The changelog in the release PR accurately reflects the changes since the last release
- [ ] If this is a major version bump, the migration guide is written and linked from the changelog
- [ ] The `HOMEBREW_TAP_TOKEN` secret is set in the repository settings (check once, not every release)
