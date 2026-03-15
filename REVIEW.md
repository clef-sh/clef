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

### 1.2 UI server binding and authentication

Read:

- `packages/ui/src/server/index.ts`
- `packages/ui/src/server/auth.test.ts`
- `integration/tests/server-binding.test.ts`

Check:

- The server binds to `127.0.0.1` explicitly — not
  `0.0.0.0`, not `localhost` (which can resolve to `::` on
  some systems), not an unspecified address
- The integration test actually attempts a connection on
  a non-loopback address and asserts it fails — not just
  that the address field says `127.0.0.1`
- No middleware or configuration could override the binding
- Host header validation rejects requests where Host is not
  `127.0.0.1` — returns 403
- Bearer token authentication is required on all `/api`
  routes — token is 64 hex characters (256 bits entropy)
- Missing token returns 401, wrong token returns 401

### 1.3 Plaintext in logs and error messages

Read:

- `packages/core/src/sops/client.ts`
- `packages/cli/src/output/formatter.ts`
- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/merge-driver.ts`
- `packages/cli/src/commands/service.ts`
- `packages/cli/src/commands/bundle.ts`
- `packages/core/src/service-identity/manager.ts`
- `packages/core/src/bundle/generator.ts`
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
- `clef merge-driver` conflict output shows key names and
  plaintext values to stderr — confirm this is intentional
  (user needs values to resolve conflicts) and that error
  paths (e.g. decryption failure) do not leak values
- `clef service create` and `clef service rotate` print
  private keys to stdout intentionally — confirm error paths
  during key generation do not leak partial key material
- `clef bundle` error paths do not include decrypted values
  from the secrets being bundled — only key names and
  encrypted content references are safe to log

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

### 1.8 Merge driver — plaintext handling

Read:

- `packages/cli/src/commands/merge-driver.ts`
- `packages/core/src/merge/driver.ts`

Check:

- Decryption of base/ours/theirs files uses SopsClient
  (stdin/stdout only) — no temp plaintext files created
- Re-encryption of merged result uses SopsClient — merged
  plaintext is never written to disk unencrypted
- If re-encryption fails, the error message does not
  include the merged plaintext values
- The three-way merge operates on in-memory key/value maps
  only — no intermediate files
- SOPS MAC is valid on the re-encrypted output — confirm
  SOPS verifies integrity on re-encryption

### 1.9 Service identity — private key handling

Read in full:

- `packages/core/src/service-identity/manager.ts`
- `packages/cli/src/commands/service.ts`
- `packages/core/src/age/keygen.ts`

Check — Key generation:

- `generateAgeIdentity()` uses the `age-encryption` package
  (FiloSottile's spec-compliant implementation) — not
  `crypto.randomBytes` directly, not any custom key derivation
- One keypair is generated **per environment** — confirm no key
  sharing across environments
- The secret key string is never assigned to any object that
  persists beyond the `create` or `rotate` function scope

Check — Private key output:

- `clef service create` prints private keys to stdout exactly
  once — confirm they are not written to any file, not stored
  in `clef.yaml`, not stored in `.clef-meta.yaml`, not stored
  in `.clef/config.yaml`
- The output includes a clear warning that keys are shown once
  and must be stored in a secret manager immediately
- After `create` returns, no in-memory reference to the private
  keys remains — they are not cached or logged
- `clef service show` displays only public keys (age1...) —
  never secret keys. Confirm no code path in `show` accesses
  private key material
- `clef service list` displays truncated public key previews
  only — confirm truncation uses `keyPreview()` or equivalent

Check — Key rotation:

- `clef service rotate` generates new keypairs and prints new
  private keys — same one-time output rules as `create`
- Old private keys are not referenced or displayed during
  rotation
- Old public keys are removed from SOPS recipient lists before
  new ones are added — confirm the remove-then-add ordering
  prevents a window where both old and new keys can decrypt
- Rotation of a single environment (`--environment`) does not
  affect other environments' keys

Check — Recipient registration security:

- `registerRecipients()` only adds the identity's public key
  to SOPS files within the identity's declared namespace scope
- A service identity scoped to `[api]` must NOT have its
  recipient registered on `database/*.enc.yaml` files — any
  scope leakage is a Critical issue
- Recipient removal during rotation only removes the identity's
  own old key — not other recipients

### 1.10 Bundle generation — plaintext handling

Read in full:

- `packages/core/src/bundle/generator.ts`
- `packages/core/src/bundle/runtime.ts`
- `packages/cli/src/commands/bundle.ts`

Check — Plaintext never touches disk:

- `BundleGenerator.generate()` decrypts scoped SOPS files into
  an in-memory key/value map — confirm no temp files are
  created during decryption
- The merged plaintext JSON blob is age-encrypted in memory
  before being written to the output file — the output `.mjs`
  or `.cjs` file must contain only the armored age ciphertext,
  never plaintext values
- If age encryption fails, the error message does not include
  any plaintext values from the decrypted secrets
- The plaintext map is not logged, not written to any debug
  output, and not included in any error object

Check — Bundle output security:

- The generated module embeds age-encrypted ciphertext and key
  names only — no plaintext values
- The `KEYS` array exported by the bundle contains key names
  (which are not secret) — confirm no values are in this array
- The `--output` path is validated — confirm it does not write
  to locations inside the git worktree without warning (bundles
  should never be committed). Check if a `.gitignore` warning
  is emitted
- Multi-namespace bundles prefix keys with `namespace/` — a
  namespace collision (e.g. key `foo` in two namespaces)
  must not silently overwrite

Check — Runtime module security:

- The `keyProvider` function is called at most once (cold start)
  — confirm the private key is not stored after decryption,
  only the decrypted values map is cached
- Concurrent cold-start calls are deduplicated — not called
  multiple times in parallel
- The runtime does not import `fs`, `child_process`, or any
  Node module that could write to disk — only `age-encryption`

### 1.11 Bundled sops binary — supply chain and resolution

Read in full:

- `packages/core/src/sops/resolver.ts`
- `packages/core/src/sops/resolver.test.ts`
- `packages/core/src/sops/client.ts` — constructor and
  `sopsCommand` usage
- `packages/core/src/dependencies/checker.ts` — sops
  resolution path in `checkDependency`
- `sops-version.json`
- `scripts/download-sops.mjs`
- `.github/workflows/publish-sops.yml`
- All `platforms/sops-*/package.json` files

Check — Supply chain integrity:

- `sops-version.json` contains SHA256 checksums for every
  platform binary. Verify the checksum format is a full
  64-character hex digest — not truncated, not base64
- `download-sops.mjs` computes SHA256 of the downloaded
  binary and compares against the checksum in
  `sops-version.json`. If they do not match, the script
  must `process.exit(1)` — not warn and continue
- The download URL is constructed from the version in
  `sops-version.json` — not from user input or environment
  variables. The URL must point to
  `github.com/getsops/sops/releases` exclusively
- The `publish-sops.yml` workflow verifies
  `sops-version.json` matches the workflow input before
  downloading — a mismatch must fail the workflow
- The `publish-sops.yml` workflow runs the downloaded
  binary (`sops --version`) to verify it is a real
  executable — not just a random file that passed checksum
- Platform packages are published with `--provenance` to
  enable npm audit trail

Check — Resolution order security:

- `resolveSopsPath()` checks `CLEF_SOPS_PATH` first —
  this is the explicit override and must take precedence
- The bundled package is resolved via `require.resolve()` —
  confirm the resolved path is within a `node_modules`
  directory. A path traversal or symlink attack that
  resolves outside `node_modules` would be a Critical issue
- The system PATH fallback returns bare `"sops"` — confirm
  this string is never interpolated into a shell command.
  It must be passed as the first argument to
  `SubprocessRunner.run()` which uses `execFile` (not
  `exec`)
- The resolution result is cached module-wide. Confirm
  `resetSopsResolution()` exists and is only called in test
  files — not in production code. A production call would
  allow resolution cache poisoning

Check — SopsClient integration:

- `SopsClient` constructor accepts optional `sopsPath` as
  the 4th parameter. When omitted, it calls
  `resolveSopsPath().path` — confirm this default is
  applied in the constructor, not lazily
- Every `this.runner.run(...)` call in SopsClient uses
  `this.sopsCommand` — search for any remaining hardcoded
  `"sops"` string passed to `runner.run()`. Any occurrence
  is a High issue (bundled binary would be bypassed)
- `assertSops(this.runner)` still works with the resolved
  path — confirm `checkDependency("sops", runner)` uses
  the resolved path, not a hardcoded `"sops"`

Check — Platform package correctness:

- Each platform `package.json` has correct `os` and `cpu`
  fields matching npm's platform filtering
- The `files` array includes only the binary and license —
  no extra files that could be a vector
- All packages use `"license": "MPL-2.0"` (sops is
  MPL-2.0, not MIT)
- Version in each platform `package.json` matches the
  version in `sops-version.json`
- The `@clef-sh/cli` `optionalDependencies` versions match
  the platform package versions exactly

Check — `CLEF_SOPS_PATH` validation:

- If `CLEF_SOPS_PATH` is set to a nonexistent path, the
  resolver returns it without checking — confirm
  `assertSops()` catches this at version-check time with a
  `SopsMissingError`, not a silent failure
- If `CLEF_SOPS_PATH` contains shell metacharacters or
  spaces, confirm the path is passed to `execFile` (which
  does not interpret shell syntax) — not to `exec`

---

## 2. Correctness Audit

### 2.1 Exit codes

Read:

- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/lint.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/export.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/update.ts`
- `packages/cli/src/commands/scan.ts`
- `packages/cli/src/commands/merge-driver.ts`

