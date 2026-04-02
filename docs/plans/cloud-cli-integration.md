# Cloud CLI Integration

Product Requirements Document

Version 0.1 | April 2026

Classification: Internal — Engineering & Product

**DRAFT**

*This document defines the changes required in the Clef CLI and core library to support the Cloud managed KMS backend. It covers the new `cloud` backend type, manifest schema changes, SopsClient modifications, keyservice sidecar lifecycle, and backend detection in encrypted files. Familiarity with the Cloud Key Resolution PRD and the existing CLI architecture is assumed.*

# 1. Overview

Clef Cloud provides a managed KMS backend: the user runs `clef cloud init --env production`, and their production environment is migrated from age keys to a Clef-managed KMS key. All encrypt/decrypt operations for that environment are proxied through a local keyservice sidecar to the Cloud API, which resolves the Clef key ID to the real AWS KMS ARN and performs the operation.

The CLI changes fall into five areas:

1. **New backend type** — `"cloud"` added to the `BackendType` union.
2. **Manifest schema** — `cloud.keyId` field, `cloud` backend validation.
3. **SopsClient** — new `case "cloud"` in `buildEncryptArgs`, keyservice argument injection.
4. **Keyservice sidecar** — lifecycle management (spawn, port discovery, teardown).
5. **Backend detection** — distinguishing `cloud` from `awskms` in encrypted file metadata.

# 2. New Backend Type

## 2.1 Type Change

In `packages/core/src/types/index.ts`:

```typescript
// Current
export type BackendType = "age" | "awskms" | "gcpkms" | "azurekv" | "pgp";

// New
export type BackendType = "age" | "awskms" | "gcpkms" | "azurekv" | "pgp" | "cloud";
```

The `cloud` backend is distinct from `awskms`. The `awskms` backend means "the user has local AWS credentials and SOPS calls KMS directly." The `cloud` backend means "the user has a Clef Cloud token and SOPS calls KMS through the keyservice sidecar."

## 2.2 EnvironmentSopsOverride

```typescript
export interface EnvironmentSopsOverride {
  backend: BackendType;
  aws_kms_arn?: string;
  gcp_kms_resource_id?: string;
  azure_kv_url?: string;
  pgp_fingerprint?: string;
  // No new field needed — cloud backend reads from manifest.cloud.keyId
}
```

The `cloud` backend does not need a new field in the per-environment override. It reads the key ID from the top-level `cloud.keyId` in the manifest. This is intentional: Cloud key IDs are scoped per integration, not per environment (in MVP, one key per integration).

## 2.3 ClefCloudConfig

```typescript
// Current
export interface ClefCloudConfig {
  integrationId: string;
}

// New
export interface ClefCloudConfig {
  integrationId: string;
  keyId: string;
}
```

The `keyId` field stores the Clef key ID (e.g., `clef:int_abc123/production`). It is required when any environment uses the `cloud` backend.

# 3. Manifest Schema

## 3.1 Example Manifest

```yaml
version: 1

environments:
  - name: dev
    description: Development
  - name: staging
    description: Staging
  - name: production
    description: Production
    protected: true
    sops:
      backend: cloud

namespaces:
  - name: api
    description: API secrets
  - name: database
    description: Database credentials

sops:
  default_backend: age
  age:
    recipients:
      - age1abc...

cloud:
  integrationId: int_abc123
  keyId: clef:int_abc123/production
```

In this example, `dev` and `staging` use age (the default backend). `production` overrides to `cloud`. All three environments share the same namespace structure.

## 3.2 Parser Validation

In `packages/core/src/manifest/parser.ts`:

### VALID_BACKENDS

```typescript
// Current
const VALID_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp"] as const;

// New
const VALID_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp", "cloud"] as const;
```

### New Validation Rules

1. If any environment uses `backend: cloud`, `cloud.keyId` must be present in the manifest.
2. `cloud.keyId` must match the pattern `^clef:[a-z0-9_]+/[a-z0-9_-]+$`.
3. If `cloud.keyId` is present, `cloud.integrationId` must also be present.
4. If `sops.default_backend` is `cloud`, `cloud.keyId` must be present.

### Error Messages

```
"cloud backend requires cloud.keyId in manifest"
"cloud.keyId must match format clef:<integrationId>/<keyAlias>"
"cloud.keyId requires cloud.integrationId to be set"
```

