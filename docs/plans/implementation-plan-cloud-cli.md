# Implementation Plan: Cloud Backend CLI Integration

Version 0.1 | April 2026

Classification: Internal — Engineering

**DRAFT**

*Step-by-step implementation plan for adding the `cloud` backend to the Clef CLI and core library. Each step is a single, testable commit. Steps are ordered by dependency — each builds on the previous. References ADR `adr-cloud-cli-changes.md` for exact code changes.*

---

# Phase 1: Foundation (types, parser, SopsClient)

These steps add the `cloud` backend type and make it flow through existing code paths without any Cloud-specific behavior. After Phase 1, the codebase compiles with `"cloud"` as a valid backend, the manifest parser accepts Cloud config, and SopsClient knows how to handle it. No keyservice, no device flow, no network calls.

## Step 1: Types — BackendType + ClefCloudConfig

**ADR:** 001

**Files:**
- `packages/core/src/types/index.ts`

**Changes:**

1. Extend `ClefCloudConfig` (line 35-37) — add `keyId: string`.
2. Extend `BackendType` (line 51) — add `| "cloud"`.
3. Add `ClefCloudCredentials` interface after `ClefLocalConfig` (line 144):
   ```typescript
   export interface ClefCloudCredentials {
     token: string;
     endpoint?: string;
   }
   ```

**No other files break.** `BackendType` is used in switch statements that will get a `cloud` case in later steps. TypeScript will warn about unhandled cases in exhaustive switches — that's expected and will be resolved in the same phase.

**Test:** `npm run build` — confirm it compiles. Existing tests pass.

---

## Step 2: Manifest Parser — Accept `cloud` backend + validate

**ADR:** 003

**Files:**
- `packages/core/src/manifest/parser.ts`

**Changes:**

1. Add `"cloud"` to `VALID_BACKENDS` (line 31).
2. Extend cloud parsing block (lines 628-642):
   - Parse `keyId` from `cloudObj.keyId`.
   - Validate `keyId` matches `^clef:[a-z0-9_]+\/[a-z0-9_-]+$`.
   - `keyId` is required when `cloud` block is present (not optional — if you declare cloud, you must have a key ID).
3. Add cross-field validation after cloud parsing (after line 642):
   - If any environment uses `backend: cloud` or `sops.default_backend` is `cloud`, require the `cloud` block.

**Tests:** Add to `packages/core/src/manifest/parser.test.ts`:
- `cloud` is accepted as a valid backend in per-env override.
- Valid manifest with `cloud` block + `backend: cloud` on an environment parses correctly.
- Missing `cloud.keyId` when `cloud` block is present → error.
- Invalid `cloud.keyId` format → error.
- `backend: cloud` on an environment without top-level `cloud` block → error.
- Existing tests unchanged.

**Run:** `npm test -w packages/core`

---

## Step 3: Backend Migration — Add `cloud` to key-field mapping

**ADR:** 005

**Files:**
- `packages/core/src/migration/backend.ts`

**Changes:**

1. Add `cloud: undefined` to `BACKEND_KEY_FIELDS` (line 49-55).

**This is a one-line change.** Without it, `Record<BackendType, ...>` would fail to compile after Step 1 since `"cloud"` is missing from the record.

**Test:** `npm test -w packages/core` — existing migration tests pass, type check passes.

---

## Step 4: SopsClient — `cloud` case in `buildEncryptArgs`, `detectBackend`, `extractRecipients`

**ADR:** 002 (partial — the backend-specific switch cases only, not keyservice injection yet)

**Files:**
- `packages/core/src/sops/client.ts`

**Changes:**

1. Add `case "cloud"` to `buildEncryptArgs` (after line 527):
   ```typescript
   case "cloud": {
     const cloudKeyId = manifest.cloud?.keyId;
     if (cloudKeyId) {
       args.push("--kms", cloudKeyId);
     }
     break;
   }
   ```

2. Update `detectBackend` return type from explicit union to `BackendType` (line 432).
   Add cloud detection before the `return "age"` fallback:
   ```typescript
   if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) {
     const firstArn = (sops.kms as Array<Record<string, unknown>>)[0]?.arn;
     if (typeof firstArn === "string" && firstArn.startsWith("clef:")) {
       return "cloud";
     }
     return "awskms";
   }
   ```
   (This replaces the existing `sops.kms` check with one that branches on the `clef:` prefix.)