Check:

- `clef diff` exits 1 when differences exist, 0 when none —
  this makes it scriptable
- `clef lint` exits 1 on errors, 0 when only warnings or
  clean — warnings must not cause exit 1
- `clef exec` exits with the exact exit code of the child
  process — not 0 on child failure, not always 1
- `clef doctor` exits 1 if any check fails, 0 if all pass
- `clef update` exits 0 when all cells present or newly
  scaffolded, exits 1 on error
- `clef scan` exits 0 when no issues, 1 when issues found,
  2 on scan failure
- `clef merge-driver` exits 0 on clean merge (re-encrypted),
  1 on conflicts or errors
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
- `integration/tests/exec-signal.test.ts`

Check:

- The integration test actually runs a real child process
  that exits with a known code and asserts the parent exits
  with the same code
- Exit code 42 test exists and passes
- Exit code 0 test exists (success case)
- Signal exit codes: SIGINT → 130, SIGTERM → 143
- `exec-signal.test.ts` sends real SIGTERM and SIGINT to
  a running `clef exec` process and verifies the translated
  exit codes

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
- `packages/core/src/sops/resolver.ts`

Check:

- Version string parsers match the exact format each binary
  outputs — sops, age, and git all output differently
- `checkAll()` uses `Promise.all` not sequential awaits
- `assertSops()` is called in SopsClient before every
  operation