## 3.3 resolveBackendConfig

The `resolveBackendConfig` function (used by `SopsClient.buildEncryptArgs`) must handle the `cloud` case. When the resolved backend is `cloud`, the function returns a config object with `backend: "cloud"`. The key ID is read from `manifest.cloud.keyId` by the caller.

# 4. SopsClient Changes

## 4.1 buildEncryptArgs

In `packages/core/src/sops/client.ts`, the `buildEncryptArgs` method switches on `config.backend`:

```typescript
case "cloud": {
  const cloudKeyId = manifest.cloud?.keyId;
  if (cloudKeyId) {
    args.push("--kms", cloudKeyId);
  }
  break;
}
```

The `--kms` flag is reused because SOPS routes KMS key types to the key service. The value is the Clef key ID, not an AWS ARN. SOPS stores it in the encrypted file's `sops.kms[].arn` field and sends it to the keyservice via gRPC.

## 4.2 Keyservice Arguments

When the resolved backend is `cloud`, the SopsClient must append keyservice arguments to all SOPS invocations (encrypt, decrypt, rotate):

```
--enable-local-keyservice=false
--keyservice tcp://127.0.0.1:<port>
```

`--enable-local-keyservice=false` prevents SOPS from trying the Clef key ID against the local AWS SDK. `--keyservice` directs all key service operations to the Clef keyservice sidecar.

These arguments must be added in all SOPS invocation paths, not just `buildEncryptArgs`. Decrypt operations do not call `buildEncryptArgs` — SOPS reads the key from the encrypted file — but they still need the keyservice connection to resolve the Clef key ID.

### Implementation Options

**Option A: Inject in SopsClient constructor.** The SopsClient receives an optional `keyserviceAddr` parameter. When set, all SOPS invocations include the keyservice arguments. The CLI is responsible for spawning the sidecar and passing the address.

**Option B: Inject per invocation.** Each SopsClient method that calls SOPS accepts an optional `keyserviceAddr` parameter. More granular but more surface area.

**Recommended: Option A.** The keyservice sidecar is long-lived for the duration of the CLI command. Once spawned, all SOPS calls within that command use the same address.

## 4.3 detectBackend

The `detectBackend` method reads SOPS metadata from encrypted files and returns the backend type. Currently it checks `sops.kms` and returns `"awskms"`. With Cloud, `sops.kms` can also contain Clef key IDs.

```typescript
private detectBackend(sops: Record<string, unknown>): BackendType {
  if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) {
    // Distinguish cloud from awskms by checking the arn value
    const firstArn = (sops.kms as Array<Record<string, unknown>>)[0]?.arn;
    if (typeof firstArn === "string" && firstArn.startsWith("clef:")) {
      return "cloud";
    }
    return "awskms";
  }
  // ... existing checks for age, gcp_kms, azure_kv, pgp unchanged
}
```

## 4.4 extractRecipients

The `extractRecipients` method returns the list of recipients for a given backend. For `cloud`, the "recipient" is the Clef key ID:

```typescript
case "cloud": {
  const entries = sops.kms as Array<Record<string, unknown>> | undefined;
  return entries?.map((e) => String(e.arn ?? "")) ?? [];
}
```

This is identical to the `awskms` case. The Clef key ID is stored in the same `arn` field.

# 5. Keyservice Sidecar Lifecycle

The keyservice binary (`clef-keyservice`) is a localhost gRPC server that proxies KMS operations to the Cloud API. The CLI manages its lifecycle.

## 5.1 Spawn

```
clef-keyservice --token <cloud_token> --addr 127.0.0.1:0 [--endpoint <cloud_api_url>]
```

The binary listens on a random port and prints `PORT=<port>` to stdout. The CLI reads this line to discover the assigned port.

## 5.2 Token Source

The Cloud bearer token is stored locally after `clef cloud init`. Storage location: `.clef/config.yaml` in the project root (or `~/.clef/config.yaml` for global config). The token is read by the CLI when spawning the keyservice.

## 5.3 Binary Resolution

A new `resolveKeyservicePath()` function, modeled on the existing `resolveSopsPath()` in `packages/core/src/sops/resolver.ts`. Resolution order:

1. `CLEF_KEYSERVICE_PATH` environment variable (explicit override).
2. Bundled `@clef-sh/keyservice-{platform}-{arch}` npm package (installed automatically as `optionalDependencies` of the CLI, same distribution model as the SOPS binary).
3. System PATH fallback.

## 5.4 Lifecycle Manager

A new module in `packages/core/src/cloud/keyservice.ts`:

```typescript
interface KeyserviceHandle {
  addr: string;       // "tcp://127.0.0.1:<port>"
  kill(): Promise<void>;
}

async function spawnKeyservice(options: {
  token: string;
  endpoint?: string;
  binaryPath: string;
}): Promise<KeyserviceHandle>;
```

The function:

1. Spawns the binary as a child process.
2. Reads stdout until it sees `PORT=<port>`.
3. Returns a handle with the address and a `kill()` function.
4. On `kill()`, sends SIGTERM and waits for exit (with a timeout fallback to SIGKILL).

The handle is created once per CLI command and passed to the SopsClient constructor.

## 5.5 Error Handling

| Failure | Behavior |
|---------|----------|
| Binary not found | Error: "clef-keyservice not found. Reinstall the CLI: `npm install @clef-sh/cli`." |
| Binary fails to start | Error: surface stderr from the process. |
| `PORT=` line not received within 5 seconds | Error: "keyservice did not start in time." Kill process. |
| Keyservice dies mid-operation | SOPS receives a gRPC connection error. CLI surfaces it as "Cloud key service connection lost." |
| Invalid/expired token | Cloud API returns 401. Keyservice returns gRPC Internal. CLI surfaces: "Cloud authentication failed. Run `clef cloud login` to refresh." |

# 6. Command Integration

## 6.1 Commands That Need Keyservice

Any command that calls SOPS encrypt or decrypt needs keyservice support when the target environment uses the `cloud` backend:

| Command | SOPS operation | Needs keyservice |
|---------|---------------|-----------------|
| `clef set` | encrypt | Yes |
| `clef get` | decrypt | Yes |
| `clef delete` | encrypt (rewrite) | Yes |
| `clef compare` | decrypt | Yes |
| `clef diff` | decrypt | Yes |
| `clef rotate` | decrypt + encrypt | Yes |
| `clef export` | decrypt | Yes |
| `clef import` | encrypt | Yes |
| `clef exec` | decrypt | Yes |
| `clef lint` | decrypt (validation) | Yes |
| `clef pack` | decrypt | Yes (local pack) or No (`--remote` sends to Cloud) |
| `clef init` | encrypt (scaffolding) | Only if default_backend is cloud |
| `clef ui` | decrypt + encrypt | Yes |

Note: `clef pack --remote` does NOT need the keyservice. It sends the encrypted files to the Cloud pack endpoint, which decrypts using the managed KMS key. The keyservice is only needed for local SOPS operations.

## 6.2 Keyservice Spawn Strategy

The keyservice is spawned lazily — only when a command needs to perform a SOPS operation against a `cloud` backend environment. The spawn happens once per CLI invocation and the sidecar stays alive for the duration of the command.

```
CLI command starts
    |
    +--> Parse manifest
    |
    +--> Resolve backend for target environment
    |
    +--> If backend == "cloud":
    |      +--> Resolve keyservice binary path
    |      +--> Read Cloud token from config
    |      +--> Spawn keyservice sidecar
    |      +--> Create SopsClient with keyserviceAddr
    |
    +--> Execute command logic (SOPS calls use keyservice)
    |
    +--> Kill keyservice sidecar
```

For commands that operate across multiple environments (e.g., `clef diff` comparing dev vs production), the keyservice is spawned if any target environment uses the `cloud` backend. Non-cloud environments use SOPS normally (no keyservice args).

## 6.3 `clef cloud init`

This is the entry point for Cloud adoption and the primary conversion funnel. The experience must be polished — this is where a developer becomes a paying customer.

### Design Principles

1. **Public site, not local UI.** The auth and payment flow runs on `cloud.clef.sh` (public), not the local UI at `127.0.0.1:7777`. This enables analytics (Plausible/Posthog), conversion tracking, Stripe checkout integration, and SEO/landing page content. The local UI has none of this infrastructure and binding it to a sales flow creates the wrong coupling.