3. Update `extractRecipients` — change parameter type from explicit union to `BackendType` (line 445). Add `case "cloud"`:
   ```typescript
   case "cloud": {
     const entries = sops.kms as Array<Record<string, unknown>> | undefined;
     return entries?.map((e) => String(e.arn ?? "")) ?? [];
   }
   ```

**Tests:** Add to `packages/core/src/sops/client.test.ts`:
- `buildEncryptArgs` with cloud backend produces `["--kms", "clef:int_abc123/production"]`.
- `detectBackend` returns `"cloud"` when `sops.kms[0].arn` starts with `"clef:"`.
- `detectBackend` returns `"awskms"` when `sops.kms[0].arn` starts with `"arn:aws:kms:"`.
- `extractRecipients` with cloud backend extracts Clef key IDs from `sops.kms[].arn`.

**Run:** `npm test -w packages/core`

---

## Step 5: SopsClient — Keyservice injection via constructor

**ADR:** 002 (keyservice args injection)

**Files:**
- `packages/core/src/sops/client.ts`

**Changes:**

1. Add `keyserviceAddr?: string` parameter to constructor (after `sopsPath`).
2. Add `private readonly keyserviceArgs: string[]` field.
3. In constructor body, compute `keyserviceArgs`:
   ```typescript
   this.keyserviceArgs = keyserviceAddr
     ? ["--enable-local-keyservice=false", "--keyservice", keyserviceAddr]
     : [];
   ```
4. Spread `this.keyserviceArgs` into all SOPS invocations:
   - `decrypt()` line 125: `[...this.keyserviceArgs, "decrypt", ...]`
   - `encrypt()` line 207: `["--config", configPath, ...this.keyserviceArgs, "encrypt", ...]`
   - `addRecipient()` line 269: `[...this.keyserviceArgs, "rotate", ...]`
   - Check for any other `this.runner.run(this.sopsCommand, ...)` calls and add `keyserviceArgs` there too.

**Tests:** Add to `packages/core/src/sops/client.test.ts`:
- When `keyserviceAddr` is undefined, SOPS args are unchanged (existing tests still pass).
- When `keyserviceAddr` is `"tcp://127.0.0.1:12345"`, decrypt args include `--enable-local-keyservice=false --keyservice tcp://127.0.0.1:12345`.
- When `keyserviceAddr` is set, encrypt args include keyservice flags.
- When `keyserviceAddr` is set, rotate args include keyservice flags.

**Run:** `npm test -w packages/core`

---

## Step 6: `createSopsClient` — Thread keyservice address

**Files:**
- `packages/cli/src/age-credential.ts`

**Changes:**

1. Add optional `keyserviceAddr?: string` parameter to `createSopsClient` (line 124-131):
   ```typescript
   export async function createSopsClient(
     repoRoot: string,
     runner: SubprocessRunner,
     keyserviceAddr?: string,
   ): Promise<SopsClient> {
     const credential = await resolveAgeCredential(repoRoot, runner);
     const { ageKeyFile, ageKey } = prepareSopsClientArgs(credential);
     return new SopsClient(runner, ageKeyFile, ageKey, undefined, keyserviceAddr);
   }
   ```

**All existing call sites pass no `keyserviceAddr`** — behavior is unchanged. The parameter is only used when Cloud commands pass it.

**Test:** Existing CLI tests pass. No new tests needed — this is a passthrough.

**Run:** `npm test -w packages/cli`

---

## Step 7: Core exports — Expose new cloud modules

**Files:**
- `packages/core/src/index.ts`

**Changes:**

No changes yet — the new `cloud/` modules don't exist until Phase 2. This step is a checkpoint: run the full test suite to confirm Phase 1 is green.

**Run:**
```bash
npm run lint
npm run test:coverage
npm run format:check
```

All must pass. Phase 1 is complete.

---

# Phase 2: Cloud Infrastructure (keyservice, credentials, resolver)

These steps add the new `packages/core/src/cloud/` module with keyservice lifecycle, credential management, and binary resolution. After Phase 2, the core library can spawn a keyservice sidecar, read Cloud credentials, and resolve the keyservice binary path. No CLI commands yet.

## Step 8: Keyservice binary resolver

**ADR:** 006

**Files:**
- `packages/core/src/cloud/resolver.ts` (new)

**Changes:**

