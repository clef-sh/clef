# Clef — Codebase Review

You are a senior security-focused software engineer conducting
a post-build review of the Clef codebase. You did not write
this code. Approach it with fresh eyes and appropriate
scepticism.

Read `clef-master-brief.md` first to understand the full
specification. Then run:

```bash
find . -name "*.ts" -not -path "*/node_modules/*" \
       -not -path "*/dist/*" \
  | sort
```

Use this to map the full file tree before reviewing anything.
Read every file referenced in each section below before
forming a judgement on that section. Do not rely on memory
of having seen a file — re-read it.

---

## How to work

- Read before you judge. Every section says which files to
  read. Read them.
- Only report problems. Do not summarise what the code does
  correctly. A section with no output means it passed.
- Assign a severity to every issue:
  - **Critical** — security vulnerability or data loss risk
  - **High** — functional defect, broken feature
  - **Medium** — spec deviation, missing behaviour
  - **Low** — quality issue, inaccuracy, minor omission
- For every issue include: file path, line reference if
  possible, description of the problem, and the exact
  change needed to fix it.
- At the end produce a single prioritised fix list —
  Critical first, then High, Medium, Low.

---

## 1. Security Audit

### 1.1 SopsClient — plaintext never touches disk

Read in full:

- `packages/core/src/sops/client.ts`
- The SOPS PDF (attached) — verify the subprocess invocation
  matches documented SOPS behaviour

Check:

- Every code path through `decrypt()` — confirm decrypted
  values flow through stdin/stdout only, never through a
  temp file
- Every code path through `encrypt()` — same check
- Every code path through `reEncrypt()` — same check
- If any temp file is created for any reason, confirm it is
  deleted in a `finally` block and that the deletion is
  tested
- Error paths — if SOPS returns a non-zero exit code, confirm
  the error message does not contain any decrypted value
- Confirm `assertSops()` is called before every operation
  that invokes the SOPS binary

### 1.2 UI server binding

Read:

- `packages/ui/src/server/index.ts`
- `integration/tests/server-binding.test.ts`

Check:

- The server binds to `127.0.0.1` explicitly — not
  `0.0.0.0`, not `localhost` (which can resolve to `::` on
  some systems), not an unspecified address
- The integration test actually attempts a connection on
  a non-loopback address and asserts it fails — not just
  that the address field says `127.0.0.1`
- No middleware or configuration could override the binding

### 1.3 Plaintext in logs and error messages

Read:

- `packages/core/src/sops/client.ts`
- `packages/cli/src/output/formatter.ts`
- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/ui/src/server/api.ts`

Check:

- No `console.log` or `console.error` anywhere that could
  include a decrypted value
- `clef set` confirmation message does not echo the value —
  even in the success case
- `clef exec` error paths do not include any injected
  environment variable values in the error message
- API error responses do not include decrypted values
- Search for any `.toString()` calls on objects that might
  contain secret values

### 1.4 `clef exec` security

Read:

- `packages/cli/src/commands/exec.ts`
- `packages/core/src/consumption/client.ts`

Check:

- Values are injected via environment object passed to
  `spawn`, never via shell interpolation or command string
  construction
- `ps aux` cannot reveal secret values — confirm spawn is
  used with `env` option, not shell: true
- Signal forwarding: SIGINT → 130, SIGTERM → 143 —
  confirm the exit code mapping is correct
- `--only` flag correctly filters keys — no extra keys leak
  into the child environment
- The `--` separator detection is robust — test that a
  command containing `--` in its arguments works correctly

### 1.5 `clef export` security

Read:

- `packages/cli/src/commands/export.ts`

Check:

- `--format dotenv` and `--format json` and `--format yaml`
  are all rejected with clear explanations — not just
  "unsupported format"
- `--output <file>` flag does not exist — if it does, that
  is a Critical issue
- The Linux `/proc/<pid>/environ` warning goes to stderr,
  not stdout — confirm `eval $(clef export ...)` is not
  corrupted by the warning
- Values are single-quoted correctly — a value containing
  a single quote is escaped as `'\''`

### 1.6 Pending values security

Read:

- `packages/core/src/pending/metadata.ts`
- `packages/ui/src/server/api.ts` — the `{ random: true }`
  handler specifically

Check:

- `.clef-meta.yaml` files contain only key names and
  timestamps — never the random placeholder values
  themselves
- `generateRandomValue()` uses `crypto.randomBytes(32)` —
  not `Math.random()`, not `uuid`, not any other source
- The random value is generated in the API handler
  server-side — not in the React client. Check the React
  component sends `{ random: true }` to the API, not a
  generated value
- `markPending` and the corresponding encrypt call are
  handled atomically — what happens if encrypt succeeds
  but `markPending` fails?

### 1.7 `clef doctor --fix`

Read:

- `packages/cli/src/commands/doctor.ts`

Check:

- `--fix` calls the init core library function directly —
  no `program.parseAsync`, no `execSync`, no `spawn`
- If a subprocess call of any kind is found in the --fix
  path, that is a High issue

---

## 2. Correctness Audit

### 2.1 Exit codes

Read:

- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/lint.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/export.ts`
- `packages/cli/src/commands/doctor.ts`

