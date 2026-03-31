# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clef is a git-native secrets management tool built on Mozilla SOPS. It provides a CLI, local web UI, and lint/drift detection for managing encrypted secrets organized in a namespace × environment matrix.

## Monorepo Structure

npm workspaces with three packages:

- **`packages/core`** — Core library (manifest parsing, matrix management, SOPS client, sops binary resolver, lint runner, schema validation, diff engine, secret scanning, git integration, bulk ops, import/export, recipient management, pending metadata, age keygen, dependency checking). Production dependencies: `yaml`, `age-encryption`.
- **`packages/cli`** — Commander.js CLI wrapping core. Commands: init, get, set, compare, delete, diff, lint, rotate, hooks, exec, export, import, doctor, update, scan, search, recipients, ui, merge-driver, migrate-backend, service, pack, drift, report, revoke, install. Has `optionalDependencies` on `@clef-sh/sops-{platform}-{arch}` packages for bundled sops binary.
- **`packages/runtime`** — Lightweight runtime secrets engine. VCS providers (GitHub, GitLab, Bitbucket), artifact sources, age decrypt, in-memory cache, disk cache fallback, polling. Production dependency: `age-encryption`. No sops, no git.
- **`packages/agent`** — Standalone sidecar wrapping runtime. Express HTTP API, daemon lifecycle, Lambda extension. Production dependencies: `@clef-sh/runtime`, `express`.
- **`packages/ui`** — React + Vite + Express local web UI served at `127.0.0.1:7777`.
- **`platforms/sops-{platform}-{arch}/`** — Platform-specific npm packages that each contain a single sops binary. Versioned by sops version (e.g. 3.9.4), not Clef version. Published separately via `publish-sops.yml` workflow.

## Commands

```bash
npm install          # Install all workspaces
npm test             # Run all unit tests across workspaces
npm run build        # Build all packages
npm run lint         # ESLint across all .ts/.tsx files
npm run format       # Prettier format all files
npm run format:check # Prettier check (CI)

# Run a single package's tests
npm test -w packages/core
npm test -w packages/cli
npm test -w packages/ui

# Run a single test file
npx jest --config packages/cli/jest.config.js packages/cli/src/commands/get.test.ts

# Integration tests (requires sops on PATH or bundled)
npm run test:integration

# Documentation
npm run docs:dev     # Dev server (typedoc + vitepress)
npm run docs:build   # Production build
npm run docs:api     # Generate API docs only (typedoc)
```

## Architecture

### Dependency Injection Pattern

`SubprocessRunner` interface abstracts all SOPS and git subprocess calls. CLI provides `NodeSubprocessRunner` (real `child_process.execFile`). Tests inject mocks via `jest.fn()` — no real subprocess calls in unit tests.

### Core Domain Model

- **Manifest** (`clef.yaml`): version 1, declares namespaces, environments, file patterns, schemas
- **Matrix**: namespace × environment grid; each cell maps to an encrypted SOPS file (default: `{namespace}/{environment}.enc.yaml`)
- **ManifestParser** validates and parses YAML; **MatrixManager** resolves cells and scaffolds files
- **SopsClient** wraps the `sops` binary — all encrypt/decrypt piped via stdin/stdout, never written to disk as plaintext. Uses `resolveSopsPath()` to locate the binary.
  - **Windows named pipe pitfall** (`openWindowsInputPipe` in `sops/client.ts`): On Unix, encrypt feeds plaintext to SOPS via `/dev/stdin`. Windows has no `/dev/stdin`, so we create a `net.createServer` named pipe, pass its `\\.\pipe\...` path as the input file, and SOPS (Go) connects via `CreateFile`. **Critical**: you must use `socket.write(content, () => socket.destroy())`, never `socket.end(content)`. On Windows, libuv's `uv_shutdown` is a no-op for pipes, so `socket.end()` never signals EOF — the Go client blocks forever waiting for more data. `socket.destroy()` (called after the write callback confirms flush) closes the handle, which Go sees as `ERROR_BROKEN_PIPE` → `io.EOF`. This caused all SOPS encrypt operations to hang on Windows CI until fixed.
  - The UI server (`packages/ui/src/server/api.ts`) has a separate **Linux FIFO workaround** for SEA binaries where `/dev/stdin` → `/proc/self/fd/0` fails with ENXIO on socketpairs. This uses `mkfifo` + `dd` and is unrelated to the Windows pipe issue.
- **SopsResolver** (`sops/resolver.ts`) — three-tier resolution: `CLEF_SOPS_PATH` env → bundled `@clef-sh/sops-{platform}-{arch}` package → system PATH fallback. Result is cached.
- **LintRunner** validates matrix completeness, schema conformance, and SOPS file integrity

### CLI Commands

Each command is in `packages/cli/src/commands/{name}.ts` with a co-located `{name}.test.ts`. Commands register on a Commander program and receive a `SubprocessRunner` + `OutputFormatter` via factory function.

### UI Architecture

Split client (Vite/React) and server (Express). Server binds `127.0.0.1` only. Vite dev server proxies `/api` to port 7777.

## Non-Negotiable Constraints

- **No plaintext to disk** — decrypted values exist in memory only; SOPS pipes via stdin/stdout
- **`127.0.0.1` only** — UI never binds `0.0.0.0`
- **No custom crypto** — all encryption/decryption goes through the `sops` subprocess
- **No `any` types** without a suppression comment explaining why
- **All namespaces must be encrypted** — unencrypted namespaces are intentionally unsupported

## Code Style

- Prettier: 100-char width, 2-space indent, double quotes, trailing commas, semicolons
- ESLint: `@typescript-eslint/no-explicit-any` is `error`; unused vars allowed if prefixed with `_`
- TypeScript: ES2022 target, strict mode, commonjs modules
- Conventional Commits: `type(scope): description` — types: feat, fix, docs, chore, refactor, test, ci

## After Every Change

Always run these commands from the repo root before considering a task done:

```bash
npm run lint          # must pass with zero errors
npm run test:coverage # must meet all coverage thresholds
npm run format:check  # must pass with no formatting issues
npm run test:e2e      # must pass with zero failures (builds SEA binary + runs Playwright)
```

## Test Coverage Thresholds

- **Global** (core & CLI): 80% lines/functions/statements, 75% branches
- **Tier 1 modules** (sops/client, pending/metadata, scanner/patterns, diff/engine, manifest/parser): 95% lines/functions, 90% branches
- Unit tests fully mock `fs`, `SubprocessRunner`, and `OutputFormatter`
- Integration tests (`integration/`) use real sops + git binaries with temp directories