Create `resolveKeyservicePath()` following the pattern in `packages/core/src/sops/resolver.ts`:
1. `CLEF_KEYSERVICE_PATH` env var (explicit override).
2. Bundled `@clef-sh/keyservice-{platform}-{arch}` package (npm `optionalDependencies`, same distribution model as the SOPS binary).
3. System PATH fallback (`"clef-keyservice"`).

The bundled lookup uses `require.resolve()` to find the platform package, same as `packages/core/src/sops/bundled.ts` does for SOPS.

Include `resetKeyserviceResolution()` for tests.

**Also:** Add the keyservice platform packages to `packages/cli/package.json` as `optionalDependencies`:
```json
"optionalDependencies": {
  "@clef-sh/sops-darwin-arm64": "3.9.4",
  "@clef-sh/sops-darwin-x64": "3.9.4",
  ...
  "@clef-sh/keyservice-darwin-arm64": "*",
  "@clef-sh/keyservice-darwin-x64": "*",
  "@clef-sh/keyservice-linux-arm64": "*",
  "@clef-sh/keyservice-linux-x64": "*",
  "@clef-sh/keyservice-win32-x64": "*"
}
```

**Tests:** New file `packages/core/src/cloud/resolver.test.ts`:
- Env var override returns the path.
- Env var pointing to nonexistent file throws.
- Bundled package found via `require.resolve` (mock).
- System PATH fallback when nothing else found.
- Cache works (second call returns same result without re-probing).
- `resetKeyserviceResolution()` clears cache.

**Run:** `npm test -w packages/core`

---

## Step 9: Cloud credentials reader/writer

**ADR:** 006

**Files:**
- `packages/core/src/cloud/credentials.ts` (new)

**Changes:**

Create `readCloudCredentials()` and `writeCloudCredentials()`:
- Reads from / writes to `~/.clef/credentials.yaml`.
- `writeCloudCredentials` creates `~/.clef/` with mode `0o700` if needed.
- File written with mode `0o600`.
- Returns `null` if file doesn't exist.
- Uses `yaml` package (already a core dependency).

**Tests:** New file `packages/core/src/cloud/credentials.test.ts`:
- Returns `null` when file doesn't exist (mock `fs`).
- Reads valid credentials file.
- Returns `null` when token is missing from file.
- `writeCloudCredentials` creates directory and file with correct content.
- Default endpoint is `https://api.clef.sh` when not specified.

**Run:** `npm test -w packages/core`

---

## Step 10: Keyservice sidecar lifecycle

**ADR:** 006

**Files:**
- `packages/core/src/cloud/keyservice.ts` (new)

**Changes:**

Create `spawnKeyservice()` and `KeyserviceHandle`:
- Spawns `clef-keyservice` with `--token`, `--addr 127.0.0.1:0`, optional `--endpoint`.
- Reads `PORT=<port>` from stdout via readline.
- Returns `{ addr: "tcp://127.0.0.1:<port>", kill() }`.
- 5-second timeout for port line.
- `kill()` sends SIGTERM with 3-second timeout before SIGKILL.

**Tests:** New file `packages/core/src/cloud/keyservice.test.ts`:
- Mock `child_process.spawn`.
- Simulates binary printing `PORT=12345` to stdout → returns correct addr.
- Timeout when no `PORT=` line received within 5s.
- Process exits unexpectedly → rejects with error.
- `kill()` sends SIGTERM, process exits → resolves.
- `kill()` SIGTERM timeout → sends SIGKILL.

**Run:** `npm test -w packages/core`

---

## Step 11: Core exports — Expose cloud modules

**Files:**
- `packages/core/src/cloud/index.ts` (new)
- `packages/core/src/index.ts`

**Changes:**

1. Create `packages/core/src/cloud/index.ts`:
   ```typescript
   export { spawnKeyservice } from "./keyservice";
   export type { KeyserviceHandle } from "./keyservice";
   export { resolveKeyservicePath, resetKeyserviceResolution } from "./resolver";
   export type { KeyserviceResolution, KeyserviceSource } from "./resolver";
   export { readCloudCredentials, writeCloudCredentials } from "./credentials";
   ```

2. Add to `packages/core/src/index.ts` (after line 95):
   ```typescript
   export {
     spawnKeyservice,
     resolveKeyservicePath,
     resetKeyserviceResolution,
     readCloudCredentials,
     writeCloudCredentials,
   } from "./cloud";
   export type { KeyserviceHandle, KeyserviceResolution, KeyserviceSource } from "./cloud";
   ```

