# Testing

Clef follows strict testing practices to ensure reliability and security. Every meaningful behaviour is covered by a unit test, and all tests run entirely offline — no real KMS providers, no live git remotes, no actual SOPS binaries.

## Philosophy

1. **All subprocess calls are mocked.** The `SubprocessRunner` interface is the boundary between Clef and external binaries. In tests, a mock implementation returns predefined results. No real `sops` or `git` processes are spawned.
2. **Tests run offline.** No network access, no cloud services, no external dependencies beyond Node.js.
3. **Coverage is enforced.** Coverage thresholds are configured in Jest and checked in CI. Regressions are blocked.
4. **Tests live alongside source.** Each module has a co-located `.test.ts` file (e.g., `parser.ts` and `parser.test.ts`).

## Running tests

```bash
# Run all unit tests
npm test

# Run tests for a specific package
npm test --workspace=packages/core
npm test --workspace=packages/cli
npm test --workspace=packages/ui

# Run with coverage report
npm test -- --coverage

# Run in watch mode during development
npm test -- --watch
```

## Test structure

### Core library tests

Each core module has a test file that validates all code paths:

| Module             | Test file                          | What is tested                                                                                |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| ManifestParser     | `src/manifest/parser.test.ts`      | Valid manifests, invalid manifests, missing fields, duplicate names, unknown fields           |
| SopsClient         | `src/sops/client.test.ts`          | Decrypt success/failure, encrypt success/failure, re-encrypt, metadata parsing, key detection |
| MatrixManager      | `src/matrix/manager.test.ts`       | Matrix resolution, missing cells, scaffolding, protected environment detection                |
| SchemaValidator    | `src/schema/validator.test.ts`     | All type validations, required/optional, pattern matching, undeclared keys, max exceeded      |
| DiffEngine         | `src/diff/engine.test.ts`          | Changed/identical/missing-a/missing-b classifications                                         |
| BulkOps            | `src/bulk/ops.test.ts`             | Bulk set, bulk delete across all environments                                                 |
| GitIntegration     | `src/git/integration.test.ts`      | Commit, status, log, diff, hook installation                                                  |
| LintRunner         | `src/lint/runner.test.ts`          | Full validation runs, fix mode, issue severity classification                                 |
| ScanRunner         | `src/scanner/index.test.ts`        | Secret scanning, staged mode, .clefignore integration                                         |
| ScanPatterns       | `src/scanner/patterns.test.ts`     | Entropy calculation, pattern matching for known secret formats                                |
| ScanIgnore         | `src/scanner/ignore.test.ts`       | .clefignore parsing, path matching, comment handling                                          |
| ImportRunner       | `src/import/index.test.ts`         | Import orchestration, format detection, namespace/environment targeting                       |
| ImportParsers      | `src/import/parsers.test.ts`       | .env, JSON, YAML format parsing                                                               |
| RecipientManager   | `src/recipients/index.test.ts`     | Recipient listing, addition, removal from .sops.yaml                                          |
| RecipientValidator | `src/recipients/validator.test.ts` | Age key format validation                                                                     |
| ConsumptionClient  | `src/consumption/client.test.ts`   | Secret resolution for exec/export                                                             |
| PendingMetadata    | `src/pending/metadata.test.ts`     | markPending, markResolved, retry logic                                                        |
| DependencyChecker  | `src/dependencies/checker.test.ts` | Version parsing, satisfaction checks for sops and git                                         |
| AgeKeygen          | `src/age/keygen.test.ts`           | Key pair generation                                                                           |
| GitRemote          | `src/git/remote.test.ts`           | Remote repo cloning, fetching, cache management                                               |

### CLI tests

Each command has a test file that validates argument parsing, output formatting, and error handling:

| Command           | Test file                         |
| ----------------- | --------------------------------- |
| `clef init`       | `src/commands/init.test.ts`       |
| `clef get`        | `src/commands/get.test.ts`        |
| `clef set`        | `src/commands/set.test.ts`        |
| `clef delete`     | `src/commands/delete.test.ts`     |
| `clef diff`       | `src/commands/diff.test.ts`       |
| `clef lint`       | `src/commands/lint.test.ts`       |
| `clef rotate`     | `src/commands/rotate.test.ts`     |
| `clef hooks`      | `src/commands/hooks.test.ts`      |
| `clef exec`       | `src/commands/exec.test.ts`       |
| `clef export`     | `src/commands/export.test.ts`     |
| `clef ui`         | `src/commands/ui.test.ts`         |
| `clef doctor`     | `src/commands/doctor.test.ts`     |
| `clef import`     | `src/commands/import.test.ts`     |
| `clef update`     | `src/commands/update.test.ts`     |
| `clef scan`       | `src/commands/scan.test.ts`       |
| `clef recipients` | `src/commands/recipients.test.ts` |

### UI tests

- **React components** are tested with React Testing Library and jsdom
- **API routes** are tested with supertest against the Express server

