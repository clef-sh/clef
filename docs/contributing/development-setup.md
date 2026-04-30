# Development Setup

From cloning the repository to a working `clef` command, all test tiers, and iterating on changes.

## Prerequisites

### Required for all development

| Tool    | Version check   | Minimum               |
| ------- | --------------- | --------------------- |
| Node.js | `node -v`       | >= 22                 |
| npm     | `npm -v`        | included with Node.js |
| git     | `git --version` | >= 2.28.0             |

> Unit tests mock all subprocess calls — sops is not needed to build or run unit tests.

### sops binary — bundled by default

The `@clef-sh/cli` package declares platform-specific `optionalDependencies` that bundle the sops binary:

```
@clef-sh/sops-darwin-arm64   (macOS Apple Silicon)
@clef-sh/sops-darwin-x64     (macOS Intel)
@clef-sh/sops-linux-x64      (Linux x64)
@clef-sh/sops-linux-arm64    (Linux ARM64)
@clef-sh/sops-win32-x64      (Windows x64)
```

`npm install` installs the package matching your OS and architecture. The Clef resolver finds it at runtime — no manual sops install needed.

**Resolution order** (checked at runtime by `resolveSopsPath()`):

1. `CLEF_SOPS_PATH` environment variable — explicit override, used as-is
2. Bundled `@clef-sh/sops-{platform}-{arch}` optional dependency
3. System PATH fallback — bare `sops` command

Run `clef doctor` to confirm which source was resolved.

### When bundled sops is not available

On unsupported platforms or if the optional dependency failed, Clef falls back to any `sops` on your PATH:

```bash
# macOS
brew install sops

# Ubuntu / Debian
# Download from https://github.com/getsops/sops/releases

# Windows — use WSL (Windows Subsystem for Linux)
# Native Windows is not supported. Follow Ubuntu instructions above.
# See troubleshooting section for WSL-specific notes.
```

### Using sops in CI

In CI, `npm ci` installs the bundled sops binary automatically — no extra step needed. To pin a specific binary, set `CLEF_SOPS_PATH`:

```bash
# Example: CI installs sops manually and points Clef at it
curl -Lo /usr/local/bin/sops https://github.com/getsops/sops/releases/download/v3.12.2/sops-v3.12.2.linux.amd64
chmod +x /usr/local/bin/sops
export CLEF_SOPS_PATH=/usr/local/bin/sops

npm ci
npm run build
npm run test:integration
```

If `CLEF_SOPS_PATH` is unset and the bundled package installed successfully, the bundled binary is used — the recommended default for CI.

### Skipping optional dependencies

To skip optional dependencies when only running unit tests:

```bash
npm install --ignore-optional
npm test   # works — no sops needed for unit tests
```

## Clone and install

```bash
git clone https://github.com/clef-sh/clef.git
cd clef
npm install
```

Installs dependencies for all packages via npm workspaces.

## Build

```bash
npm run build
```

Compiles TypeScript for `packages/core`, `packages/cli`, and `packages/ui`.

## Running Clef from source

Three ways to run the CLI locally after building:

### Approach 1 — Direct invocation (recommended for quick tests)

```bash
npm run build
node packages/cli/bin/clef.js --version
node packages/cli/bin/clef.js init
node packages/cli/bin/clef.js get database/dev DB_HOST
```

Requires compiled output in `packages/cli/dist/`. Run `npm run build` after editing source.

### Approach 2 — npm link (global symlink)

```bash
cd packages/cli
npm link
```

`clef` becomes available as a global command. Unlink with `npm unlink -g @clef-sh/cli`. If Clef is also installed globally, the two installations conflict — use direct invocation to avoid ambiguity. Build step still required after every edit.

### Approach 3 — Shell alias (no global pollution)

```bash
# Set for the current session from the repo root:
alias clef="node $(pwd)/packages/cli/bin/clef.js"

# Or add to ~/.zshrc / ~/.bashrc for persistence:
alias clef="node /path/to/clef/packages/cli/bin/clef.js"
```

Safest approach for developers working across multiple checkouts or avoiding global npm changes. The alias disappears when the shell session ends unless added to a profile file.

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

If you edit `packages/core`, rebuild it before rebuilding cli or ui — they import from core's compiled `dist/`, so a stale core build produces stale behaviour even after their own rebuild.

```bash
# Correct order after editing core source:
npm run build -w packages/core
npm run build -w packages/cli   # if cli was also changed
```

### Watch mode for rapid iteration

```bash
npx tsc -w -p packages/core/tsconfig.json
```

Recompiles TypeScript only — does not re-run tests or restart servers. For UI development, use the Vite dev server (below) which has hot module replacement.

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

Everything is mocked — no sops, no git, no network. Runs identically on any machine with Node.

**Coverage:**

```bash
npm run test:coverage
```

Coverage regressions fail the build. Add tests for any new function before opening a PR.

### Tier 2 — Lint and format checks

```bash
npm run lint
npm run format:check

# Auto-fix formatting:
npm run format
```

Must pass before committing. Run `npm run format` to auto-fix format errors.

