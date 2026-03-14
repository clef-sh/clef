# Development Setup

This guide walks you from cloning the repository to a fully working `clef` command, running every test tier, and iterating on changes.

## Prerequisites

### Required for all development

| Tool    | Version check   | Minimum               |
| ------- | --------------- | --------------------- |
| Node.js | `node -v`       | >= 22                 |
| npm     | `npm -v`        | included with Node.js |
| git     | `git --version` | >= 2.28.0             |

### Required for integration tests and local usage

| Tool | Version check    | Purpose                 |
| ---- | ---------------- | ----------------------- |
| sops | `sops --version` | Encrypt/decrypt secrets |

> **Node.js, npm, and git** are required for all development — building, unit testing, and linting. **sops** is only required for integration tests and for actually running `clef` commands against real encrypted files. Unit tests mock all subprocess calls and do not need sops installed.

### Platform-specific install commands

```bash
# macOS
brew install node sops

# Ubuntu / Debian
sudo apt install nodejs npm
# sops: download from https://github.com/getsops/sops/releases

# Windows — use WSL (Windows Subsystem for Linux)
# Native Windows is not supported. Follow Ubuntu instructions above.
# See troubleshooting section for WSL-specific notes.
```

## Clone and install

```bash
git clone https://github.com/clef-sh/clef.git
cd clef
npm install
```

The `npm install` at the root installs dependencies for all packages in the monorepo via npm workspaces.

## Build

```bash
npm run build
```

This compiles TypeScript in all three packages: `packages/core`, `packages/cli`, and `packages/ui`.

## Running Clef from source

After building, there are three ways to run the CLI locally.

### Approach 1 — Direct invocation (recommended for quick tests)

```bash
npm run build
node packages/cli/bin/clef.js --version
node packages/cli/bin/clef.js init
node packages/cli/bin/clef.js get database/dev DB_HOST
```

`packages/cli/bin/clef.js` requires the compiled output in `packages/cli/dist/`. After editing TypeScript source, `npm run build` must be run before the CLI reflects changes.

### Approach 2 — npm link (global symlink)

```bash
cd packages/cli
npm link
```

After this, `clef` is available as a global command from any directory.

- **Verify:** `which clef` should point to the npm link in Node's global bin directory.
- **Unlink when done:** `npm unlink -g @clef-sh/cli`
- **Important:** if you also have Clef installed globally (`npm install -g @clef-sh/cli`), the two installations will conflict — `which clef` shows which one wins based on PATH order. Use direct invocation to avoid ambiguity.
- **Caveat:** `npm link` uses the compiled `dist/` output, so the build step is still required after every edit.

### Approach 3 — Shell alias (no global pollution)

```bash
# Set for the current session from the repo root:
alias clef="node $(pwd)/packages/cli/bin/clef.js"

# Or add to ~/.zshrc / ~/.bashrc for persistence:
alias clef="node /path/to/clef/packages/cli/bin/clef.js"
```

This is the safest approach for developers who do not want to modify their global npm, or who are working across multiple Clef checkouts simultaneously. The alias disappears when the shell session ends unless added to a profile file.

## Edit-build-test cycle

### The basic loop

```
1. Edit TypeScript source in packages/*/src/
2. Rebuild: npm run build (or target a single package)
3. Run tests: npm test (or target a single file)
4. Try the CLI: node packages/cli/bin/clef.js <command>
```

### Single-package rebuild for faster iteration

```bash
# Rebuild only core after editing core source
npm run build -w packages/core

# Rebuild only cli after editing cli source
npm run build -w packages/cli

# Rebuild only ui after editing ui source
npm run build -w packages/ui
```

### The dependency chain

```
packages/core  ←  packages/cli
packages/core  ←  packages/ui
```

If you edit `packages/core`, rebuild core first before rebuilding cli or ui. They import from core's compiled `dist/` output — a stale core build means the CLI and UI reflect old behaviour even after their own rebuild.

```bash
# Correct order after editing core source:
npm run build -w packages/core
npm run build -w packages/cli   # if cli was also changed
```

### Watch mode for rapid iteration

```bash
npx tsc -w -p packages/core/tsconfig.json
```

This is not part of the standard scripts but works for rapid iteration on a single package. It only recompiles TypeScript — it does not re-run tests or restart any server. For UI development, use the Vite dev server (see UI development section below) which has hot module replacement built in.

## Test tiers

### Tier 1 — Unit tests (no external dependencies)