**Run:**
```bash
npm run lint
npm run test:coverage
npm run format:check
```

Phase 2 is complete.

---

# Phase 3: CLI Commands

These steps add the `clef cloud` command group and modify `clef pack`. After Phase 3, users can run `clef cloud init`, `clef cloud login`, `clef cloud status`, and `clef pack --remote` / `clef pack --push`.

## Step 12: `clef cloud status` command (simplest subcommand first)

**ADR:** 008

**Files:**
- `packages/cli/src/commands/cloud.ts` (new)
- `packages/cli/src/index.ts`

**Changes:**

1. Create `packages/cli/src/commands/cloud.ts` with `registerCloudCommand()`.
2. Implement `clef cloud status` first — it's the simplest subcommand:
   - Read manifest, check for `cloud` block.
   - Read `~/.clef/credentials.yaml`, check for valid token.
   - Check if keyservice binary exists at `.clef/bin/clef-keyservice`.
   - Print status summary.
3. Register in `packages/cli/src/index.ts`:
   - Add import: `import { registerCloudCommand } from "./commands/cloud";`
   - Add registration before `program.parseAsync` (line 106): `registerCloudCommand(program, deps);`
4. Stub `init` and `login` subcommands (they print "not yet implemented" for now).

**Tests:** New file `packages/cli/src/commands/cloud.test.ts`:
- `clef cloud status` with valid cloud config prints integration info.
- `clef cloud status` without cloud config prints "not configured".
- `clef cloud status` without credentials prints "not authenticated".

**Run:** `npm test -w packages/cli`

---

## Step 13: Cloud API device flow client

**Files:**
- `packages/core/src/cloud/device-flow.ts` (new)
- `packages/core/src/cloud/index.ts` (extend exports)

**Changes:**

Create the device flow HTTP client:

```typescript
export interface DeviceSession {
  sessionId: string;
  loginUrl: string;
  pollUrl: string;
  expiresIn: number;
}

export interface DevicePollResult {
  status: "pending" | "awaiting_payment" | "complete" | "cancelled" | "expired";
  token?: string;
  integrationId?: string;
  keyId?: string;
}

export async function initiateDeviceFlow(
  endpoint: string,
  options: { repoName: string; environment: string; clientVersion: string },
): Promise<DeviceSession>;

export async function pollDeviceFlow(pollUrl: string): Promise<DevicePollResult>;
```

Uses `fetch` (Node 18+ built-in). No external HTTP dependency.

**Tests:** New file `packages/core/src/cloud/device-flow.test.ts`:
- `initiateDeviceFlow` sends POST, returns session.
- `pollDeviceFlow` returns `pending`, `awaiting_payment`, `complete`, `expired`.
- HTTP error → throws with message.
- Network error → throws.

**Run:** `npm test -w packages/core`

---

## Step 14: `clef cloud login` command

**Files:**
- `packages/cli/src/commands/cloud.ts` (extend)

**Changes:**

Implement `clef cloud login`:
1. Call `initiateDeviceFlow` with endpoint from existing credentials or default.
2. Open browser via `open` (the npm package already used by `clef ui` for browser opening — check existing usage).
3. Print login URL as fallback.
4. Poll every 2 seconds until `complete` or `expired`.
5. On complete: write token to `~/.clef/credentials.yaml` via `writeCloudCredentials`.
6. Print success message.

**Tests:**
- Mock `initiateDeviceFlow` and `pollDeviceFlow`.
- Verify browser open is called with correct URL.
- Verify credentials written on success.
- Verify clean exit on expiry.

**Run:** `npm test -w packages/cli`

---

## Step 15: `clef cloud init` command

**Files:**
- `packages/cli/src/commands/cloud.ts` (extend)

**Changes:**

Implement `clef cloud init --env <environment>`:

1. **Pre-checks:**
   - Parse manifest, verify target environment exists.
   - Verify target environment is not already using `cloud` backend.
   - If `cloud` block already exists in manifest with matching integration → skip to manifest update (idempotency).

2. **Device flow (reuse `login` logic):**
   - Initiate session with `repoName` (from git remote or directory name) and `environment`.
   - Open browser, poll until complete.
   - Store credentials.

3. **Verify keyservice binary:**
   - Call `resolveKeyservicePath()` — should find bundled package (installed via `npm install`).
   - If not found, error with: "Keyservice binary not found. Reinstall the CLI: `npm install @clef-sh/cli`."