2. **Device flow auth.** The CLI does not handle credentials directly. It initiates a session, opens the browser, and polls for completion. This is the same pattern as `gh auth login`, Claude Code, and `gcloud auth login`. The user authenticates and pays in the browser; the CLI picks up the result.

3. **Single command, no context switching.** The developer runs `clef cloud init --env production` and stays in the terminal. The browser opens automatically for auth + payment, then the CLI takes over for provisioning, manifest updates, and re-encryption. The developer never needs to copy-paste tokens or edit config files.

### Device Flow Protocol

```
CLI                              Browser                         Cloud API
 |                                  |                               |
 |-- POST /api/v1/device/init ---->|                               |
 |   {repoName, environment}       |                               |
 |<-- {sessionId, loginUrl,        |                               |
 |     pollUrl, expiresIn} --------|                               |
 |                                  |                               |
 |-- open(loginUrl) -------------->|                               |
 |                                  |                               |
 |   [CLI prints: "Waiting for     |                               |
 |    authorization..."]            |                               |
 |                                  |                               |
 |   [CLI polls pollUrl            |-- User lands on loginUrl ---->|
 |    every 2s]                     |                               |
 |                                  |-- Sign up / Log in --------->|
 |                                  |   (email OTP, GitHub OAuth,  |
 |                                  |    Google OAuth)              |
 |                                  |                               |
 |                                  |<-- Authenticated ------------|
 |                                  |                               |
 |                                  |-- Stripe Checkout ---------->|
 |                                  |   (embedded or redirect)     |
 |                                  |                               |
 |                                  |<-- Payment complete ---------|
 |                                  |                               |
 |                                  |-- "You can close this tab" ->|
 |                                  |   (browser shows success)    |
 |                                  |                               |
 |<-- Poll returns: {              |                               |
 |     status: "complete",         |                               |
 |     token, integrationId,       |                               |
 |     keyId} --------------------------------------------|
 |                                                                  |
 |   [CLI continues setup locally]                                  |
```

### API Endpoints

#### `POST /api/v1/device/init`

Initiates a device flow session. Returns a session ID and a URL for the user to visit.

Request:
```json
{
  "clientType": "cli",
  "clientVersion": "0.1.11",
  "repoName": "my-app",
  "environment": "production"
}
```

Response:
```json
{
  "sessionId": "sess_abc123",
  "loginUrl": "https://cloud.clef.sh/setup?session=sess_abc123",
  "pollUrl": "https://api.clef.sh/api/v1/device/poll/sess_abc123",
  "expiresIn": 900
}
```

The `loginUrl` points to the public site. The `repoName` and `environment` are carried into the session so the browser flow can display context ("Setting up Cloud for **my-app** / **production**") and pre-fill configuration.

#### `GET /api/v1/device/poll/:sessionId`

The CLI polls this endpoint every 2 seconds.

Pending:
```json
{
  "status": "pending"
}
```

Auth complete, awaiting payment:
```json
{
  "status": "awaiting_payment"
}
```

Complete:
```json
{
  "status": "complete",
  "token": "clef_tok_...",
  "integrationId": "int_abc123",
  "keyId": "clef:int_abc123/production"
}
```

Expired (session timed out):
```json
{
  "status": "expired"
}
```

The poll endpoint rate-limits to 1 request per second per session. The CLI polls every 2 seconds. The session expires after 15 minutes.

### Browser Flow (cloud.clef.sh)

The public site at `cloud.clef.sh/setup?session=sess_abc123` serves the onboarding flow. This is a lightweight page — not a full SPA. It handles:

#### Step 1: Authentication

The user signs up or logs in. Auth methods: email OTP, GitHub OAuth, Google OAuth. Uses the same Cognito pool as Pro (shared auth, per the auth architecture decision). The session is bound to the authenticated user.

The page shows context from the CLI session: "Setting up Clef Cloud for **my-app** → **production**".

If the user is already authenticated (existing session cookie), this step is skipped.

#### Step 2: Payment

Stripe Checkout (embedded or redirect). The user enters payment details and subscribes. For MVP, this is a single flat-rate plan. The Stripe session is linked to the device flow session.

If the user already has an active subscription (returning customer adding a new repo), this step is skipped.

#### Step 3: Provisioning

