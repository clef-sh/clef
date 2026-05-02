# Clef — Master Project Brief

> **clef.sh** | CLI command: `clef` | GitHub: github.com/clef-sh/clef
> Git-native config and secrets management built on CNCF SOPS

> **Status:** Beta (`0.1.x`). All original MVP items are shipped. Scope has
> expanded well beyond the initial brief: runtime/agent packages for consuming
> secrets at runtime, service identities, drift detection, artifact packing and
> signing, a hosted Clef Cloud integration, and a broker harness for dynamic
> credentials. This document has been reconciled with the current codebase;
> sections that describe future work are noted inline.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Core Concepts](#2-core-concepts)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Architecture](#5-architecture)
6. [CLI Command Reference](#6-cli-command-reference)
7. [MVP Scope — Shipped](#7-mvp-scope--shipped)
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

A local-first, open source tool that brings a structured UI and workflow layer on top of [CNCF SOPS](https://github.com/getsops/sops) — making encrypted, git-tracked secrets and config management ergonomic for teams without requiring any server infrastructure.

**Design philosophy:** Git is the source of truth. SOPS is the encryption engine. The tool is the interface.

### Competitive Position

_SOPS is not in this comparison because Clef is built on top of it, not as an alternative to it. Every encrypted file Clef manages is a SOPS file; every encryption and decryption call goes through the SOPS binary. The tools below are full-stack secrets managers that Clef would replace; SOPS is the engine inside Clef._

| Tool                | Approach                        | Gap Clef fills                       |
| ------------------- | ------------------------------- | ------------------------------------ |
| HashiCorp Vault     | Centralized server, complex ops | Heavy; needs infra; not git-native   |
| Doppler / Infisical | SaaS-first                      | Vendor lock-in, not truly serverless |
| AWS Secrets Manager | Cloud-native                    | Tied to AWS                          |
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
    # Optional per-environment backend override — e.g. point prod at AWS KMS
    sops:
      backend: awskms
      aws_kms_arn: arn:aws:kms:us-east-1:111122223333:key/abcd-efgh

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
  default_backend: age # one of: age, awskms, gcpkms, azurekv, pgp
  age:
    recipients:
      - age1abc...
      - age1xyz...

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
- **FR-26** Support Azure Key Vault
- **FR-27** Support PGP (via SOPS; decrypt-only, no first-class UI)
- **FR-28** Display which key/backend was used to encrypt each file
- **FR-29** Re-encryption support (rotate to a new key)
- **FR-30** Migrate an entire repo from one backend to another (`clef migrate-backend`)

### 3.7 Access & Safety

- **FR-31** `production` (or any `protected: true` environment) requires explicit confirmation before writes
- **FR-32** Never log or display plaintext values in terminal output or logs
- **FR-33** Clear decrypted values from memory on close/timeout
- **FR-34** Pre-commit hook that scans staged files for SOPS metadata — blocks commits on files missing encryption markers
- **FR-35** Entropy-based secret scanner (`clef scan`) with ignore patterns for finding plaintext leaks outside the matrix

### 3.8 Service Identities

- **FR-36** Define named service identities that receive scoped access to one or more namespaces
- **FR-37** `clef service create` / `clef service add-env` to register identities and grant per-environment access
- **FR-38** `clef revoke` to rotate an identity's keys and re-encrypt affected files
- **FR-39** Service identity management surface in the local web UI

### 3.9 Runtime Consumption

- **FR-40** Lightweight runtime library (`@clef-sh/runtime`) that fetches, decrypts, and caches secret artifacts without a sops or git dependency
- **FR-41** Standalone agent (`@clef-sh/agent`) exposing a local HTTP API for sidecar consumption, with a Lambda extension mode
- **FR-42** Artifact packing (`clef pack`) — bundle an environment's decrypted material into a signed, KMS-encrypted artifact for runtime consumption
- **FR-43** `clef serve` — run a local agent against the current repo for development
- **FR-44** `clef exec` — inject decrypted values into a child process as environment variables for one-shot commands
- **FR-45** Dynamic credential brokers (`@clef-sh/broker`) — harness for exchanging static material for short-lived credentials (e.g. STS assume-role) at fetch time

### 3.10 Drift, Reports, and Audit

- **FR-46** Drift detection (`clef drift`) — compare the live matrix against a known-good state and report divergence
- **FR-47** Report generation (`clef report`) — emit compliance/audit output covering recipients, access, and matrix health
- **FR-48** Import from common formats — `.env`, JSON, YAML — into the matrix
- **FR-49** Export to common formats for consumption by tools that do not embed the runtime
- **FR-50** Opt-in anonymous usage analytics (`@clef-sh/analytics`, PostHog-backed)

### 3.11 Clef Cloud (opt-in)

- **FR-51** Managed KMS via a spawned `keyservice` binary that proxies AWS, GCP, and Azure KMS operations
- **FR-52** Device-flow OAuth login (`clef cloud login`) — no long-lived credentials stored locally
- **FR-53** `clef cloud init --env <environment>` bootstrap that wires an environment to a managed cloud key
- **FR-54** Cloud integration ships in the CLI but is fully inert until the user opts in; no outbound calls from the OSS surface

---

## 4. Non-Functional Requirements

| ID         | Requirement                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------- |
| **NFR-01** | No mandatory server — runs entirely local                                                           |
| **NFR-02** | No database — git repo is the only persistence layer                                                |
| **NFR-03** | Open source (MIT)                                                                                   |
| **NFR-04** | SOPS binary is bundled per-platform; system `sops` on PATH is an accepted fallback                  |
| **NFR-05** | Works on macOS (arm64, x64), Linux (arm64, x64), and Windows (x64)                                  |
| **NFR-06** | Plaintext values must never be written to disk at any point                                         |
| **NFR-07** | All file I/O piped through SOPS — no custom crypto                                                  |
| **NFR-08** | Startup time under 2s for repos with up to 100 encrypted files                                      |
| **NFR-09** | Local web UI binds `127.0.0.1` only, enforced via host-header validation                            |
| **NFR-10** | Local web UI requires a per-session bearer token (256-bit) on every `/api` route                    |
| **NFR-11** | Cloud integration ships with the CLI but must make no outbound network call until the user opts in  |
| **NFR-12** | CLI distributes as a Single Executable Application (SEA) with the sops binary bundled into the blob |

---

## 5. Architecture

Clef is an npm-workspaces monorepo of nine packages, with a tenth family of
platform-specific packages that each ship a bundled `sops` binary.

### 5.1 High-Level Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                         Authoring surfaces                        │
│                                                                   │
│   ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐    │
│   │  CLI (clef)  │    │  Local Web UI    │    │  Clef Cloud  │    │
│   │              │    │  (127.0.0.1)     │    │  (opt-in)    │    │
│   └──────┬───────┘    └────────┬─────────┘    └──────┬───────┘    │
└──────────┼─────────────────────┼─────────────────────┼────────────┘
           │                     │                     │
           ▼                     ▼                     ▼
┌───────────────────────────────────────────────────────────────────┐
│                      @clef-sh/core (library)                      │
│                                                                   │
│  manifest · matrix · schema · diff · lint · scanner · recipients  │
│  pending  · tx     · bulk   · git  · sops · drift   · report      │
│  service-identity · artifact · import · structure · migration     │
│  merge    · kms    · cloud   · age  · dependencies · consumption  │
└──────┬─────────────────────┬──────────────────────┬───────────────┘
       │                     │                      │
       ▼                     ▼                      ▼
┌────────────┐        ┌────────────┐         ┌────────────┐
│ SOPS layer │        │  Git layer │         │  FS layer  │
│ stdin/out  │        │ log/diff/  │         │ repo I/O   │
│ no disk IO │        │ commit     │         │            │
└─────┬──────┘        └─────┬──────┘         └─────┬──────┘
      ▼                     ▼                      ▼
┌────────────┐        ┌────────────┐         ┌────────────┐
│ sops bin   │        │ git bin    │         │  repo FS   │
│ (bundled)  │        │            │         │            │
└────────────┘        └────────────┘         └────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                        Consumption surfaces                       │
│                                                                   │
│   ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐    │
│   │  clef exec   │    │ @clef-sh/agent   │    │ @clef-sh/    │    │
│   │  (one-shot)  │    │ (sidecar daemon  │    │   client     │    │
│   │              │    │  + Lambda ext)   │    │  (SDK)       │    │
│   └──────┬───────┘    └────────┬─────────┘    └──────┬───────┘    │
└──────────┼─────────────────────┼─────────────────────┼────────────┘
           │                     │                     │
           └───────────────┬─────┴─────────────────────┘
                           ▼
              ┌────────────────────────────┐
              │     @clef-sh/runtime       │
              │ VCS fetch · age decrypt    │
              │ memory + disk cache · poll │
              └────────────────────────────┘
```

### 5.2 Packages

| Package              | Role                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `@clef-sh/core`      | The heart of the system. All domain logic; depends on `yaml` and `age-encryption` only.         |
| `@clef-sh/cli`       | Commander.js CLI. Thin wrapper over core. Ships as a SEA with the sops binary bundled in.       |
| `@clef-sh/ui`        | React + Vite client and Express server for the local web UI. Served by `clef ui`.               |
| `@clef-sh/runtime`   | Lightweight engine for consuming packed artifacts at runtime. No sops, no git.                  |
| `@clef-sh/agent`     | Standalone HTTP sidecar daemon wrapping the runtime. Supports Lambda extension mode.            |
| `@clef-sh/broker`    | Harness for dynamic credential brokers (e.g. STS assume-role at fetch time).                    |
| `@clef-sh/cloud`     | Opt-in Clef Cloud integration: device-flow auth, keyservice spawner, cloud pack/report clients. |
| `@clef-sh/client`    | Public SDK for application code. Wraps `/v1/secrets`, falls back to env vars.                   |
| `@clef-sh/analytics` | Opt-out PostHog telemetry. Used by CLI only.                                                    |

Platform binaries live under `platforms/` as separate packages
(`@clef-sh/sops-{platform}-{arch}`, versioned by sops version), and are pulled
in as optional dependencies of the CLI and agent.

### 5.3 Layer Responsibilities

**CLI Layer** — entry point for all commands. Every command is a file in
`packages/cli/src/commands/{name}.ts` with a co-located test. Commands receive
a `SubprocessRunner` and `OutputFormatter` via factory function, which is how
unit tests mock everything without touching real sops or git.

**Local Web UI** — React frontend served from an Express server bound to
`127.0.0.1:7777`. Host-header validation rejects every non-loopback request; a
per-session 256-bit bearer token gates all `/api` routes. The server is
spawned by `clef ui` and serves the compiled client either from disk or from a
SEA blob, depending on how the CLI was built.

**Core Library** — authoritative domain logic, organised by submodule:

| Module              | Responsibility                                                             |
| ------------------- | -------------------------------------------------------------------------- |
| `manifest/`         | Parse, validate, and mutate `clef.yaml`                                    |
| `matrix/`           | Resolve namespace × environment cells and scaffold missing files           |
| `structure/`        | Add, remove, rename namespaces and environments in the manifest            |
| `schema/`           | Validate decrypted content against per-namespace schemas                   |
| `diff/`             | Cross-environment key comparison                                           |
| `lint/`             | Whole-repo health check: matrix completeness, schema, SOPS integrity       |
| `sops/`             | Subprocess wrapper over `sops`; stdin/stdout only, plus the resolver cache |
| `git/`              | Commit, log, diff, status, pre-commit hook management                      |
| `recipients/`       | age/PGP recipient and key management                                       |
| `pending/`          | Metadata tracking for in-progress rotations and multi-step operations      |
| `tx/`               | Transaction manager: preflight checks and rollback for multi-file writes   |
| `bulk/`             | Bulk cross-environment operations, wrapped by `tx`                         |
| `scanner/`          | Entropy-based secret scanner with ignore patterns                          |
| `drift/`            | Detects divergence between the live matrix and a known-good snapshot       |
| `report/`           | Emits audit/compliance reports; hosts the cloud report client              |
| `service-identity/` | Named service identities and per-environment access grants                 |
| `artifact/`         | Pack, sign (Ed25519 / KMS), and verify runtime artifacts                   |
| `kms/`              | Provider abstractions for aws, gcp, azure, cloud                           |
| `cloud/`            | keyservice spawning, device-flow auth, cloud pack/report clients           |
| `migration/`        | Backend migration (e.g. age → AWS KMS) across the whole repo               |
| `merge/`            | Git merge driver for SOPS files                                            |
| `import/`           | Import `.env`, JSON, YAML into the matrix                                  |
| `age/`              | Age key generation and key-file formatting                                 |
| `dependencies/`     | Checks for required external binaries (sops, git, age)                     |
| `consumption/`      | Tracks secret consumption / access patterns                                |

**SOPS Layer** — a thin subprocess wrapper. Decrypted values exist only in
memory; the `SopsClient.encrypt` path pipes plaintext over stdin (or a named
pipe on Windows — see CLAUDE.md for the libuv shutdown footnote) and reads
ciphertext from stdout. The `SopsResolver` uses three-tier resolution:
`CLEF_SOPS_PATH` → bundled `@clef-sh/sops-{platform}-{arch}` → system PATH.

**Git Layer** — subprocess wrapper around `git`. Reads: log, diff, status.
Writes: stage, commit. Never pushes.

**Runtime / Agent / Broker / Cloud** — consumption-side layers. Runtime fetches
artifacts from VCS providers (GitHub, GitLab, Bitbucket) or a hosted source,
decrypts with age, caches in memory with optional disk fallback, and polls for
updates. Agent wraps runtime in an Express server for sidecar deployment.
Broker exchanges packed material for short-lived credentials at fetch time.
Cloud proxies KMS operations through a spawned `keyservice` binary so that
operators can use AWS/GCP/Azure KMS without provisioning any cloud credentials
on the developer workstation.

### 5.4 Repo Structure (Consumer)

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

The CLI is grouped by purpose. All commands live in `packages/cli/src/commands/`
with a co-located test file.

**Repo lifecycle**

```bash
clef init                                          # Initialise a new clef repo
clef doctor                                        # Diagnose environment (sops, age, git, KMS)
clef install                                       # Bootstrap supporting binaries
clef update                                        # Self-update the CLI binary
clef ui                                            # Open the local web UI (127.0.0.1:7777)
```

**Reading and writing values**

```bash
clef get payments/production STRIPE_SECRET_KEY     # Get a single value
clef set payments/staging STRIPE_SECRET_KEY sk_x   # Set a value
clef delete payments STRIPE_LEGACY_KEY --all-envs  # Delete across all environments
clef search "stripe"                               # Search keys and values across the matrix
clef compare payments dev staging                  # Side-by-side comparison of two envs
clef diff auth dev production                      # Diff two environments
```

**Structure**

```bash
clef namespace add analytics                       # Add a namespace to the manifest
clef namespace remove legacy                       # Remove a namespace and its files
clef env add qa                                    # Add an environment
clef env remove qa                                 # Remove an environment
```

**Health, drift, and audit**

```bash
clef lint                                          # Full repo health check
clef drift                                         # Detect divergence from known-good state
clef scan                                          # Entropy-based secret scan outside the matrix
clef report                                        # Compliance / audit report
```

**Encryption management**

```bash
clef rotate payments/production --new-key age1xxx  # Rotate encryption key
clef recipients add age1abc...                     # Add a recipient
clef revoke alice@example.com                      # Revoke an identity, rotate, re-encrypt
clef migrate-backend --from age --to aws-kms       # Migrate the whole repo to a new backend
```

**Import / export / packing**

```bash
clef import .env --namespace app --env dev         # Import a .env file into the matrix
clef export app/production --format json           # Export a cell to another format
clef pack --env production                         # Pack an environment into a signed artifact
```

**Runtime and integration**

```bash
clef exec --env production -- node server.js      # Inject decrypted values as env vars
clef serve --env production                        # Run a local agent against this repo
clef service create deploy-bot                     # Create a service identity
clef service add-env deploy-bot production         # Grant an identity access to an env
clef hooks install                                 # Install the pre-commit hook
clef merge-driver install                          # Install the SOPS git merge driver
```

**Clef Cloud (opt-in)**

```bash
clef cloud login                                   # Device-flow OAuth
clef cloud init --env production                   # Wire an env to a managed cloud key
clef cloud status                                  # Auth and integration status
```

---

## 7. MVP Scope — Shipped

All ten original MVP items are implemented and shipping in the `0.1.x` beta.

| #   | Feature                                       | Status     |
| --- | --------------------------------------------- | ---------- |
| 1   | Manifest parsing + file matrix scaffold       | ✅ Shipped |
| 2   | CLI: get / set / delete (single file)         | ✅ Shipped |
| 3   | CLI: diff (two environments)                  | ✅ Shipped |
| 4   | CLI: lint (missing keys, matrix completeness) | ✅ Shipped |
| 5   | Pre-commit hook installer                     | ✅ Shipped |
| 6   | Local Web UI: matrix browser + edit           | ✅ Shipped |
| 7   | Schema validation                             | ✅ Shipped |
| 8   | Bulk cross-environment set                    | ✅ Shipped |
| 9   | Key rotation helper                           | ✅ Shipped |
| 10  | Git log view in UI                            | ✅ Shipped |

### Post-MVP scope (also shipped or in-flight)

| Area                | Feature                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| Runtime consumption | `@clef-sh/runtime`, `@clef-sh/agent` (sidecar + Lambda), `clef exec`, `clef serve` |
| Artifact pipeline   | `clef pack` with Ed25519 / KMS signatures; runtime verification                    |
| Service identities  | `clef service` commands and UI screen                                              |
| Scanner             | Entropy-based `clef scan` with ignore patterns                                     |
| Drift and reports   | `clef drift`, `clef report`                                                        |
| Import / export     | `.env`, JSON, YAML both directions                                                 |
| Backend migration   | `clef migrate-backend` for whole-repo rotation across backends                     |
| Git merge driver    | `clef merge-driver install`                                                        |
| Clef Cloud          | Managed KMS via keyservice, device-flow login, cloud pack/report                   |
| Broker harness      | `@clef-sh/broker` for dynamic credential exchange at fetch time                    |
| Client SDK          | `@clef-sh/client` with env-var fallback                                            |
| Telemetry           | Opt-out PostHog analytics via `@clef-sh/analytics`                                 |

---

## 8. Key Technical Decisions

| Decision                   | Choice                            | Rationale                                                                                           |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Implementation language    | TypeScript + Node.js              | Shared types across CLI, UI, runtime, SDK; React ecosystem for the UI; SEA for single-binary dist.  |
| Monorepo tooling           | npm workspaces                    | Stdlib tooling; no extra orchestrator; fast enough at nine packages.                                |
| UI framework               | React + Vite + Express            | Vite dev server proxies `/api` to port 7777; Express serves the built client in production.         |
| SOPS interaction           | Subprocess (sops binary)          | Avoid re-implementing crypto; SOPS binary is the trust anchor. Bundled per-platform; PATH fallback. |
| Local UI transport         | `127.0.0.1:7777` + bearer token   | Host-header validation + 256-bit per-session token on every `/api` route.                           |
| Binary distribution        | Node 20 SEA with sops in the blob | Single executable, no install step, installer script verifies checksums.                            |
| Config format              | YAML                              | Consistent with SOPS conventions.                                                                   |
| Encryption backend default | age                               | Zero-infra, modern, simpler than PGP.                                                               |
| Cloud KMS transport        | Spawned `keyservice` binary       | SOPS gRPC protocol; keyservice proxies AWS / GCP / Azure KMS. Lazy-loaded, opt-in only.             |
| Testing                    | Jest (unit), Playwright (e2e)     | Jest is the ecosystem default; Playwright drives real browsers against the built SEA binary.        |

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

**Sidebar** contains: the `clef` logotype with repo name and git branch, primary navigation (Matrix, Diff, Lint, Manifest, Recipients, Backend, Service Identities, Scan, Import), the namespace list with issue badges, and a status footer showing uncommitted file count and key backend status. The footer is always visible — developers should never hunt for whether their key is loaded.

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

The matrix makes two project-level problems visible that aren't visible from any single encrypted file: missing cells (a namespace/environment that should exist but doesn't) and key drift (a cell with fewer keys than its siblings, meaning something was added to dev but never promoted). These are organizational concerns above the encryption layer — the matrix is where Clef adds them.

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

### Screens Added After the Original Mockup

The UI has grown past the four-screen mockup as new core capabilities landed.
Every screen below lives in `packages/ui/src/client/screens/`:

| Screen                    | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `ManifestScreen`          | Visual editor for `clef.yaml` — namespaces, environments, file patterns. |
| `GitLogView`              | Per-file commit history panel.                                           |
| `ScanScreen`              | Results from the entropy scanner, with ignore controls.                  |
| `RecipientsScreen`        | age/KMS recipient and key management.                                    |
| `BackendScreen`           | SOPS backend configuration and migration.                                |
| `ServiceIdentitiesScreen` | Service identities and per-environment access grants.                    |
| `ImportScreen`            | Guided import of `.env`, JSON, or YAML into the matrix.                  |

### What Is Still Not In The UI

Specified or planned but not yet built as a dedicated UI surface:

- Key rotation wizard (`clef rotate` guided flow — CLI only today)
- Commit message input (modal before `Commit changes` writes to git)
- Pre-commit hook installer (settings/onboarding surface)
- Onboarding / `clef init` first-run flow
- Multi-file bulk set (`Sync missing keys →` flow in diff view)
- Drift and report screens (both are CLI-only today)
- Clef Cloud onboarding flow (currently `clef cloud init` in the CLI)

---

## 10. Testing Requirements

### Philosophy

Every meaningful behaviour in Clef must be covered by a unit test. Unit tests
run entirely offline — no real KMS providers, no live git remotes, no actual
SOPS binaries. The `SubprocessRunner` interface in core is the seam that makes
this possible: tests inject `jest.fn()` implementations and assert on the
argv they would have run.

### Test Tiers

| Tier        | Location                         | Runtime dependencies             |
| ----------- | -------------------------------- | -------------------------------- |
| Unit        | `packages/*/src/**/*.test.ts(x)` | None. All I/O mocked.            |
| Integration | `integration/`                   | Real sops + age + git on PATH.   |
| End-to-end  | `e2e/` (Playwright)              | Built CLI SEA binary + Chromium. |

### Coverage Requirements

Global thresholds (enforced in `jest.config.js` per package):

- **core and CLI**: 80% lines / functions / statements, 75% branches
- **Tier-1 modules** (`sops/client`, `pending/metadata`, `scanner/patterns`,
  `diff/engine`, `manifest/parser`): 95% lines and functions, 90% branches

### Commands

```bash
npm test                     # Unit tests across all workspaces
npm run test:coverage        # Unit tests + coverage report
npm run test:integration     # Real sops + git, temp directories
npm run test:e2e             # Build SEA + run Playwright (Chromium)
npm run test:e2e:node        # Same e2e suite, but against the plain Node CLI build
```

### CI Gate

Before any PR can merge: `npm run lint` must be clean, `npm run format:check`
must pass, `npm run test:coverage` must meet all thresholds, and
`npm run test:e2e` must pass. Skipped tests require an issue number in the
skip reason.

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

**YAML:** Prettier with YAML plugin. **Markdown:** Prettier with `proseWrap: "always"`, `printWidth: 80`.

**Linting:** ESLint with `@typescript-eslint`. `@typescript-eslint/no-explicit-any`
is `error`; unused vars are allowed only if prefixed with `_`. No `any` types
without a suppression comment referencing a tracking issue.

**Enforcement:** Pre-commit hook (staged files only) and a CI `format-check`
job on every PR.

```bash
npm run format           # Format all files
npm run format:check     # Check without writing (CI)
npm run lint             # Lint all files
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
npm install             # Installs all workspaces
npm run build           # Build every package
npm test                # Verify your setup (unit tests only)
npm run dev -w packages/ui   # Start the UI in dev mode (Vite + Express)
```

Unit tests do not require `sops`, `age`, or `git`. Integration tests
(`npm run test:integration`) and end-to-end tests (`npm run test:e2e`) do.

### Before Opening a PR

Run these from the repo root — they are the same gates CI enforces:

```bash
npm run lint             # Must pass with zero errors
npm run test:coverage    # Must meet all coverage thresholds
npm run format:check     # Must pass with no formatting issues
npm run test:e2e         # Builds SEA + runs Playwright
```

Checklist:

- [ ] Tests written for all new behaviour
- [ ] All gates above pass locally
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains what and why
- [ ] New public API or CLI behaviour is documented in `docs/`

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
curl -fsSL https://clef.sh/install.sh | sh
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
    # One page per command in packages/cli/src/commands — grows with the CLI
  ui/
    overview.md
    matrix-view.md  editor.md  diff-view.md  lint-view.md
    manifest.md  recipients.md  backend.md  service-identities.md
  backends/
    age.md  aws-kms.md  gcp-kms.md  azure.md  pgp.md
  runtime/
    overview.md  agent.md  broker.md  client.md
  cloud/
    overview.md  login.md  init.md
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