Check:

- `clef diff` exits 1 when differences exist, 0 when none —
  this makes it scriptable
- `clef lint` exits 1 on errors, 0 when only warnings or
  clean — warnings must not cause exit 1
- `clef exec` exits with the exact exit code of the child
  process — not 0 on child failure, not always 1
- `clef doctor` exits 1 if any check fails, 0 if all pass
- All commands exit 1 on unexpected errors — no silent
  failures

### 2.2 `clef set` pending resolution

Read:

- `packages/cli/src/commands/set.ts`
- `packages/core/src/pending/metadata.ts`

Check:

- A normal `clef set` (without `--random`) on a pending key
  calls `markResolved` automatically
- A `clef set --random` on an already-pending key correctly
  updates the `since` timestamp in `.clef-meta.yaml`
- `clef set VALUE --random` (both value and flag) produces
  a clear error and does not proceed

### 2.3 Protected environment confirmation

Read:

- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/delete.ts`
- `packages/cli/src/commands/rotate.ts`
- `packages/core/src/manifest/parser.ts`

Check:

- Every write operation on a `protected: true` environment
  prompts for confirmation — not just `clef set`
- `clef delete` on a protected environment requires
  confirmation
- `clef rotate` on a protected environment requires
  confirmation
- `clef exec` on a protected environment warns but does not
  block — exec is a read operation, not a write
- `clef set --random` on a protected environment also
  requires confirmation

### 2.4 `clef exec` exit code forwarding

Read:

- `packages/cli/src/commands/exec.ts`
- `integration/tests/exec-roundtrip.test.ts`

Check:

- The integration test actually runs a real child process
  that exits with a known code and asserts the parent exits
  with the same code
- Exit code 42 test exists and passes
- Exit code 0 test exists (success case)
- Signal exit codes: SIGINT → 130, SIGTERM → 143

### 2.5 `clef init --random-values` schema requirement

Read:

- `packages/cli/src/commands/init.ts`
- `docs/cli/init.md`

Check:

- Namespaces without a schema are skipped with a message
  pointing to `clef set --random`
- The docs clearly explain the four-step workflow:
  init → create schemas → reference in manifest →
  run --random-values
- Optional keys are skipped unless `--include-optional` is
  passed

### 2.6 Dependency version checks

Read:

- `packages/core/src/dependencies/checker.ts`

Check:

- Version string parsers match the exact format each binary
  outputs — sops, age, and git all output differently
- `checkAll()` uses `Promise.all` not sequential awaits
- `assertSops()` is called in SopsClient before every
  operation
- `assertAge()` is called when the manifest backend is age
- Missing binary returns null, does not throw

### 2.7 Multi-namespace exec (`--also` flag)

Read:

- `packages/cli/src/commands/exec.ts`
- `packages/core/src/consumption/client.ts`

Check:

- Later `--also` entries override earlier ones for duplicate
  keys
- `--no-override` applies across all sources including
  `--also` entries
- A decryption failure on any `--also` source produces a
  clean error and no partial environment is injected into
  the child process

### 2.8 `--repo` flag

Read all command files in `packages/cli/src/commands/`.

Check:

- `--repo` flag exists on every command
- It correctly overrides the auto-detected repo root in
  every command
- Tests cover `--repo` on at least three commands

---

## 3. Completeness Audit

### 3.1 Functional requirements cross-reference

Read `clef-master-brief.md` sections 3.1 through 3.7.
Cross-reference every requirement FR-01 through FR-32
against the implementation.

For each requirement state: Implemented / Partial /
Missing. Only report Partial and Missing items.

### 3.2 CLI completeness

Run:

```bash
find packages/cli/src/commands -name "*.ts" \
  -not -name "*.test.ts" | sort