- `assertAge()` is called when the manifest backend is age
- Missing binary returns null, does not throw
- `checkDependency("sops", ...)` uses `resolveSopsPath()`
  to determine the command — not a hardcoded `"sops"` string
- The resolved path is passed through to `DependencyVersion`
  via `source` and `resolvedPath` fields

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

### 2.8 `--dir` flag

Read all command files in `packages/cli/src/commands/`.
Read `packages/cli/src/index.ts` — the global option
registration.

Check:

- `--dir` flag exists on every command (all 19)
- It correctly overrides the auto-detected repo root in
  every command
- Tests cover `--dir` on at least three commands

### 2.9 Merge driver correctness

Read:

- `packages/cli/src/commands/merge-driver.ts`
- `packages/core/src/merge/driver.ts`
- `packages/core/src/merge/driver.test.ts`

Check:

- `clef merge-driver` accepts three positional arguments
  (`<base>`, `<ours>`, `<theirs>`) matching git's merge
  driver protocol (`%O`, `%A`, `%B`)
- Three-way merge algorithm correctly handles all scenarios:
  - Unchanged keys preserved
  - One-sided changes (ours only, theirs only) applied
  - Both sides changed to same value — take it
  - Both sides changed to different values — conflict
  - Key additions on one side applied
  - Key additions on both sides with same value — clean
  - Key additions on both sides with different values —
    conflict
  - Key deletions on one or both sides handled correctly
  - Delete vs. modify on same key — conflict