```bash
# All packages
npm test

# Single package
npm test -w packages/core
npm test -w packages/cli
npm test -w packages/ui

# Single file
npx jest --config packages/cli/jest.config.js \
  packages/cli/src/commands/get.test.ts
```

Everything is mocked. No sops, no git, no network. These tests run identically on any machine with Node installed.

**Coverage:**

```bash
npm run test:coverage
```

The CI gate enforces 100% line coverage on `packages/core`. Coverage regressions fail the build. If you add a new function, add tests for it before opening a PR.

### Tier 2 — Lint and format checks

```bash
npm run lint
npm run format:check

# Auto-fix formatting:
npm run format
```

Must pass before committing. Run `npm run format` before pushing if you see format errors. ESLint uses the flat config in `eslint.config.js`.

### Tier 3 — Integration tests (requires sops)

```bash
npm run test:integration
```

Integration tests create a temporary git repository, generate a temporary age key pair using the `age-encryption` npm package (no binary required), create a real `clef.yaml` manifest, and run actual SOPS encrypt/decrypt operations against real files. They verify end-to-end behaviour that unit tests cannot cover.

Prerequisite: sops must be installed and on PATH. No environment variables need to be set — the integration test setup script generates its own temporary key pair.

If sops is not installed, the suite exits with:

```
sops not found. Install sops to run integration tests:
  brew install sops  (macOS)
  See https://github.com/getsops/sops/releases  (Linux)
```

## Local experimentation with real encryption

This section explains how to try Clef commands against real encrypted files — not for unit testing (which is fully mocked), but for understanding the tool's actual end-to-end behaviour.

```bash
# 1. Create a playground directory
mkdir -p /tmp/clef-playground && cd /tmp/clef-playground
git init

# 2. Initialise Clef — generates an age key pair with a unique label
node /path/to/clef/packages/cli/bin/clef.js init \
  --namespaces database --non-interactive

# 3. Set a value
node /path/to/clef/packages/cli/bin/clef.js \
  set database/dev DB_HOST localhost

# 4. Read it back
node /path/to/clef/packages/cli/bin/clef.js \
  get database/dev DB_HOST

# 5. Open the UI
node /path/to/clef/packages/cli/bin/clef.js ui
```

**Important notes:**

- The age private key is stored in the OS keychain or at `~/.config/clef/keys/{label}/keys.txt` (outside the repository). The label and storage method are recorded in `.clef/config.yaml` (gitignored).
- If you see `could not decrypt` errors, run `clef doctor` to diagnose.
- The `/tmp/clef-playground` directory is safe for experimentation — cleaned up on system restart.

## UI development

For active UI development, run the Vite dev server and the API server separately in two terminals.

### Terminal 1 — API server

```bash
cd packages/cli
npx clef ui --no-open
# Express API server starts on http://127.0.0.1:7777
# Requires a valid clef.yaml in the current directory
```

### Terminal 2 — Vite dev server

```bash
cd packages/ui
npm run dev
# Vite starts on http://localhost:5173
# Open this URL in the browser
```

### How the proxy works

The Vite config proxies all `/api/*` requests from `:5173` to `127.0.0.1:7777`. The developer interacts with `localhost:5173` in the browser. API calls transparently route to the Express server. Hot module replacement means React component changes reflect instantly without rebuilding.

### When to use which approach

| Scenario                             | Use                             |
| ------------------------------------ | ------------------------------- |
| Actively developing React components | Vite dev server (`npm run dev`) |
| Testing the production build         | `clef ui`                       |
| Debugging API / server-side issues   | `clef ui` (single process)      |
| Writing component unit tests         | `npm test -w packages/ui`       |

### Running UI tests

```bash
npm test -w packages/ui
```

UI tests use React Testing Library and jsdom. No real server is started — all API calls are mocked. Tests use `data-testid` selectors, not text content, for stability.

## Monorepo structure

```
clef/
├── packages/
│   ├── core/          # Core library — manifest parser, SOPS client, matrix
│   │                  #   manager, schema validator, diff engine, bulk ops,
│   │                  #   git integration, lint runner
│   ├── cli/           # CLI — commander.js commands, output formatter
│   └── ui/            # Web UI — React frontend, Express API server
├── docs/              # VitePress documentation site
├── www/               # Static marketing site (Astro)
├── package.json       # Root workspace config
└── clef.yaml  # (only in consumer repos, not in Clef source)
```

### packages/core

The core library that both the CLI and UI depend on. Contains all business logic:

| Module          | Location                  | Responsibility                                     |
| --------------- | ------------------------- | -------------------------------------------------- |
| ManifestParser  | `src/manifest/parser.ts`  | Load and validate `clef.yaml`                      |
| SopsClient      | `src/sops/client.ts`      | Subprocess wrapper for the `sops` binary           |
| MatrixManager   | `src/matrix/manager.ts`   | Resolve file paths, detect missing cells, scaffold |
| SchemaValidator | `src/schema/validator.ts` | Validate decrypted values against schemas          |
| DiffEngine      | `src/diff/engine.ts`      | Cross-environment key comparison                   |
| BulkOps         | `src/bulk/ops.ts`         | Multi-file operations                              |
| GitIntegration  | `src/git/integration.ts`  | Git commit, log, diff, pre-commit hook             |
| LintRunner      | `src/lint/runner.ts`      | Full repo validation                               |

### packages/cli

The CLI entry point. Each command is registered as a commander.js subcommand:

| File                     | Command       |
| ------------------------ | ------------- |
| `src/commands/init.ts`   | `clef init`   |
| `src/commands/get.ts`    | `clef get`    |
| `src/commands/set.ts`    | `clef set`    |
| `src/commands/delete.ts` | `clef delete` |
| `src/commands/diff.ts`   | `clef diff`   |
| `src/commands/lint.ts`   | `clef lint`   |
| `src/commands/rotate.ts` | `clef rotate` |
| `src/commands/hooks.ts`  | `clef hooks`  |
| `src/commands/exec.ts`   | `clef exec`   |
| `src/commands/export.ts` | `clef export` |
| `src/commands/ui.ts`     | `clef ui`     |

### packages/ui

The React frontend and Express API server:

- **Frontend:** React SPA built with Vite. Four main views: matrix, editor, diff, lint.
- **Server:** Express.js HTTP server bound to `127.0.0.1`. Provides REST API endpoints that call core library functions.

## Platform notes

### Windows

Clef is developed and tested on macOS and Linux. **Windows is supported only via WSL** (Windows Subsystem for Linux).

Native Windows has a known limitation: Node.js on Windows does not support Unix signals (`SIGINT`, `SIGTERM`), so `clef exec` cannot reliably forward signals to child processes. Running inside WSL avoids this issue entirely.

If you are developing on Windows, install WSL 2 and run all Clef commands inside your WSL distribution.

## Troubleshooting

| Problem                                          | Cause                              | Fix                                                                                          |
| ------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `clef: command not found` after `npm link`       | Node global bin not on PATH        | `export PATH="$(npm config get prefix)/bin:$PATH"`                                           |
| `clef` runs Homebrew version instead of local    | PATH order conflict                | Use direct invocation: `node packages/cli/bin/clef.js`                                       |
| Build errors after `git pull`                    | Dependencies changed               | `npm install` at repo root                                                                   |
| CLI reflects old behaviour after editing core    | Stale core build                   | `npm run build -w packages/core`                                                             |
| `Cannot find module '../dist/index.js'`          | Build step was skipped             | `npm run build`                                                                              |
| `error: could not decrypt`                       | Key not configured or mismatch     | Run `clef doctor`; verify `SOPS_AGE_KEY_FILE` is set and recipient in `clef.yaml` matches    |
| Port 7777 already in use                         | Another `clef ui` instance running | `lsof -ti:7777 \| xargs kill` or use `--port` flag                                           |
| Integration tests fail — sops not found          | sops not installed                 | `brew install sops`                                                                          |
| `npm test` passes but `npm run lint` fails       | Code style issue                   | `npm run format` to auto-fix                                                                 |
| WSL: `clef ui` opens but browser does not launch | No display in WSL                  | Use `--no-open` flag; open `http://127.0.0.1:7777?token=<token>` manually in Windows browser |

## Useful commands

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `npm test`             | Run all unit tests               |
| `npm run build`        | Build all packages               |
| `npm run lint`         | Run ESLint across all packages   |
| `npm run format`       | Format all files with Prettier   |
| `npm run format:check` | Check formatting without writing |

## Further reading

- [Testing guide](testing.md) — test philosophy, coverage thresholds, mock patterns
- [Architecture](architecture.md) — dependency injection, core domain model, design decisions
- [Releasing](releasing.md) — version bumps, changelog, CI pipeline
- [Deployment](deployment.md) — Cloudflare Pages setup for docs and marketing site