```

Check every command has:

- `--help` text with accurate description
- All flags documented with types and defaults
- Consistent error message format
- Correct exit codes

### 3.3 Pending values completeness

Check:

- `clef set --random` generates pending value and records
  it in `.clef-meta.yaml`
- `clef set` (normal) on pending key calls `markResolved`
- `clef init --random-values` scaffolds schema namespaces
- UI `+ Add key` row supports Random mode
- UI overflow menu has `Reset to random (pending)`
- UI pending rows show amber `PENDING` badge
- Matrix view shows `pendingCount` when > 0
- Lint reports pending keys as warnings
- `.clef-meta.yaml` is not in `.gitignore`
- `.gitignore` has explicit comment blocking future addition

### 3.4 Integration tests

Read `integration/tests/`.

Check:

- Server binding test attempts connection on non-loopback
  and asserts failure
- `exec-roundtrip` test runs with real SOPS binary
- `export-roundtrip` test runs with real SOPS binary
- CI workflow installs sops and age before running
  `test:integration`
- Integration tests clean up temp files in `afterAll`
  with try/finally

### 3.5 Design decision — no unencrypted namespaces

Check all four locations:

- `docs/guide/concepts.md` — clear statement in namespace
  section
- `docs/contributing/architecture.md` — Design Decisions
  section with full rationale
- `CONTRIBUTING.md` — reference to design decisions doc
- `packages/core/src/manifest/parser.ts` — comment at
  namespace validation logic

All four must be present. Missing any one is a Medium issue.

---

## 4. Test Quality Audit

### 4.1 Coverage genuineness

Read a sample of test files — pick three from core, two
from CLI, two from UI. For each:

- Are assertions testing behaviour or just that code ran?
- Are error branches tested, not just happy paths?
- Are mock assertions verifying the right calls were made
  with the right arguments?

Flag any test that passes without actually asserting the
behaviour it claims to test.

Check that Button usages in tests use data-testid not getByText for behavioural assertions.

### 4.2 Security-critical test coverage

Check specifically:

- A test asserting `clef set` does NOT print the value
  in its output — not just that it prints something
- A test asserting `clef exec` does NOT include env var
  values in error output when child fails to start
- A test asserting `generateRandomValue` uses
  `crypto.randomBytes` — not just that it returns a string
- A test asserting the Linux `clef export` warning goes
  to stderr not stdout
- A test asserting `--format dotenv` is rejected with an
  explanation, not just an error

### 4.3 Pending state atomicity

Read:

- `packages/cli/src/commands/set.ts` — the --random path
- `packages/core/src/pending/metadata.ts`

Check:

- Is there a test for the case where encrypt succeeds but
  `markPending` fails? What happens?
- Is there a test for the case where encrypt fails? Does
  `markPending` get called anyway?

---

## 5. Documentation Accuracy Audit

### 5.1 CLI reference accuracy

Pick three CLI pages at random from `docs/cli/`. For each:

- Read the docs page
- Read the corresponding command implementation
- Verify every flag documented actually exists in the code
- Verify every flag in the code is documented
- Verify every example command works as written

Flag any inaccuracy as a Low issue (High if the example
would cause data loss or a security problem).

### 5.2 CI/CD guide accuracy

Read `docs/guide/ci-cd.md` in full.

Check:

- The GitHub Actions examples use correct action syntax
- The two-checkout Pattern B example is accurate
- The `SOPS_AGE_KEY` environment variable name is correct
  per the SOPS documentation
- The IAM policy example grants minimum necessary permissions
- Every `clef` command in the examples exists and has the
  flags shown

### 5.3 Quick start accuracy

Read `docs/guide/quick-start.md`.

Follow every command exactly as written. Would a new user
following this guide get a working setup? Flag any command
that would fail or require steps not shown.

### 5.4 Pending values guide accuracy

Read `docs/guide/pending-values.md`.

Check:

- The four-step `--random-values` workflow is present and
  accurate
- The `.clef-meta.yaml` format shown matches the actual
  implementation
- The FAQ answers are correct

---

## Output Format

For each section produce findings only — no passing
commentary.

Format each finding as:

```
[SEVERITY] file/path.ts (line N if known)
Problem: what is wrong
Fix: exact change needed
```

At the end produce the consolidated fix list sorted by
severity. This is the only output a developer needs to
act on. Everything else is noise.