- Repo root detection walks up from file to find
  `clef.yaml` — handles invocation from git hooks
- Age key resolution follows same env/config pattern as
  other commands
- Re-encrypted output has valid SOPS MAC

### 2.10 Service identity correctness

Read:

- `packages/core/src/service-identity/manager.ts`
- `packages/cli/src/commands/service.ts`
- `packages/core/src/manifest/parser.ts`

Check — `clef service create`:

- Creating an identity with a namespace not in the manifest
  produces a clear error and does not modify `clef.yaml`
- Creating an identity with a duplicate name produces an
  error — not a silent overwrite
- The manifest is updated atomically — if recipient
  registration fails partway through, `clef.yaml` is not left
  in a half-updated state with some environments registered
  and others missing
- All declared environments get a keypair — if three
  environments exist (dev, staging, production), three
  keypairs are generated. Missing any one is a High issue

Check — `clef service rotate`:

- `--environment` flag correctly targets a single environment
  — other environments' keys remain unchanged in the manifest
- Rotating all environments (no `--environment` flag) replaces
  every key in the identity's `environments` map
- After rotation, the identity's recipient in all scoped
  SOPS files matches the new public key — confirm by checking
  that old recipient removal and new recipient addition both
  succeed or both fail (transactional)
- Rotating a nonexistent identity produces a clear error

Check — `clef service validate` / drift detection:

- `missing_environment` is detected when a new environment is
  added to the manifest but the identity has no key for it
- `namespace_not_found` is detected when a scoped namespace
  is removed from the manifest
- `recipient_not_registered` is detected when the identity's
  public key is missing from a SOPS file's recipient list
  within its scope
- `scope_mismatch` is detected when the identity's public key
  appears in a SOPS file outside its declared namespace scope
- Each issue includes a `fixCommand` suggestion where
  applicable
- `clef lint` automatically runs service identity validation
  when `service_identities` is present in the manifest

Check — Protected environment interaction:

- `clef service create` on a manifest with `protected: true`
  environments — does it prompt for confirmation before
  modifying protected environment SOPS files?
- `clef service rotate` on a protected environment — does it
  require confirmation?

### 2.11 Bundle generation correctness

Read:

- `packages/core/src/bundle/generator.ts`
- `packages/core/src/bundle/runtime.ts`
- `packages/cli/src/commands/bundle.ts`

Check:

- `clef bundle <identity> <environment>` with a nonexistent
  identity produces a clear error
- `clef bundle <identity> <environment>` with a nonexistent
  environment produces a clear error
- The bundle encrypts to the identity's public key for the
  specified environment — not the developer's key, not a
  hardcoded key
- Single-namespace identities produce flat key names (e.g.
  `DATABASE_URL`); multi-namespace identities produce prefixed
  keys (e.g. `api/STRIPE_KEY`) — confirm the logic is based
  on `identity.namespaces.length`
- `--format esm` produces valid ES module syntax with
  `export` statements
- `--format cjs` produces valid CommonJS syntax with
  `module.exports`
- The `--output` flag is required — omitting it produces a
  clear error, not output to stdout (which would expose
  encrypted content in terminal history)
- Exit codes: 0 on success, 1 on error

### 2.12 `clef update` correctness

Read:

- `packages/cli/src/commands/update.ts`
- `packages/cli/src/commands/update.test.ts`

Check:

- `clef update` identifies missing matrix cells
  (namespace × environment combinations without files)
- Each missing cell is scaffolded individually via
  `MatrixManager.scaffoldCell()`
- Partial scaffolding failures produce warnings but do not
  abort the entire operation
- Missing manifest produces a clear error and exit 1
- Age key file is read from `.clef/config.yaml` when
  present and no env vars override
