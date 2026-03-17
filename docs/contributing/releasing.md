# Releasing

Clef uses [Semantic Release](https://semantic-release.gitbook.io/) with
[semantic-release-monorepo](https://github.com/pmowrer/semantic-release-monorepo) to automate
versioning and publishing. The changelog and version bumps are generated entirely from commit
messages — there is no manual changelog editing.

## Branch strategy

Clef uses a three-tier branch model that maps directly to release channels:

| Branch    | Channel | Registry              | Dist-tag | Access     |
| --------- | ------- | --------------------- | -------- | ---------- |
| `dev`     | Alpha   | GitHub Packages       | `alpha`  | Restricted |
| `staging` | Beta    | GitHub Packages → npm | `beta`   | Public     |
| `main`    | Stable  | npm                   | `latest` | Public     |

### dev → alpha

Every push to `dev` triggers an automatic publish to GitHub Packages under the `alpha` dist-tag. Alpha packages are **restricted** (organization-only) — not publicly installable from npm. The base version is sourced from `main`, keeping alpha stamps anchored to the next stable release:

```
main@0.1.0  →  alpha: 0.1.0-alpha.<run_number>
```

Alpha packages are for internal development only — not promoted to npm.

### staging → beta

Every push to `staging` publishes to GitHub Packages (public) under the `beta` dist-tag and creates a draft GitHub pre-release. Same base-from-main versioning as alpha:

```
main@0.1.0  →  beta: 0.1.0-beta.<run_number>
```

Beta packages are not published to npm automatically — promotion requires a manual workflow dispatch (see [Promoting beta to npm](#promoting-beta-to-npm)).

### main → stable

Every push to `main` runs Semantic Release. If there are releasable commits since the last release,
both `@clef-sh/core` and `@clef-sh/cli` are published to npm under the `latest` dist-tag.

## Commit message format

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/)
specification. Semantic Release reads commit messages to decide whether to release and what version
to produce.

```
type(scope): short description

Optional body explaining why, not what.

Closes #123
```

### Types and version rules

| Type       | Purpose                              | Triggers release? | Version bump |
| ---------- | ------------------------------------ | ----------------- | ------------ |
| `feat`     | New feature                          | Yes               | Patch        |
| `fix`      | Bug fix                              | Yes               | Patch        |
| `perf`     | Performance improvement              | Yes               | Patch        |
| `feat!`    | Breaking feature                     | Yes               | Minor        |
| `fix!`     | Breaking fix                         | Yes               | Minor        |
| `docs`     | Documentation only                   | No                | —            |
| `chore`    | Tooling, CI, dependencies            | No                | —            |
| `refactor` | Code change with no behaviour change | No                | —            |
| `test`     | Adding or updating tests             | No                | —            |
| `ci`       | CI configuration changes             | No                | —            |

::: tip Breaking changes bump minor, not major
While Clef is pre-1.0, breaking changes are mapped to a **minor** version bump. Once Clef reaches
1.0, the release rules will be updated so breaking changes trigger a major bump.
:::

### Marking a breaking change

Use `!` after the type, or add a `BREAKING CHANGE:` footer:

```
feat(cli)!: rename --all-envs to --all-environments

BREAKING CHANGE: The --all-envs flag has been renamed to
--all-environments for consistency.
```

### Common scopes

`core`, `cli`, `ui`, `docs`, `ci`

## How releases work on main

Fully automated — no manual steps needed.

### 1. Merge PRs to main

All changes land on `main` via pull requests. Each PR title (squash commit message) must follow Conventional Commits.

### 2. Semantic Release runs automatically

On every push to `main`, the release workflow (`.github/workflows/release.yml`):

1. Checks out `main` with full git history
2. Runs `npm ci` and `npm run build`
3. Runs `npm test`
4. Runs Semantic Release for `@clef-sh/core`
5. If core published a new version, bumps the `@clef-sh/core` devDependency in `packages/cli/package.json` and commits with `[skip ci]`
6. Runs Semantic Release for `@clef-sh/cli`

### 3. What Semantic Release does per package

For each package that has releasable commits:

1. Analyzes commits since the last release tag
2. Determines the next version (patch or minor)
3. Updates `package.json` and `CHANGELOG.md`
4. Publishes to npm with `--provenance` (OIDC attestation — no long-lived npm token)
5. Creates a git tag (e.g. `@clef-sh/core@0.2.0`)
6. Creates a GitHub Release with generated notes
7. Commits the version bump back to `main`

### Independent versioning

`@clef-sh/core` and `@clef-sh/cli` release independently — core at `0.2.0` and CLI at `0.3.1` is valid. `@clef-sh/ui` is private and bundled into the CLI package, never published separately.

## Promoting beta to npm

Beta versions land on GitHub Packages automatically. A manual workflow dispatch is the deliberate gate before publishing to npm.

### Steps

1. Go to **Actions → Publish Beta to npm** in the GitHub repository
2. Click **Run workflow**
3. Enter the beta version to promote (e.g. `0.1.0-beta.7`)
4. Optionally set the ref (defaults to `staging`)
5. Click **Run workflow**

Validates the version format, rebuilds from the specified ref, publishes to npm under `beta` with OIDC provenance, tags the commit as `npm-beta/vX.Y.Z-beta.N`, and updates the GitHub pre-release notes.

### Installing a beta

```bash
npm install @clef-sh/cli@beta
```

## Authentication

All npm publishes use **GitHub Actions OIDC** — no long-lived npm tokens. The `id-token: write` permission is granted to release workflows; npm verifies the OIDC token directly and generates cryptographic provenance attestations for every package.

## Sops binary packages

The `@clef-sh/sops-{platform}-{arch}` packages are **versioned by sops version** (e.g. `3.9.4`), not by Clef version. Published via the `publish-sops.yml` workflow (manual dispatch), outside the Semantic Release cycle. See [`sops-version.json`](https://github.com/clef-sh/clef/blob/main/sops-version.json) for the pinned sops version and checksums.

## Pre-release checklist

Before merging a PR that should trigger a release on `main`, verify:

- [ ] All CI checks pass
- [ ] `npm test` passes locally across all workspaces
- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` succeeds for all packages
- [ ] Commit message follows Conventional Commits and accurately describes the change
- [ ] Documentation is updated for any new features or behaviour changes
- [ ] If this introduces a breaking change (`!`), a migration path is documented

## Manual release (emergency only)

Only use this when the automated pipeline fails and a release must go out immediately:

```bash
# Update versions manually
npm version 0.2.1 -w packages/core --no-git-tag-version
npm version 0.2.1 -w packages/cli  --no-git-tag-version

# Commit and tag
git add packages/core/package.json packages/cli/package.json
git commit -m "chore(release): v0.2.1"
git tag @clef-sh/core@0.2.1
git tag @clef-sh/cli@0.2.1

# Push
git push origin main --tags

# Publish with provenance (core first, then cli)
npm publish --provenance --access public -w packages/core
npm publish --provenance --access public -w packages/cli
```

This bypasses Semantic Release — use only as a last resort.