4. **Update manifest:**
   - Write `cloud.integrationId` and `cloud.keyId` to `clef.yaml`.
   - Set `sops.backend: cloud` on the target environment.
   - Use `writeManifestYaml` from core.

5. **Re-encrypt production files:**
   - Spawn keyservice sidecar with new token.
   - Create SopsClient with `keyserviceAddr`.
   - For each SOPS file in the target environment:
     - Decrypt with existing age backend (old SopsClient, no keyservice).
     - Encrypt with cloud backend (new SopsClient, with keyservice).
   - Kill keyservice.

6. **Print summary:**
   - List modified files.
   - Suggest `git add` + `git commit`.

**Tests:**
- Mock device flow, manifest write, SOPS calls.
- Verify manifest updated correctly.
- Verify keyservice spawned and killed.
- Verify idempotency (re-run skips auth/payment).

**Run:** `npm test -w packages/cli`

---

## Step 16: `clef pack --remote` flag

**ADR:** 007

**Files:**
- `packages/cli/src/commands/pack.ts`
- `packages/core/src/cloud/pack-client.ts` (new)
- `packages/core/src/cloud/index.ts` (extend exports)

**Changes:**

1. Create `CloudPackClient` in `packages/core/src/cloud/pack-client.ts`:
   - `pack(token, config)` — bundles manifest + scoped encrypted files, POSTs to `/api/v1/cloud/pack`.
   - Uses `FormData` and `fetch`.
   - Returns `{ revision, artifactSize, identity, environment }`.

2. Modify `packages/cli/src/commands/pack.ts`:
   - Change `--output` from `.requiredOption` to `.option`.
   - Add `--remote` and `--push` options.
   - Add mutual exclusivity validation.
   - Add `--output` required validation when neither `--remote` nor `--push`.
   - Add `--remote` handler: read credentials, create `CloudPackClient`, call `pack()`.

**Tests:**
- Pack with `--remote`: mock `CloudPackClient`, verify it's called with correct args.
- Pack with `--remote` and `--output`: error (mutually exclusive).
- Pack with `--remote` and `--push`: error.
- Pack without `--output` and without `--remote`: error.
- Existing pack tests unchanged.

**Run:** `npm test -w packages/cli`

---

## Step 17: `clef pack --push` flag

**Files:**
- `packages/cli/src/commands/pack.ts`
- `packages/core/src/cloud/artifact-client.ts` (new)
- `packages/core/src/cloud/index.ts` (extend exports)

**Changes:**

1. Create `CloudArtifactClient` in `packages/core/src/cloud/artifact-client.ts`:
   - `upload(token, config)` — reads packed artifact from disk, POSTs to `/api/v1/cloud/artifacts/{identity}/{environment}`.

2. Modify `packages/cli/src/commands/pack.ts`:
   - Add `--push` handler after existing pack logic: read artifact from `outputPath`, upload via `CloudArtifactClient`.

**Tests:**
- Pack with `--push`: verify local pack runs first, then artifact uploaded.
- Upload failure: error message includes Cloud API response.

**Run:** `npm test -w packages/cli`

---

## Step 18: Integration — Cloud backend in existing commands

**Files:**
- `packages/cli/src/commands/get.ts`
- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/delete.ts`
- `packages/cli/src/commands/compare.ts`
- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/rotate.ts`
- `packages/cli/src/commands/export.ts`
- `packages/cli/src/commands/import.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/lint.ts`

**Changes:**

Each of these commands calls `createSopsClient(repoRoot, deps.runner)`. When the target environment uses the `cloud` backend, they need to:

1. Detect `cloud` backend from manifest.
2. Spawn keyservice sidecar.
3. Pass `keyserviceAddr` to `createSopsClient`.
4. Kill keyservice on exit.

**Pattern — extract a helper function:**

