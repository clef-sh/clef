# Clef — Master Project Brief

> **clef.sh** | CLI command: `clef` | GitHub: github.com/clef-sh/clef
> Git-native config and secrets management built on Mozilla SOPS

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Core Concepts](#2-core-concepts)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Architecture](#5-architecture)
6. [CLI Command Reference](#6-cli-command-reference)
7. [MVP Scope](#7-mvp-scope)
8. [Key Technical Decisions](#8-key-technical-decisions)
9. [UI Design — Walkthrough](#9-ui-design--walkthrough)
10. [Testing Requirements](#10-testing-requirements)
11. [Code Formatting](#11-code-formatting)
12. [Branch Strategy](#12-branch-strategy)
13. [Contributing](#13-contributing)
14. [Static Site — clef.sh](#14-static-site--clefsh)
15. [Developer Documentation — VitePress](#15-developer-documentation--vitepress)

---

## 1. Product Vision

A local-first, open source tool that brings a structured UI and workflow layer on top of Mozilla SOPS — making encrypted, git-tracked secrets and config management ergonomic for teams without requiring any server infrastructure.

**Design philosophy:** Git is the source of truth. SOPS is the encryption engine. The tool is the interface.

### Competitive Position

| Tool                | Approach                        | Gap Clef fills                       |
| ------------------- | ------------------------------- | ------------------------------------ |
| HashiCorp Vault     | Centralized server, complex ops | Heavy; needs infra; not git-native   |
| Doppler / Infisical | SaaS-first                      | Vendor lock-in, not truly serverless |
| AWS Secrets Manager | Cloud-native                    | Tied to AWS                          |
| SOPS (raw)          | CLI only                        | No UI, no workflow, no schema        |
| git-crypt           | File-level encryption           | Less granular than SOPS              |

Clef's defensible position is **"truly git-native, no server required"**. Infisical is the closest competitor — Clef's differentiation is that it requires no backend database whatsoever.

---

## 2. Core Concepts

### 2.1 The Two-Axis Model

Every secret or config value lives at the intersection of two axes:

| Axis            | Answers                  | Example values                          |
| --------------- | ------------------------ | --------------------------------------- |
| **Namespace**   | What part of the system? | `database`, `auth`, `payments`, `email` |
| **Environment** | Which deployment?        | `dev`, `staging`, `production`          |

This produces a matrix where each cell is a discrete encrypted file:

```
                  dev               staging           production
database    secrets.enc.yaml   secrets.enc.yaml   secrets.enc.yaml
auth        secrets.enc.yaml   secrets.enc.yaml   secrets.enc.yaml
payments    secrets.enc.yaml   secrets.enc.yaml   secrets.enc.yaml
```

### 2.2 The Manifest

A single `clef.yaml` at the repo root declares the full structure and is the backbone of the tool:

```yaml
# clef.yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Pre-production
  - name: production
    description: Live system
    protected: true # Requires explicit confirmation for writes

namespaces:
  - name: database
    description: Database connection config
    schema: schemas/database.yaml
  - name: auth
    description: Auth and identity secrets
  - name: payments
    description: Payment provider credentials
    owners: [payments-team]

sops:
  default_backend: age
  age_key_file: .sops/keys.txt

file_pattern: "{namespace}/{environment}.enc.yaml"
```

### 2.3 Schema File Format

```yaml
# schemas/database.yaml
keys:
  DATABASE_URL:
    type: string
    required: true
    pattern: "^postgres://"
    description: PostgreSQL connection string
  DATABASE_POOL_SIZE:
    type: integer
    required: false
    default: 10
  DATABASE_SSL:
    type: boolean
    required: true
```

---

## 3. Functional Requirements

### 3.1 Manifest & Scaffold

- **FR-01** Parse and validate `clef.yaml` on startup
- **FR-02** Scaffold the full namespace × environment file matrix from the manifest (`init` command)
- **FR-03** Detect missing cells in the matrix and warn
- **FR-04** Support adding new namespaces or environments and scaffolding the new files

### 3.2 Read & Edit

- **FR-05** Decrypt and display all values in a namespace/environment file via UI
- **FR-06** Edit individual values in-UI and re-encrypt on save (never write plaintext to disk)
- **FR-07** Add new keys to a file
- **FR-08** Delete keys from a file
- **FR-09** Support YAML and JSON file formats

### 3.3 Cross-Matrix Operations

- **FR-10** Side-by-side diff view across environments for a given namespace
- **FR-11** Detect missing keys — keys present in one environment but absent in another
- **FR-12** Bulk-add a key across all environments (with per-environment value input)
- **FR-13** Bulk-delete a key across all environments
- **FR-14** Copy a key's value from one environment to another

### 3.4 Schema & Validation

- **FR-15** Define a schema per namespace: required keys, types, optional regex validation
- **FR-16** Validate files against schema on open and on save
- **FR-17** Report missing required keys and type mismatches
- **FR-18** Flag undeclared keys as warnings

### 3.5 Git Integration

- **FR-19** Stage and commit changes directly from the UI with a commit message
- **FR-20** Show git diff of pending changes before commit (encrypted diff, not plaintext)
- **FR-21** Display git log for a file (who changed it, when, commit message)
- **FR-22** Pre-commit hook installer — detect and block accidental plaintext commits

### 3.6 SOPS Backend Support

- **FR-23** Support `age` key backend (recommended default, zero-infra)
- **FR-24** Support AWS KMS
- **FR-25** Support GCP KMS
- **FR-26** Support PGP
- **FR-27** Display which key/backend was used to encrypt each file
- **FR-28** Re-encryption support (rotate to a new key)

### 3.7 Access & Safety

- **FR-29** `production` (or any `protected: true` environment) requires explicit confirmation before writes
- **FR-30** Never log or display plaintext values in terminal output or logs
- **FR-31** Clear decrypted values from memory on close/timeout
- **FR-32** Pre-commit hook that scans staged files for SOPS metadata — blocks commits on files missing encryption markers

---

## 4. Non-Functional Requirements

| ID         | Requirement                                                    |
| ---------- | -------------------------------------------------------------- |
| **NFR-01** | No mandatory server — runs entirely local                      |
| **NFR-02** | No database — git repo is the only persistence layer           |
| **NFR-03** | Open source (MIT or Apache 2.0 license)                        |
| **NFR-04** | SOPS binary is the only external runtime dependency            |
| **NFR-05** | Works on macOS, Linux, Windows (WSL)                           |
| **NFR-06** | Plaintext values must never be written to disk at any point    |
| **NFR-07** | All file I/O piped through SOPS — no custom crypto             |
| **NFR-08** | Startup time under 2s for repos with up to 100 encrypted files |

---

## 5. Architecture

### 5.1 High-Level Overview

```
┌─────────────────────────────────────────────────────┐
│                    User Interfaces                   │
│                                                      │
│   ┌──────────────┐          ┌──────────────────┐    │
│   │   CLI Layer  │          │  Local Web UI     │    │
│   │  (commands)  │          │  (browser app)    │    │
│   └──────┬───────┘          └────────┬─────────┘    │
└──────────┼──────────────────────────┼───────────────┘
           │                          │
           ▼                          ▼
┌─────────────────────────────────────────────────────┐
│                    Core Library                      │
│                                                      │
│  ManifestParser  │  MatrixManager  │  SchemaValidator│
│  DiffEngine      │  BulkOps        │  GitIntegration │
└──────────────────────────┬──────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ SOPS Layer │  │  Git Layer │  │  FS Layer  │
    │ (encrypt/  │  │ (log/diff/ │  │ (file I/O) │
    │  decrypt)  │  │  commit)   │  │            │
    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ SOPS bin │    │ git bin  │    │ Repo FS  │
    └──────────┘    └──────────┘    └──────────┘
```

### 5.2 Layer Responsibilities

**CLI Layer** — thin entry point for all commands, delegates everything to core library. Commands: `init`, `edit`, `get`, `set`, `delete`, `diff`, `lint`, `rotate`, `hooks`.

**Local Web UI** — browser app served by a local-only HTTP server bound to `127.0.0.1`. Communicates with core library via IPC or localhost REST. React frontend, no external network calls. Spawned by `clef ui`.

**Core Library** — the heart of the system:

| Module            | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `ManifestParser`  | Load, validate, and watch `clef.yaml`                        |
| `MatrixManager`   | Resolve file paths, detect missing cells, scaffold new files |
| `SchemaValidator` | Validate decrypted content against namespace schemas         |
| `DiffEngine`      | Cross-environment key comparison, missing key detection      |
| `BulkOps`         | Multi-file write operations with transactional safety        |
| `GitIntegration`  | Commit, log, diff, pre-commit hook management                |

**SOPS Layer** — thin subprocess wrapper around the `sops` binary. Decrypted values exist only in memory, never written to temp files.

**Git Layer** — thin wrapper around the `git` binary. Read: log, diff, status. Write: stage, commit. Never auto-pushes.

### 5.3 Repo Structure (Consumer)

```
your-repo/
├── clef.yaml
├── .sops/
│   ├── .gitignore
│   └── keys.txt
├── schemas/
│   ├── database.yaml
│   └── auth.yaml
├── database/
│   ├── dev.enc.yaml
│   ├── staging.enc.yaml
│   └── production.enc.yaml
├── auth/
│   ├── dev.enc.yaml
│   ├── staging.enc.yaml
│   └── production.enc.yaml
└── payments/
    ├── dev.enc.yaml
    ├── staging.enc.yaml
    └── production.enc.yaml
```

---

## 6. CLI Command Reference

```bash
clef init                                          # Initialise a new clef repo
clef ui                                            # Open the local web UI
clef get payments/production STRIPE_SECRET_KEY     # Get a single value
clef set payments/staging STRIPE_SECRET_KEY sk_x   # Set a value
clef delete payments STRIPE_LEGACY_KEY --all-envs  # Delete across all envs
clef diff auth dev production                      # Diff two environments
clef lint                                          # Full repo health check
clef rotate payments/production --new-key age1xxx  # Rotate encryption key
clef hooks install                                 # Install pre-commit hook
```

---

## 7. MVP Scope

| #   | Feature                                       | Priority |
| --- | --------------------------------------------- | -------- |
| 1   | Manifest parsing + file matrix scaffold       | Must     |
| 2   | CLI: get / set / delete (single file)         | Must     |
| 3   | CLI: diff (two environments)                  | Must     |
| 4   | CLI: lint (missing keys, matrix completeness) | Must     |
| 5   | Pre-commit hook installer                     | Must     |
| 6   | Local Web UI: matrix browser + edit           | Should   |
| 7   | Schema validation                             | Should   |
| 8   | Bulk cross-environment set                    | Could    |
| 9   | Key rotation helper                           | Could    |
| 10  | Git log view in UI                            | Could    |

---

## 8. Key Technical Decisions

| Decision                   | Choice                        | Rationale                                                               |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Implementation language    | Go or TypeScript/Node         | Go: single binary, easy distribution. Node: faster UI integration. TBD. |
| UI framework               | React                         | Proven, wide contributor base for OSS                                   |
| SOPS interaction           | Subprocess (sops binary)      | Avoid re-implementing crypto; SOPS binary is the trust anchor           |
| Local UI transport         | Unix socket or localhost:port | Unix socket preferred; port as fallback on Windows                      |
| Config format              | YAML                          | Consistent with SOPS conventions                                        |
| Encryption backend default | age                           | Zero-infra, modern, simpler than PGP                                    |

---

## 9. UI Design — Walkthrough

### Design Philosophy

The Clef UI is a local-only browser app served at `127.0.0.1` when you run `clef ui`. Three constraints drive every design decision:

- **Safety first** — secrets must never be exposed accidentally. Masks, confirmations, and production warnings are core to the product, not optional chrome.
- **Git is the source of truth** — the UI surfaces git state at every opportunity and should feel like a visual layer over the repo.
- **CLI and UI are equal citizens** — every UI action has a `clef` CLI equivalent; where possible the UI shows that command inline.

### Global Layout

```
┌─────────────────┬──────────────────────────────────────┐
│                 │  Top Bar                             │
│   Sidebar       ├──────────────────────────────────────┤
│   (220px)       │                                      │
│                 │  Screen Content                      │
│                 │                                      │
└─────────────────┴──────────────────────────────────────┘
```

**Sidebar** contains: the `clef` logotype with repo name and git branch, primary navigation (Matrix, Diff, Lint), namespace list with issue badges, and a status footer showing uncommitted file count and key backend status. The footer is always visible — developers should never hunt for whether their key is loaded.

**Color conventions are semantic, not decorative:**

| Color            | Meaning                                           |
| ---------------- | ------------------------------------------------- |
| Amber `#F0A500`  | Active selection, dirty/edited state, primary CTA |
| Green `#22C55E`  | Healthy, passing, confirmed                       |
| Red `#EF4444`    | Error, missing, production environment            |
| Yellow `#FBBF24` | Warning, staging environment                      |
| Blue `#60A5FA`   | Info, type annotations, dev environment           |
| Purple `#A78BFA` | SOPS-specific indicators                          |

**Environment badges** — `DEV` in green, `STG` in amber, `PRD` in red — appear on every environment reference throughout the UI. Production is always red.

---

### Screen 1 — Matrix View (Home)

The home screen. Answers _"is my repo healthy?"_ in one glance.

**Summary pills** at the top give an at-a-glance count across the full matrix: `13 healthy`, `2 missing keys`, `1 schema warning`.

**The matrix table** is a grid — namespaces as rows, environments as columns. Each cell shows a status dot with glow, key count, last-modified timestamp, and an inline problem badge where relevant (`-1 missing`, `1 warn`). The entire row is clickable and navigates to the namespace editor.

The matrix makes two problems visible that are otherwise invisible with raw SOPS: missing cells (a namespace/environment that should exist but doesn't) and key drift (a cell with fewer keys than its siblings, meaning something was added to dev but never promoted).

---

### Screen 2 — Namespace Editor

Where developers spend most of their time. The editing surface for a single namespace.

**Environment tabs** — one per environment. The active tab uses the environment's color for its bottom border. The right side of the tab strip always shows SOPS metadata: `encrypted with age · 2 recipients`.

**Production warning banner** — a persistent red banner when the production tab is active. Cannot be dismissed. Makes editing production feel meaningfully different without blocking the workflow.

**The key table** has four columns: Key, Value, Type, actions.

- Required keys are prefixed with an amber `*`
- All values are **masked by default** (bullet characters) — safe for screen sharing
- Each row has an eye icon that reveals and makes the value editable for that row only
- Editing a row immediately marks it dirty: amber left border, amber dot on the key name
- When any row is dirty, a `Commit changes` button appears in the top bar

**Schema validation summary** is always visible below the key table. Shows pass/fail state inline; links to the lint view for detail on failures.

---

### Screen 3 — Diff View

Answers: _"what is different between two environments for a given namespace?"_

**Controls** — namespace selector, Environment A, and Environment B (default: `dev → production`).

**Summary strip** — `3 changed`, `1 missing in dev`, `1 identical` as monospace badges.

**The diff table** — four columns: Key, Env A value, Env B value, Status.

- Changed rows: Env A value in amber, Env B value in blue
- Missing rows: absent side shows `— not set —` in italic; status badge reads `Missing in dev` in red
- Identical rows: hidden by default, shown via a checkbox

**Inline fix hint** — when missing keys exist, a contextual panel below the table shows the exact `clef set` command to fix the issue. This is a core UX pattern: the UI always tells you what to type.

---

### Screen 4 — Lint View

The full-repo health report. Modelled on ESLint — scan everything, report clearly, tell you how to fix it.

**Filter bar** — severity filters (All, Errors, Warnings, Info) on the left; category filters (Matrix, Schema, SOPS) on the right.

**Issue groups** — errors first, then warnings, then info. Each group has a colored header with count badge.

**Each issue card** contains: category badge, clickable file reference (navigates to editor), optional key reference, plain-English message, fix command with copy button, and a dismiss button.

**Severity semantics:**

| Severity | Blocks commit? | Examples                                                         |
| -------- | -------------- | ---------------------------------------------------------------- |
| Error    | Yes            | Missing required key, missing matrix file, invalid SOPS metadata |
| Warning  | No             | Undeclared key, value exceeds schema max, stale encryption       |
| Info     | No             | Key with no schema definition, single-recipient encryption       |

**All-clear state** — when all issues are resolved, a large green checkmark appears, the `Commit changes` button activates, and the experience feels like passing a test suite.

---

### Key Interaction Flows

**Promoting a secret from dev to production:**
Open Diff → select namespace, set `dev → production` → identify missing keys → copy `clef set` command from fix hint → return to diff, confirm resolved → run Lint → commit.

**Adding a new key to all environments:**
Open Editor for namespace → `+ Add key` on dev tab → switch to staging, repeat → switch to production (banner visible) → add key, confirm commit prompt → return to Matrix.

**Responding to a lint error after a teammate's commit:**
Open Lint (red badge on sidebar) → filter by Error → click file reference, jumps to editor → fix value, commit → re-run lint, error clears.

---

### What Is Not In The Mockup

Specified in requirements but not yet designed:

- Git log view (per-file commit history, panel below key table)
- Key rotation wizard (`clef rotate` guided flow)
- Commit message input (modal before `Commit changes` writes to git)
- Pre-commit hook installer (settings/onboarding surface)
- Onboarding / `clef init` first-run flow
- Multi-file bulk set (`Sync missing keys →` flow in diff view)

---

## 10. Testing Requirements

### Philosophy

Every meaningful behaviour in Clef must be covered by a unit test. Tests must run entirely offline — no real KMS providers, no live git remotes, no actual SOPS binaries in CI.

### Coverage Requirements

| Layer                      | Requirement                                               |
| -------------------------- | --------------------------------------------------------- |
| Core library (all modules) | 100% line coverage                                        |
| CLI commands               | All command paths including error branches                |
| SOPS layer                 | Full mock — never call real `sops` binary in unit tests   |
| Git layer                  | Full mock — never call real `git` binary in unit tests    |
| Schema validator           | All rule types, pass and fail cases                       |
| ManifestParser             | Valid and invalid manifests, missing fields, unknown keys |

### Test Structure

Tests live alongside source files (`*.test.ts` or `*_test.go`). Integration tests live in `integration/` and are excluded from the default run.

```bash
clef-dev test               # Unit tests only (default)
clef-dev test --coverage    # With coverage report
clef-dev test --integration # Requires sops + age installed
clef-dev test --watch       # Watch mode
```

### CI Gate

Before any PR can merge: all unit tests pass, coverage thresholds met (no regressions), no skipped tests without an issue number in the skip reason.

---

## 11. Code Formatting

Formatting is enforced automatically. No formatting debates in code review.

**TypeScript/JavaScript:** Prettier with `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

**Go:** `gofmt` + `goimports`. Standard Go formatting, no additional config.

**YAML:** Prettier with YAML plugin. **Markdown:** Prettier with `proseWrap: "always"`, `printWidth: 80`.

**Linting:** ESLint with `@typescript-eslint` for TypeScript. `golangci-lint` for Go. No `any` types without a suppression comment referencing a tracking issue.

**Enforcement:** Pre-commit hook (staged files only, installed by `clef-dev setup`) and a CI `format-check` job on every PR.

```bash
clef-dev format           # Format all files
clef-dev format --check   # Check without writing (CI)
clef-dev lint             # Lint all files
```

The repo ships `.vscode/settings.json` and `.vscode/extensions.json` configuring format-on-save.

---

## 12. Branch Strategy

Trunk-based development. `main` is always releasable.

### Branch Naming

```
feat/short-description     ← new features
fix/short-description      ← bug fixes
docs/short-description     ← documentation only
chore/short-description    ← tooling, CI, deps
refactor/short-description ← no behaviour change
release/v1.2.0             ← release prep, short-lived
```

### `main` Branch Rules

Fully protected. No direct pushes for any contributor including maintainers. Every PR must: pass CI, have one approving maintainer review, have no unresolved comments, and be up to date with `main` before merging.

### Commit Messages — Conventional Commits

```
type(scope): short description

Optional body explaining why, not what.

Closes #123
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`. Enforced in CI with `commitlint`.

### Merging

Squash and merge only. Merge commits and rebase merges are disabled. The squash commit message must follow Conventional Commits.

### Releases

Tagged on `main` using semantic versioning (`v1.2.3`). Changelog generated automatically from Conventional Commits via `release-please` or `semantic-release`. No hand-written changelogs.

---

## 13. Contributing

### Getting Started

```bash
git clone https://github.com/clef-sh/clef.git
cd clef
npm install             # or: go mod tidy
clef-dev setup          # installs pre-commit hooks, checks for sops + age + git
clef-dev test           # verify your setup
clef-dev ui:dev         # start UI in dev mode
```

`clef-dev setup` warns (not fails) if `sops` or `age` are not installed. Unit tests do not require them.

### Before Opening a PR

- [ ] Tests written for all new behaviour
- [ ] All tests pass (`clef-dev test`)
- [ ] Code formatted (`clef-dev format`)
- [ ] Lint passes (`clef-dev lint`)
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains what and why
- [ ] New public API or CLI behaviour is documented

### Pull Request Guidelines

Keep PRs small and focused. Link every PR to an open issue. Write a useful description explaining the approach. Respond to review comments promptly — PRs stale for two weeks without activity may be closed.

### Reporting Issues

**Bug reports** require: Clef version, OS, SOPS backend, triggering command, full error output, expected vs actual behaviour.

**Feature requests** should describe the use case, not the implementation.

### Security Vulnerabilities

Do not open a public GitHub issue. Email `security@clef.sh`. We acknowledge within 48 hours and resolve critical issues within 14 days.

### Code of Conduct

Contributor Covenant. Reports to `conduct@clef.sh`.

---

## 14. Static Site — clef.sh

Marketing and landing site. Lives in `www/` in the monorepo. Deployed to `clef.sh`.

**Purpose:** Answer three questions in under 30 seconds — what is this? Why should I care? How do I start?

### Tech Stack

| Concern    | Choice                                    |
| ---------- | ----------------------------------------- |
| Framework  | Astro — static output, zero JS by default |
| Styling    | Tailwind CSS                              |
| Deployment | Cloudflare Pages                          |
| Domain     | `clef.sh`                                 |

### Repo Structure

```
www/
  src/
    pages/
      index.astro
      404.astro
    components/
      Hero.astro
      FeatureGrid.astro
      InstallSnippet.astro
      MatrixPreview.astro
  public/
    og-image.png
    favicon.svg
  astro.config.mjs
```

### Landing Page Sections

In order: **Hero** (headline, subline, install command as the hero element, link to docs) → **What it is** (two to three sentences, prose not bullets) → **The problem it solves** (before/after terminal comparison) → **Key features** (three or four tiles max: icon, title, one sentence) → **Quick start** (five commands or fewer: install, `clef init`, `clef set`, `clef ui`) → **Footer** (GitHub, docs, license — nothing else).

```bash
# The hero install command
brew install clef-sh/tap/clef-secrets
```

### Deployment

Every push to `main` touching `www/` auto-deploys to `clef.sh` via Cloudflare Pages. PRs generate preview deployments.

---

## 15. Developer Documentation — VitePress

Full developer docs in `docs/` deployed to `docs.clef.sh`.

### Structure

```
docs/
  .vitepress/
    config.ts
    theme/
      index.ts
      style.css
  index.md
  guide/
    introduction.md
    installation.md
    quick-start.md
    concepts.md
    manifest.md
  cli/
    overview.md
    init.md  get.md  set.md  delete.md
    diff.md  lint.md  rotate.md  hooks.md  ui.md
  ui/
    overview.md
    matrix-view.md  editor.md  diff-view.md  lint-view.md
  backends/
    age.md  aws-kms.md  gcp-kms.md  pgp.md
  schemas/
    overview.md  reference.md
  contributing/
    development-setup.md  architecture.md  testing.md  releasing.md
  changelog.md
```

### Writing Standards

**Audience:** A developer comfortable with the terminal and git but new to SOPS. Never assume KMS knowledge. Always explain the why before the how.

**Page structure:** One-paragraph overview → prerequisites → main content → next steps or see also.

**Code blocks:** All terminal examples in `bash`, all config in `yaml`. Every block must be copy-pasteable and work exactly as written.

**CLI reference pages:** Each command gets its own page with description, syntax, all flags with types and defaults, at least two examples, and related commands.

**Versioning:** Docs versioned in lock-step with Clef releases. Breaking changes documented in changelog and docs pages in the same PR as the code change.

**Search:** Algolia DocSearch (free for OSS). Apply after first public release.

### Local Development

```bash
cd docs
npm install
npm run dev       # localhost:5173 with hot reload
npm run build     # production build
npm run preview   # preview production build
```

Every push to `main` touching `docs/` auto-deploys to `docs.clef.sh`. PRs generate preview deployments.