After payment succeeds, the Cloud API:

1. Creates the integration record in DynamoDB.
2. Provisions the KMS key in AWS.
3. Creates the key mapping (`clef:int_abc123/production` → ARN).
4. Generates a bearer token scoped to the integration.
5. Marks the device flow session as `complete` with the token, integration ID, and key ID.

#### Step 4: Success

The browser displays:

```
  Setup complete.

  Return to your terminal — Clef is finishing
  the configuration automatically.

  You can close this tab.
```

This page is important. The user needs a clear signal that the browser part is done and the CLI is handling the rest. No ambiguity. The page should be clean, branded, and feel like a successful purchase — not a dead end.

### CLI Terminal Output

The CLI provides continuous feedback while the browser flow is in progress:

```
$ clef cloud init --env production

𝄞  Clef Cloud

  Opening browser to set up Cloud for production...
  If the browser doesn't open, visit:
  https://cloud.clef.sh/setup?session=sess_abc123

  Waiting for authorization... (press Ctrl+C to cancel)
```

Spinner animates while polling. When auth completes but payment is pending:

```
  Logged in. Waiting for payment...
```

When the session completes:

```
  ✓ Authorized

  Provisioning Cloud backend for production...
  ✓ KMS key provisioned: clef:int_abc123/production

  Migrating production secrets to Cloud backend...
  ✓ api/production.enc.yaml
  ✓ database/production.enc.yaml
  ✓ payments/production.enc.yaml

  ✓ Cloud setup complete.

  Your production environment now uses Clef Cloud for encryption.
  Dev and staging continue to use age keys locally.

  Run `clef cloud status` to check your integration.
```

### Post-Auth CLI Steps

After the poll returns `status: "complete"`, the CLI performs these steps locally:

1. **Store token.** Write the bearer token to `~/.clef/credentials.yaml` (user-scoped, not project-scoped — the token is tied to the user's Clef account, not the repo).

2. **Verify keyservice binary.** Call `resolveKeyservicePath()` — the binary is bundled via npm `optionalDependencies` (`@clef-sh/keyservice-{platform}-{arch}`), installed automatically on `npm install`. If not found, error with guidance to reinstall the CLI.

3. **Update manifest.** Write `cloud.integrationId` and `cloud.keyId` to `clef.yaml`. Set `sops.backend: cloud` on the target environment.

4. **Re-encrypt.** For each SOPS file in the target environment:
   - Spawn the keyservice sidecar (using the new token).
   - Decrypt the file using the existing age backend (requires the user's age key).
   - Re-encrypt using the Cloud backend (SOPS sends the Clef key ID through the keyservice to the Cloud API, which wraps the DEK with the provisioned KMS key).
   - Write the re-encrypted file. The `sops.kms[0].arn` field now contains the Clef key ID.

5. **Remove age recipient (optional).** If the user's age public key was the only recipient for the target environment, it can be removed from the SOPS recipients list. The Cloud KMS key is now the sole encryption key for production. Dev and staging retain their age recipients.

6. **Commit guidance.** Print a message suggesting the user commit the changes:
   ```
   Changes ready to commit:
     modified: clef.yaml
     modified: api/production.enc.yaml
     modified: database/production.enc.yaml
     modified: payments/production.enc.yaml
   ```

### Error Handling

| Failure | CLI behavior |
|---------|-------------|
| Browser doesn't open | Print the URL manually. User can copy-paste. |
| Session expires (15 min) | "Session expired. Run `clef cloud init` again." |
| User cancels in browser | Poll returns `status: "cancelled"`. CLI exits cleanly. |
| Payment fails | Browser shows Stripe error. Session stays in `awaiting_payment`. User retries in browser. CLI keeps polling. |
| Network loss during poll | Retry with backoff. After 30s of failures: "Connection lost. Retrying..." After 2 min: "Could not reach Clef Cloud. Check your connection and run `clef cloud init` again." |
| Keyservice binary missing | "clef-keyservice not found. Reinstall the CLI: `npm install @clef-sh/cli`." The binary is bundled — if missing, the npm install is broken. |
| Re-encryption fails | "Failed to re-encrypt api/production.enc.yaml: <error>. Your files have not been modified. Fix the issue and run `clef cloud init` again." Re-encryption is atomic per file — either all files migrate or none do. |

### Idempotency

`clef cloud init --env production` is safe to re-run. On subsequent runs:

1. If `cloud.integrationId` already exists in the manifest, skip auth + payment.
2. If files are already encrypted with the Clef key ID, skip re-encryption.
3. If partial state exists (manifest updated but files not re-encrypted), resume from where it left off.

### Analytics Surface (cloud.clef.sh)

The public site enables standard web analytics on the onboarding funnel:

| Event | Tracking point |
|-------|---------------|
| Session initiated | CLI version, OS, repo name, environment |
| Page loaded | Device flow session landed |
| Auth started | Method selected (email, GitHub, Google) |
| Auth completed | Time to auth |
| Payment started | Stripe Checkout opened |
| Payment completed | Plan, amount, time to payment |
| Setup complete | Full funnel conversion, total time |
| Drop-off | Last step reached before session expiry |

This data is not available if the flow runs inside the local UI. The public site is the right place for conversion optimization.

### `clef cloud login`

Separate from `clef cloud init`. For users who are already set up but need to re-authenticate (expired token, new machine):

```
$ clef cloud login

𝄞  Clef Cloud

  Opening browser to log in...

  Waiting for authorization...

  ✓ Logged in as james@clef.sh
  Token saved to ~/.clef/credentials.yaml
```

Uses the same device flow but skips payment and provisioning. The poll response returns a fresh token for the existing integration.

# 7. Testing Strategy

## 7.1 Unit Tests

All unit tests mock the keyservice interaction. The SopsClient tests verify:

- `buildEncryptArgs` produces `--kms clef:int_abc123/production` for the `cloud` backend.
- Keyservice arguments (`--enable-local-keyservice=false`, `--keyservice`) are included when `keyserviceAddr` is set.
- `detectBackend` returns `"cloud"` when `sops.kms[0].arn` starts with `clef:`.
- `detectBackend` returns `"awskms"` when `sops.kms[0].arn` starts with `arn:aws:kms:`.
- `extractRecipients` returns Clef key IDs for the `cloud` backend.

Manifest parser tests verify:

- `cloud` is accepted in `VALID_BACKENDS`.
- Validation fails when `cloud` backend is used without `cloud.keyId`.
- Validation fails when `cloud.keyId` doesn't match the expected format.
- Validation passes with a well-formed Cloud manifest.

## 7.2 Keyservice Lifecycle Tests

The keyservice lifecycle manager is tested with a mock subprocess:

- Port discovery from stdout `PORT=<port>` line.
- Timeout when port line is not received.
- Clean shutdown via `kill()`.
- Error propagation when the binary exits unexpectedly.

## 7.3 Integration Tests

Integration tests require a running keyservice binary and a Cloud API (or mock). These verify the full flow:

- CLI spawns keyservice, encrypts a file with a Clef key ID, decrypts it, and verifies the round-trip.
- The encrypted file contains `sops.kms[0].arn: clef:...`.
- The CLI correctly detects the `cloud` backend when reading an existing Cloud-encrypted file.

# 8. Pack Flags: `--remote` and `--push`

The `clef pack` command gains two new flags for Cloud integration. These are the CI integration points.

## 8.1 `clef pack --remote`

Sends the encrypted files to the Cloud pack endpoint. Cloud decrypts and packs the artifact.

```bash
clef pack --remote --identity api-gateway --env production
```

**CLI behavior:**

1. Parse manifest, resolve scoped files for the identity + environment.
2. Assemble a minimal bundle: `clef.yaml` + scoped `.enc.yaml` files.
3. Read Cloud token from `~/.clef/credentials.yaml`.
4. `POST /api/v1/cloud/pack` with the config JSON and gzipped bundle.
5. Wait for response. Print artifact revision on success.

**No keyservice needed.** The CLI sends encrypted files. Cloud has KMS access. This is the recommended path for most users — their CI only needs the Cloud token.

**Hardpack upgrade is transparent.** The same command routes to a Lambda or Nitro Enclave based on tier. The CLI doesn't know or care which backend packed the artifact.

## 8.2 `clef pack --push`

Packs locally, then uploads the artifact to Cloud for serving.

```bash
clef pack --push --identity api-gateway --env production
```

**CLI behavior:**

1. Spawn keyservice sidecar (needs Cloud token for KMS access).
2. Pack locally using existing `packArtifact()` from core.
3. `POST /api/v1/cloud/artifacts/{identity}/{environment}` with the packed artifact.
4. Wait for response. Print confirmation on success.

**Keyservice IS needed.** The CI runner decrypts via the keyservice sidecar. This is the path for users who don't want to send encrypted files to Cloud (air-gapped, high-security).

## 8.3 `clef pack` (no flag)

Existing behavior, unchanged. Packs locally, writes artifact to disk. No Cloud interaction. For self-hosted agent users.

## 8.4 Files Changed (pack flags)

| File | Change |
|------|--------|
| `packages/cli/src/commands/pack.ts` | Add `--remote` and `--push` flags |
| `packages/core/src/cloud/pack-client.ts` | New file: HTTP client for Cloud pack endpoint |
| `packages/core/src/cloud/artifact-client.ts` | New file: HTTP client for artifact upload |

# 9. All Files Changed

| File | Change |
|------|--------|
| `packages/core/src/types/index.ts` | Add `"cloud"` to `BackendType`, add `keyId` to `ClefCloudConfig` |
| `packages/core/src/manifest/parser.ts` | Add `"cloud"` to `VALID_BACKENDS`, add Cloud validation rules |
| `packages/core/src/sops/client.ts` | Add `case "cloud"` to `buildEncryptArgs`, update `detectBackend` and `extractRecipients`, add `keyserviceAddr` support |
| `packages/core/src/sops/resolver.ts` | Add `resolveKeyservicePath()` function |
| `packages/core/src/cloud/keyservice.ts` | New file: keyservice sidecar lifecycle manager |
| `packages/core/src/cloud/config.ts` | New file: Cloud config reader (token, endpoint from `~/.clef/credentials.yaml`) |
| `packages/core/src/cloud/pack-client.ts` | New file: HTTP client for Cloud pack endpoint (`--remote`) |
| `packages/core/src/cloud/artifact-client.ts` | New file: HTTP client for artifact upload (`--push`) |
| `packages/cli/src/commands/cloud.ts` | New file: `clef cloud init`, `clef cloud login`, `clef cloud status` |
| `packages/cli/src/commands/pack.ts` | Add `--remote` and `--push` flags |
| `packages/core/src/migration/backend.ts` | Add `"cloud"` as a migration target |

# 9. Architectural Decisions

## 9.1 Lazy Spawn vs. Persistent Daemon (Decided: Lazy Spawn)

The keyservice could run as a persistent background daemon (started on `clef cloud init`, stays running). But this adds complexity: PID files, health checks, stale daemon detection, port conflicts. A lazy spawn per CLI invocation is simpler. The binary starts in ~50ms and exits when the command finishes. The only downside is the startup cost per command, which is negligible compared to SOPS's own startup time.

## 9.2 SopsClient Constructor vs. Per-Method Injection (Decided: Constructor)

The keyservice address is set once per CLI command and applies to all SOPS operations. Constructor injection is simpler and makes it impossible to accidentally omit the keyservice on a specific call.

## 9.3 Cloud Backend vs. Overloaded awskms (Decided: Separate Backend)

The `cloud` backend could have been implemented as a special case of `awskms` (detect Clef key ID format in the ARN field). But this overloads the semantics: `awskms` means "local AWS credentials" to users, and to internal code that decides whether to look for AWS config. A separate backend type makes the intent explicit and avoids conditional logic scattered across the codebase.

## 9.4 Single keyId vs. Per-Environment keyId (Decided: Single for MVP)

The manifest has one `cloud.keyId` shared across all Cloud-enabled environments. In MVP, only one environment (production) uses Cloud. When multi-environment Cloud is supported, this could become a map:

```yaml
cloud:
  integrationId: int_abc123
  keys:
    production: clef:int_abc123/production
    staging: clef:int_abc123/staging
```

This is a future enhancement. The current schema is forward-compatible — adding `keys` alongside `keyId` and deprecating `keyId` is straightforward.

## 9.5 Public Site vs. Local UI for Onboarding (Decided: Public Site)

The auth + payment flow could run inside the local UI (`127.0.0.1:7777`) or on a public site (`cloud.clef.sh`). The local UI has the advantage of being already running and familiar to the user. But it has critical limitations for a sales funnel:

- **No analytics.** The local UI has no Plausible/Posthog integration. We cannot track funnel conversion, drop-off points, or A/B test the onboarding flow.
- **No Stripe embed.** Stripe Checkout requires a publicly reachable return URL for webhooks and 3D Secure redirects. A localhost URL cannot receive these callbacks.
- **No SEO.** The onboarding pages cannot be indexed or linked to from marketing.
- **No cross-device.** If the user starts on their laptop and wants to finish payment on their phone (e.g., for a corporate card), the local UI is unreachable.
- **Different lifecycle.** The local UI is ephemeral (started by `clef ui`, stopped when done). The public site is always available.

The device flow bridges the gap: the CLI initiates the session, the public site handles auth + payment with full web analytics, and the CLI picks up the result via polling. The user gets the convenience of a single CLI command with the backend getting proper funnel instrumentation.

## 9.6 Device Flow vs. Direct Token Entry (Decided: Device Flow)

The alternative is to have the user create an API key on the web dashboard and paste it into the CLI (`clef cloud init --token clef_tok_...`). This is simpler to implement but worse in every other way:

- Context switching: user must navigate to dashboard, create key, copy it, return to terminal.
- Error-prone: token copy-paste can fail (partial copy, trailing whitespace).
- No integrated payment: user must separately subscribe before the token works.
- No analytics: we lose the funnel from CLI → signup → payment.

The device flow is more work upfront but produces a dramatically better conversion experience. `gh auth login` proved this pattern works for developer tools.

## 9.7 Credential Storage Location (Decided: Split)

Cloud config is split between two locations:

- **Project-scoped** (`clef.yaml`): `cloud.integrationId`, `cloud.keyId`. These are shared across the team via git. Every developer on the repo sees the same Cloud config.
- **User-scoped** (`~/.clef/credentials.yaml`): bearer token, Cloud API endpoint. These are per-user and never committed. Different developers authenticate with their own tokens.

This mirrors how AWS credentials work: the resource identifiers (ARNs) are in code, the credentials (`~/.aws/credentials`) are per-user.

# 10. Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Cloud Key Resolution PRD | Draft | Defines key ID format, DynamoDB schema, API resolution flow |
| `clef-sh/keyservice` binary | Exists | Go binary, gRPC key service, npm platform packages |
| Cloud API: KMS endpoints | Not started | `POST /api/v1/cloud/kms/{encrypt,decrypt}`, key management CRUD |
| Cloud API: device flow endpoints | Not started | `POST /api/v1/device/init`, `GET /api/v1/device/poll/:sessionId` |
| `cloud.clef.sh` public site | Not started | Auth + payment onboarding flow, analytics |
| Stripe integration | Not started | Embedded Checkout on `cloud.clef.sh`, webhook to complete device session |
| `~/.clef/credentials.yaml` schema | Not started | User-scoped token storage |

# 11. Open Questions

1. **Multiple integrations.** Can a single repo connect to multiple Cloud integrations (e.g., different integrations for different environments)? The manifest schema supports one `cloud` block. Multiple integrations would require a different schema shape.

2. **Offline fallback.** What happens when the Cloud API is unreachable? SOPS will fail with a gRPC error. Should the CLI provide a more helpful message? Should there be a cached credential fallback? For MVP, a clear error message is sufficient — Cloud-managed environments require network access by definition.

3. **Token refresh.** How long do bearer tokens live? If they expire, the CLI needs to detect 401 responses and prompt `clef cloud login`. Should tokens be short-lived (1 hour) with a refresh token, or long-lived (90 days) with manual refresh? Long-lived is simpler for MVP; short-lived is more secure for enterprise.

4. **Team onboarding.** After the first developer runs `clef cloud init` and commits the manifest changes, what does the second developer do? They need a token but don't need to repeat setup. Likely: `clef cloud login` (device flow, auth only, no payment, no provisioning). The manifest already has the `cloud` config from git.

5. **Free trial.** Should the Stripe step be skippable for a trial period? A 14-day free trial with no credit card would lower the conversion barrier but adds complexity to the device flow (skip payment step, add trial expiry handling). Alternatively: require payment but offer a money-back guarantee.
