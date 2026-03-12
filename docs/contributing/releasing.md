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
- Triggers the release workflow

### 4. Publish to npm

The release workflow (`.github/workflows/release.yml`) publishes:

- `@clef-sh/core` — the core library (public package)
- `@clef-sh/cli` — the CLI (public package, bundles `@clef-sh/ui` via `bundleDependencies`)

`@clef-sh/ui` is not published separately — it is bundled into the CLI package.

The workflow requires the `NPM_TOKEN` secret — an npm access token with publish permissions for the `@clef-sh` scope.

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

# Publish (core first, then cli — skip ui which is private)
npm publish -w packages/core
npm publish -w packages/cli
```

This should only be used as a last resort. The automated process is strongly preferred.

## Pre-release checklist

Before merging a release-please PR, verify:

- [ ] All CI checks pass on `main`
- [ ] `npm test` passes locally across all workspaces
- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` succeeds for all packages
- [ ] Documentation is up to date for any new features or breaking changes
- [ ] The changelog in the release PR accurately reflects the changes since the last release
- [ ] If this is a major version bump, the migration guide is written and linked from the changelog
- [ ] The `NPM_TOKEN` secret is set in the repository settings (check once, not every release)