## Mocking pattern

The dependency injection pattern centres on the `SubprocessRunner` interface:

```typescript
// In production code
const runner = new NodeSubprocessRunner(); // uses child_process.spawn
const sopsClient = new SopsClient(runner);

// In test code
const mockRunner: SubprocessRunner = {
  run: jest.fn().mockResolvedValue({
    stdout: "decrypted: yaml content",
    stderr: "",
    exitCode: 0,
  }),
};
const sopsClient = new SopsClient(mockRunner);
```

This allows testing all SOPS interactions without the `sops` binary installed. The mock runner can simulate:

- Successful decryption (return decrypted YAML on stdout)
- Decryption failures (non-zero exit code with stderr message)
- Missing keys (specific error messages in stderr)
- Encryption (verify the correct args and stdin were passed)

## Integration tests

Integration tests live in the `integration/` directory at the repo root and are excluded from the default `npm test` run. They require the `sops` binary installed on your machine. Age key pairs are generated via the `age-encryption` npm package — no `age` binary is required.

### Prerequisites

```bash
# macOS
brew install sops

# Linux (Debian/Ubuntu)
# Download sops from https://github.com/getsops/sops/releases
```

### Running integration tests

```bash
npm run test:integration
```

If `sops` is not found in PATH, the tests will fail with a clear message explaining what to install.

### What the integration tests cover

| Test                    | File                             | Why integration-only                                                                               |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Server binding          | `tests/server-binding.test.ts`   | Requires an actual network socket to verify `127.0.0.1`-only binding                               |
| `clef exec` roundtrip   | `tests/exec-roundtrip.test.ts`   | Encrypts with real SOPS, then verifies `clef exec` injects the correct values into a child process |
| `clef export` roundtrip | `tests/export-roundtrip.test.ts` | Encrypts with real SOPS, then verifies `clef export` outputs correctly formatted export statements |

### Server binding test

The server binding test verifies that the UI server binds exclusively to `127.0.0.1` and does not listen on `0.0.0.0` or any external interface. This test lives in the integration suite rather than unit tests because it requires an actual network socket. It is excluded from the standard `npm test` run to keep unit tests fast and dependency-free.

### Exec and export roundtrip tests

These tests use real age keys (generated via the `age-encryption` npm package) and real `sops` encryption to verify the full decrypt-and-consume pipeline. They scaffold a temporary repo with a manifest and encrypted files, run `clef exec` or `clef export` against them, and verify the output. All temporary files are cleaned up after each test run, including on failure.

## Test coverage philosophy

Clef uses a tiered coverage model. The goal is tests that
verify behaviour, not tests that execute lines.

### Tier 1 — Security and correctness critical

Some modules handle encryption, secret values, or state
where a silent failure would be a security issue or
invisible data loss. These modules are marked with a
comment at the top of the file and carry a higher
coverage threshold (95% lines/functions, 90% branches).

The threshold is a floor, not a target. The real
standard for Tier 1 modules is: every public function
has tests for its happy path, all documented error
paths, and at least one boundary case. A reviewer
reading the test file should be able to understand
exactly what the module guarantees.

Current Tier 1 modules:

- `sops/client.ts` — SOPS subprocess calls and error handling
- `pending/metadata.ts` — markPending and retry logic
- `scanner/patterns.ts` — entropy calculation and pattern matching
- `diff/engine.ts` — value masking in diff output
- `manifest/parser.ts` — manifest validation and parsing

### Tier 2 — Behavioural coverage

Everything else carries an 80% global threshold. The
expectation is: every command, route, and component
has tests for its primary behaviour and its most likely
failure modes. Trivial code does not need dedicated tests.

What counts as trivial: simple property accessors, type
guard functions with no logic, log and formatting output,
pass-through wrappers with no conditional logic.

What does not count as trivial: any code path that
handles user input, any code path that touches the
filesystem or a subprocess, any code path that produces
output the user sees.

### What the CI gate enforces

The CI build fails if Jest thresholds are breached. It
does not fail on a coverage drop that stays within
thresholds. Coverage is reported as a summary on every
PR — reviewers can see it but a one-point drop on a
cli command does not block a merge.

### Running coverage locally

```bash
# All packages
npm run test:coverage

# Single package
npm run test:coverage -w packages/core

# See which lines are uncovered
open coverage/lcov-report/index.html
```

### What we do not measure

Integration tests (`npm run test:integration`) do not
contribute to coverage metrics. They verify end-to-end
correctness with real SOPS. Coverage
is not the right lens for integration tests.

## Writing new tests

When adding a new feature:

1. Create or update the `.test.ts` file alongside the source file
2. Mock all subprocess calls via the `SubprocessRunner` interface
3. Test both success and error paths
4. Test edge cases (empty inputs, missing fields, malformed data)
5. Verify that error messages are actionable (tell the user what went wrong and what to do)
6. Run `npm test` to confirm all tests pass before opening a PR