- SOPS dependency errors are handled via
  `formatDependencyError()`
- Command is idempotent — running twice produces no changes
  on second run

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

Expect 19 command files: init, get, set, delete, diff,
lint, rotate, hooks, exec, export, import, doctor, update,
scan, recipients, ui, merge-driver, service, bundle.

Check every command has:

- `--help` text with accurate description
- All flags documented with types and defaults
- Consistent error message format
- Correct exit codes
- Co-located `.test.ts` file with meaningful assertions

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
- `exec-signal` test sends real SIGTERM/SIGINT and
  verifies translated exit codes (130, 143)
- `export-roundtrip` test runs with real SOPS binary
- CI workflow installs sops and age before running
  `test:integration`
- Integration tests clean up temp files in `afterAll`
  with try/finally
- All integration tests call `checkSopsAvailable()` in
  `beforeAll()` to skip gracefully when SOPS is not
  installed

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

### 3.6 Merge driver completeness

Check:

- `clef merge-driver` command is registered in
  `packages/cli/src/index.ts`
- `clef hooks install` configures `.gitattributes` with
  the merge driver pattern for `.enc.yaml` / `.enc.json`
- `clef hooks install` configures `.git/config` with the
  merge driver command (`clef merge-driver %O %A %B`)
- `clef doctor` includes a merge driver check — verifies
  `.gitattributes` and `.git/config` are correctly set up
- `docs/guide/merge-conflicts.md` explains the problem,
  solution, setup, and security invariants
- `docs/cli/hooks.md` documents merge driver installation

### 3.7 Service identity and bundle completeness

Check — CLI registration:

- `clef service` command is registered in
  `packages/cli/src/index.ts` with subcommands: `create`,
  `list`, `show`, `rotate`, `validate`
- `clef bundle` command is registered in
  `packages/cli/src/index.ts`
- Both commands have co-located `.test.ts` files with
  meaningful assertions
- Both commands support `--dir` flag

Check — Core exports:

- `ServiceIdentityManager` is exported from
  `packages/core/src/index.ts`
- `BundleGenerator` and `generateRuntimeModule` are exported
  from `packages/core/src/index.ts`
- All related types are exported: `ServiceIdentityDefinition`,
  `ServiceIdentityEnvironmentConfig`,
  `ServiceIdentityDriftIssue`, `BundleConfig`, `BundleResult`

Check — Manifest integration:

- `ManifestParser` accepts optional `service_identities` array
  in `clef.yaml`
- Parser validates: unique identity names, namespace references
  exist, all environments have entries
- A manifest without `service_identities` continues to work
  unchanged — no breaking change to existing repos

Check — Lint integration:

- `clef lint` reports service identity drift issues when
  `service_identities` is present
- Drift issues have appropriate severity: `missing_environment`
  and `recipient_not_registered` are errors;
  `scope_mismatch` is a warning
- Each drift issue includes a `fixCommand` in the lint output
  where applicable

Check — Documentation:

- `docs/guide/service-identities.md` exists with:
  - Concept explanation (what, why, when to use)
  - Complete workflow (create → store → bundle → deploy)
  - Key provider examples for AWS, GCP, Vault
  - Multi-namespace key prefixing explained
  - Rotation and recovery procedures
- `docs/cli/service.md` documents all subcommands and flags
- `docs/cli/bundle.md` documents all flags and output formats
- `docs/guide/ci-cd.md` includes bundle generation in CI
  pipeline examples

Check — `.gitignore`:

- Generated bundle files (`*.secrets.mjs`, `*.secrets.cjs`,
  or whatever the conventional output name) are mentioned
  in documentation as files to add to `.gitignore`

### 3.8 Bundled sops completeness

Check:

- `sops-version.json` exists at the repo root with
  `version` and `checksums` fields
- All five platform packages exist under `platforms/`:
  `sops-darwin-arm64`, `sops-darwin-x64`, `sops-linux-x64`,
  `sops-linux-arm64`, `sops-win32-x64`
- `packages/cli/package.json` lists all five as
  `optionalDependencies` with matching versions