### Tier 3 — Integration tests (requires sops)

```bash
npm run test:integration
```

Integration tests create a temporary git repository, generate an age key pair via the `age-encryption` npm package, scaffold a real `clef.yaml`, and run actual SOPS encrypt/decrypt operations. If you ran `npm install` without `--ignore-optional`, the bundled sops is available and no extra setup is needed.

If sops cannot be found, the suite exits with:

```
sops not found. Install sops to run integration tests:
  brew install sops  (macOS)
  See https://github.com/getsops/sops/releases  (Linux)
```

## Local experimentation with real encryption

Try Clef commands against real encrypted files to understand end-to-end behaviour (unit tests are fully mocked):

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

- The private key is stored in the OS keychain or `~/.config/clef/keys/{label}/keys.txt`; label and storage method in `.clef/config.yaml` (gitignored).
- On `could not decrypt` errors, run `clef doctor`.
- `/tmp/clef-playground` is safe for experimentation and cleaned up on restart.

## UI development

Run the Vite dev server and API server separately in two terminals:

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

Vite proxies `/api/*` from `:5173` to `127.0.0.1:7777`. React component changes reflect instantly via hot module replacement.

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

Uses React Testing Library and jsdom. All API calls are mocked; tests use `data-testid` selectors for stability.

## Monorepo structure

```
clef/
├── packages/
│   ├── core/          # Core library — manifest parser, SOPS client, sops
│   │                  #   resolver, matrix manager, schema validator, diff
│   │                  #   engine, bulk ops, git integration, lint runner
│   ├── cli/           # CLI — commander.js commands, output formatter
│   └── ui/            # Web UI — React frontend, Express API server
├── platforms/
│   ├── sops-darwin-arm64/   # Bundled sops binary packages (one per platform)
│   ├── sops-darwin-x64/
│   ├── sops-linux-x64/
│   ├── sops-linux-arm64/
│   └── sops-win32-x64/
├── scripts/
│   └── download-sops.mjs   # Download + verify sops binaries for packaging
├── sops-version.json        # Pinned sops version + SHA256 checksums
├── docs/              # VitePress documentation site
├── www/               # Static marketing site (Astro)
├── package.json       # Root workspace config
└── clef.yaml  # (only in consumer repos, not in Clef source)
```

### packages/core

All business logic; both CLI and UI depend on it:

| Module          | Location                  | Responsibility                                     |
| --------------- | ------------------------- | -------------------------------------------------- |
| ManifestParser  | `src/manifest/parser.ts`  | Load and validate `clef.yaml`                      |
| SopsClient      | `src/sops/client.ts`      | Subprocess wrapper for the `sops` binary           |
| SopsResolver    | `src/sops/resolver.ts`    | Locate sops binary (env, bundled, or system PATH)  |
| MatrixManager   | `src/matrix/manager.ts`   | Resolve file paths, detect missing cells, scaffold |
| SchemaValidator | `src/schema/validator.ts` | Validate decrypted values against schemas          |
| DiffEngine      | `src/diff/engine.ts`      | Cross-environment key comparison                   |
| BulkOps         | `src/bulk/ops.ts`         | Multi-file operations                              |
| GitIntegration  | `src/git/integration.ts`  | Git commit, log, diff, pre-commit hook             |
| LintRunner      | `src/lint/runner.ts`      | Full repo validation                               |

### packages/cli

Commander.js entry point. Each command is a subcommand:

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

- **Frontend:** React SPA (Vite) with four views: matrix, editor, diff, lint.
- **Server:** Express bound to `127.0.0.1`, REST API calling core library functions.

## Platform notes

### Windows

Developed and tested on macOS and Linux. **Windows is supported only via WSL** — native Windows cannot reliably forward Unix signals (`SIGINT`, `SIGTERM`) to child processes, breaking `clef exec`. Install WSL 2 and run all commands inside your WSL distribution.

## Troubleshooting

| Problem                                          | Cause                              | Fix                                                                                          |
| ------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `clef: command not found` after `npm link`       | Node global bin not on PATH        | `export PATH="$(npm config get prefix)/bin:$PATH"`                                           |
| `clef` runs Homebrew version instead of local    | PATH order conflict                | Use direct invocation: `node packages/cli/bin/clef.js`                                       |
| Build errors after `git pull`                    | Dependencies changed               | `npm install` at repo root                                                                   |
| CLI reflects old behaviour after editing core    | Stale core build                   | `npm run build -w packages/core`                                                             |
| `Cannot find module '../dist/index.js'`          | Build step was skipped             | `npm run build`                                                                              |
| `error: could not decrypt`                       | Key not configured or mismatch     | Run `clef doctor`; verify `CLEF_AGE_KEY_FILE` is set and recipient in `clef.yaml` matches    |
| Port 7777 already in use                         | Another `clef ui` instance running | `lsof -ti:7777 \| xargs kill` or use `--port` flag                                           |
| Integration tests fail — sops not found          | sops not bundled or installed      | Re-run `npm install` (without `--ignore-optional`), or `brew install sops`                   |
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