```typescript
// packages/cli/src/cloud-sops.ts (new)
export async function createCloudAwareSopsClient(
  repoRoot: string,
  runner: SubprocessRunner,
  manifest: ClefManifest,
  environment?: string,
): Promise<{ client: SopsClient; cleanup: () => Promise<void> }> {
  const backend = environment
    ? resolveBackendConfig(manifest, environment).backend
    : manifest.sops.default_backend;

  if (backend === "cloud") {
    const creds = readCloudCredentials();
    const token = process.env.CLEF_CLOUD_TOKEN ?? creds?.token;
    if (!token) {
      throw new Error("Cloud token required. Set CLEF_CLOUD_TOKEN or run 'clef cloud login'.");
    }
    const binaryPath = resolveKeyservicePath(repoRoot).path;
    const handle = await spawnKeyservice({
      binaryPath,
      token,
      endpoint: creds?.endpoint,
    });
    const client = await createSopsClient(repoRoot, runner, handle.addr);
    return { client, cleanup: () => handle.kill() };
  }

  const client = await createSopsClient(repoRoot, runner);
  return { client, cleanup: async () => {} };
}
```

Then in each command, replace:
```typescript
const sopsClient = await createSopsClient(repoRoot, deps.runner);
```
with:
```typescript
const { client: sopsClient, cleanup } = await createCloudAwareSopsClient(
  repoRoot, deps.runner, manifest, environment,
);
try {
  // ... existing command logic ...
} finally {
  await cleanup();
}
```

**This is mechanical.** Each command gets the same pattern. The helper centralizes the keyservice lifecycle.

**Tests:**
- `createCloudAwareSopsClient` with non-cloud backend: returns client, cleanup is no-op.
- `createCloudAwareSopsClient` with cloud backend: spawns keyservice, returns client with addr, cleanup kills.
- `createCloudAwareSopsClient` with cloud backend and no token: throws.

**Run:**
```bash
npm run lint
npm run test:coverage
npm run format:check
```

Phase 3 is complete.

---

# Phase 4: Validation

Full suite validation after all changes.

## Step 19: Full test suite + linting

**Run:**
```bash
npm run lint
npm run test:coverage
npm run format:check
```

## Step 20: E2E tests

Add e2e test for cloud backend (mock Cloud API):
- `clef cloud status` shows "not configured" on a fresh repo.
- `clef cloud status` shows integration info on a repo with cloud config.
- `clef set` / `clef get` round-trip with cloud backend (requires mock keyservice + mock Cloud API).

**Run:** `npm run test:e2e`

---

# Dependency Graph

```
Step 1 (types)
  |
  +---> Step 2 (parser)
  |       |
  +---> Step 3 (migration) 
  |       |
  +---> Step 4 (SopsClient switch cases)
          |
          +--> Step 5 (SopsClient keyservice injection)
                |
                +--> Step 6 (createSopsClient passthrough)
                      |
                      +--> Step 7 (checkpoint: full test suite)
                            |
              +-------------+-------------+
              |             |             |
        Step 8          Step 9        Step 10
        (resolver)      (creds)       (keyservice)
              |             |             |
              +-------------+-------------+
                            |
                      Step 11 (core exports)
                            |
              +-------------+-------------+
              |             |             |
        Step 12       Step 13        Step 16
        (cloud cmd)   (device flow)  (pack --remote)
              |             |             |
              +------+------+        Step 17
                     |               (pack --push)
               Step 14
               (cloud login)
                     |
               Step 15
               (cloud init)
                     |
               Step 18
               (existing commands)
                     |
               Step 19-20
               (validation)
```

# Estimated Scope

| Phase | Steps | New files | Modified files | New test files | Est. lines |
|-------|-------|-----------|---------------|---------------|------------|
| 1: Foundation | 1-7 | 0 | 4 | 0 (extend existing) | ~80 |
| 2: Cloud infra | 8-11 | 4 | 1 | 3 | ~350 |
| 3: CLI commands | 12-18 | 5 | 12 | 3 | ~900 |
| 4: Validation | 19-20 | 0 | 0 | 1 | ~50 |
| **Total** | **20** | **9** | **17** | **7** | **~1,380** |

# Risk Notes

1. **Step 5 (keyservice injection) is the highest risk change.** It modifies every SOPS invocation path. The spreading pattern (`[...this.keyserviceArgs, ...]`) is safe — empty array is a no-op — but thorough testing of all paths (decrypt, encrypt, rotate) is essential.

2. **Step 15 (cloud init) is the most complex step.** Device flow + browser + polling + manifest update + re-encryption. Consider splitting into substeps if it's too large for a single commit.

3. **Step 18 (existing commands) is the widest change.** 10 command files get the same pattern. Mechanical but high surface area. The `createCloudAwareSopsClient` helper minimizes per-file diff.

4. **E2E tests (Step 20) need a mock Cloud API.** Consider a simple Express server in the test harness that implements the device flow and KMS proxy endpoints.