- `resolveSopsPath()` and `resetSopsResolution()` are
  exported from `packages/core/src/index.ts`
- `SopsResolution` and `SopsSource` types are exported
  from `packages/core/src/index.ts`
- `clef doctor` displays `[bundled]`, `[system]`, or
  `[CLEF_SOPS_PATH]` next to the sops version
- `clef doctor --json` includes `source` and `path` in
  the `sops` object
- `docs/contributing/development-setup.md` documents:
  - The three-tier resolution order
  - How `npm ci` installs the bundled binary in CI
  - How to use `CLEF_SOPS_PATH` for explicit override
  - How to skip optional deps for unit-test-only workflows
- `docs/cli/overview.md` documents the sops resolution
  chain under Configuration
- `README.md` states sops is bundled and lists the
  `CLEF_SOPS_PATH` override
- `CLAUDE.md` lists the `platforms/` directory and the
  `SopsResolver` module
- `publish-sops.yml` workflow exists and is
  `workflow_dispatch` (manual trigger only)
- `scripts/download-sops.mjs` exists and handles all five
  platforms

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
- `packages/ui/src/server/api.test.ts` — a test asserting
  the PUT handler does NOT echo the value in the response
  (`res.body.value` is `undefined`)
- `packages/ui/src/server/api.test.ts` — a test asserting
  `Cache-Control: no-store` is set on all endpoints that
  return decrypted data

### 4.3 Pending state atomicity

Read:

- `packages/cli/src/commands/set.ts` — the --random path
- `packages/core/src/pending/metadata.ts`
- `packages/ui/src/server/api.ts` — the PUT handler
- `packages/ui/src/server/api.test.ts`

Check:

- Is there a test for the case where encrypt succeeds but
  `markPending` fails? What happens?
- Is there a test for the case where encrypt fails? Does
  `markPending` get called anyway?
- The API handler rolls back the encryption when
  `markPendingWithRetry` fails — verify this is tested
- The partial failure case (pending fails AND rollback
  fails) is tested and returns a clear error

### 4.4 Sops resolver and bundling test coverage

Read:

- `packages/core/src/sops/resolver.test.ts`
- `packages/core/src/dependencies/checker.test.ts`

Check:

- A test asserts `CLEF_SOPS_PATH` takes precedence over
  all other resolution methods
- A test asserts the fallback to system PATH `"sops"` when
  no env var and no bundled package
- A test asserts the result is cached across calls (same
  object reference returned)
- A test asserts `resetSopsResolution()` clears the cache
  and subsequent calls re-resolve
- `checker.test.ts` includes tests verifying the `source`
  and `resolvedPath` fields are populated for sops checks
- `checker.test.ts` includes a test verifying `source` is
  `undefined` for git checks (git does not use the resolver)
- `checker.test.ts` includes a test for `CLEF_SOPS_PATH`
  integration — setting the env var changes the command
  passed to `runner.run()`

### 4.5 Service identity and bundle test coverage

Read:

- `packages/core/src/service-identity/manager.test.ts`
  (if it exists)
- `packages/cli/src/commands/service.test.ts`
- `packages/core/src/bundle/generator.test.ts`
  (if it exists)
- `packages/cli/src/commands/bundle.test.ts`

Check — Service identity tests:

- A test asserts private keys are printed to stdout during
  `create` — and that no subsequent call can retrieve them
- A test asserts `show` and `list` only display public keys
- A test asserts creating a duplicate identity name fails
- A test asserts creating with a nonexistent namespace fails
- A test asserts rotation generates new keys different from
  the old ones
- A test asserts rotation removes old recipients and adds
  new ones on scoped SOPS files
- A test asserts single-environment rotation leaves other
  environments unchanged
- Drift detection tests cover all issue types:
  `missing_environment`, `namespace_not_found`,
  `recipient_not_registered`, `scope_mismatch`
- A test asserts scope enforcement — recipient is NOT
  registered on files outside the identity's namespace scope

Check — Bundle tests:

- A test asserts the generated module contains age-encrypted
  ciphertext — not plaintext values
- A test asserts the `KEYS` array contains only key names
- A test asserts single-namespace bundles use flat key names
- A test asserts multi-namespace bundles use prefixed key
  names (`namespace/key`)
- A test asserts `--format esm` produces valid ES module
  syntax
- A test asserts `--format cjs` produces valid CommonJS syntax
- A test asserts bundle generation fails cleanly when the
  identity does not exist
- A test asserts bundle generation fails cleanly when the
  environment does not exist

Check — Security-critical:

- A test asserts that if decryption fails during bundle
  generation, no partial plaintext is written to the output
  file
- A test asserts the runtime module's `keyProvider` is called
  at most once (memoization)

### 4.6 Merge driver test coverage

Read:

- `packages/core/src/merge/driver.test.ts`
- `packages/cli/src/commands/merge-driver.test.ts`

Check:

- All 13+ merge scenarios are tested in `driver.test.ts`
  (unchanged, one-sided, two-sided same, two-sided
  different, additions, deletions, etc.)
- CLI tests verify clean merge flow (decrypt → merge →
  re-encrypt → exit 0)
- CLI tests verify conflict flow (report conflicting keys
  → exit 1)
- CLI tests verify error handling (missing manifest,
  decryption failure)
- Assertions verify merge output values, not just that
  the function ran

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
- The `CLEF_AGE_KEY` environment variable name is correct
  per the Clef documentation (Clef translates to `SOPS_AGE_KEY` for the subprocess)
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

### 5.5 Merge conflicts guide accuracy

Read `docs/guide/merge-conflicts.md`.

Check:

- The problem description (SOPS re-encryption with fresh
  nonce invalidates all lines) is technically accurate
- The merge driver solution (decrypt → three-way merge →
  re-encrypt) matches the implementation
- The `.gitattributes` example pattern matches what
  `clef hooks install` actually writes
- The `.git/config` merge driver command syntax
  (`clef merge-driver %O %A %B`) matches the CLI
  registration
- The conflict output example matches what the CLI
  actually prints
- The security invariants section (no plaintext to disk,
  no custom crypto, MAC integrity) is accurate

### 5.6 Scanning guide accuracy

Read `docs/guide/scanning.md`.

Check:

- The pattern list matches patterns defined in
  `packages/core/src/scanner/patterns.ts`
- The entropy threshold (Shannon > 4.5, min 20 chars)
  matches the implementation
- `.clefignore` syntax matches
  `packages/core/src/scanner/ignore.ts`
- Exit codes match `packages/cli/src/commands/scan.ts`
- Pre-commit hook behaviour description is accurate

### 5.7 Service identities guide accuracy

Read `docs/guide/service-identities.md`.

Check:

- The concept explanation distinguishes service identities
  (machine keypairs) from human recipients clearly
- The workflow (create → store → bundle → deploy) matches the
  actual CLI commands and their flags
- Key provider examples (AWS Secrets Manager, GCP Secret
  Manager, Vault) use correct SDK syntax for those services
- The manifest YAML example matches what `clef service create`
  actually writes to `clef.yaml`
- Multi-namespace key prefixing (`namespace/KEY`) is explained
  and matches the implementation
- Rotation instructions are accurate and include the step to
  update the secret manager with the new private key
- The security model explanation (private key never stored by
  Clef, bundle contains only ciphertext) is accurate

### 5.8 Service and bundle CLI reference accuracy

Read `docs/cli/service.md` and `docs/cli/bundle.md`.

For each:

- Read the docs page
- Read the corresponding command implementation
- Verify every flag documented actually exists in the code
- Verify every flag in the code is documented
- Verify example commands match the actual CLI registration

Flag any inaccuracy as Low (High if the example would cause
key material exposure or data loss).

### 5.9 Migration guide accuracy

Read `docs/guide/migrating.md`.

Check:

- `clef import` command syntax matches the implementation
  in `packages/cli/src/commands/import.ts`
- `--stdin`, `--format`, `--prefix`, `--overwrite`,
  `--keys` flags all exist in the code
- Third-party examples (1Password, AWS, Vault, Doppler)
  use correct CLI syntax for those tools
- The verification checklist commands all exist and work
  as described

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
