# Clef Cloud: Product Architecture

Product Requirements Document

Version 0.1 | April 2026

Classification: Internal — Engineering & Product

**DRAFT**

*This document defines the full Cloud product: what it is, what it sells, how the pieces fit together, and how they upgrade. It is the top-level reference for Cloud. Detailed specifications for individual components are in separate PRDs: Cloud Key Resolution (key ID scheme, DynamoDB mapping) and Cloud CLI Integration (CLI changes, device flow, keyservice lifecycle).*

# 1. What Cloud Is

Clef Cloud is a managed upgrade path from age keys to production-grade KMS encryption with zero AWS knowledge required.

The developer's journey:

1. `clef init` — age keys, local dev, free, zero setup. They get the mental model: namespaces, environments, encrypted files in git. This is the free product.

2. "How do I get secrets into my production runtime?" — They've outgrown local age keys. They need KMS encryption, artifact packaging, and a serve endpoint. They don't want to learn AWS IAM, KMS key policies, or SOPS KMS configuration.

3. `clef cloud init --env production` — One command. We provision a KMS key, migrate their production files, and give them a serve URL. They understand age → Cloud the same way they understand localhost → production. The abstraction holds.

The pitch: **"You already know age keys. Now your production secrets need real KMS. One command. We handle everything you don't want to learn about AWS."**

# 2. What Cloud Sells

Cloud sells three things. Each can be adopted independently, but the typical path is all three.

## 2.1 Managed KMS

A Clef-managed AWS KMS key, abstracted behind a Clef key ID (`clef:int_abc123/production`). The user never sees ARNs, IAM policies, or the KMS console. Encrypt and decrypt operations are proxied through the keyservice sidecar and Cloud API.

**User experience:** After `clef cloud init`, their existing workflow (`clef set`, `clef get`, `clef rotate`) works identically. The only visible change is that `sops.kms[0].arn` in their encrypted files says `clef:int_abc123/production` instead of an age recipient.

**What we operate:** KMS key lifecycle, key rotation, key policy management, the Cloud API encrypt/decrypt endpoints, the DynamoDB key mapping table.

**See:** Cloud Key Resolution PRD for the key ID format and resolution flow.

## 2.2 Hosted Pack

A Cloud-hosted pack service that builds artifacts from the user's encrypted files. The user sends the encrypted files; Cloud decrypts via the managed KMS key, packs the artifact, and stores it.

**User experience:**
```bash
clef pack --remote --identity api-gateway --env production
```

The CLI bundles the manifest and scoped encrypted files into a minimal payload, POSTs it to the Cloud pack endpoint, and receives an artifact ID. The user's CI never needs KMS access. The only credential is the Cloud bearer token.

**What we operate:** Pack Lambda (decrypts SOPS files via managed KMS, produces AES-256-GCM encrypted artifact, wraps DEK with KMS), artifact storage in S3.

**The Hardpack seam:** The pack endpoint is the upgrade path to Nitro Enclave attestation. The user's command doesn't change. The artifact format doesn't change. The Cloud API routes based on tier:

- **Basic tier:** Pack Lambda (same pack code as `packages/core`)
- **Hardpack tier:** Nitro Enclave (same HTTP contract, adds attestation receipt)

The user never knows which backend packed their artifact. The upgrade is a tier flag in DynamoDB.

**See:** Hardpack Cloud Service PRD (`clef-sh/hardpack/PRD-cloud-service.md`) for the enclave architecture.

## 2.3 Serve Endpoint

An always-on HTTPS endpoint that serves decrypted secrets to the user's runtime.

**User experience:**
```bash
curl -H "Authorization: Bearer $CLEF_TOKEN" \
  https://serve.clef.sh/s/v1/api-gateway/secrets
```

Returns JSON with the decrypted secrets for the `api-gateway` service identity in production. The runtime fetches secrets on startup (or via the `@clef-sh/runtime` SDK with polling + caching).

**What we operate:** API Gateway → Serve Lambda (Express app from `@clef-sh/agent` wrapped in Lambda handler). Reads packed artifact from S3, unwraps DEK via KMS, decrypts AES-256-GCM, returns plaintext. Nothing cached between requests.

**Endpoints:**
```
GET /s/v1/{identity}/secrets      All secrets for the identity
GET /s/v1/{identity}/secrets/:key Single secret by key name
GET /s/v1/{identity}/keys         List key names
GET /s/v1/{identity}/health       Status, revision, last pack timestamp
```

# 3. What Cloud Is Not

**Cloud is not Pro.** Pro is governance: cross-repo visibility, policy engine, compliance reporting, audit logs. Pro uses a GitHub App with `actions:write` to trigger `clef report` in CI. Pro never sees ciphertext or decrypted values. Pro's audience is the security team.

Cloud is infrastructure: managed KMS, pack, serve. Cloud's audience is the developer shipping to production. Cloud does see ciphertext (it holds the KMS key). Cloud does decrypt (during pack and serve).

The products are complementary. A team can use Cloud without Pro (production encryption without governance). A team can use Pro without Cloud (governance over self-managed KMS). Most enterprise teams will use both.

**Cloud does not require a GitHub App.** There is no webhook, no `contents:read`, no App install step. Cloud is VCS-agnostic. The user runs `clef pack --remote` in whatever CI they have — GitHub Actions, GitLab CI, Bitbucket Pipelines, Jenkins, CircleCI, self-hosted. The only integration point is a bearer token in CI secrets.

**Cloud does not replace self-managed KMS.** Users who want to operate their own AWS KMS keys (or GCP, Azure) continue to use the `awskms`/`gcpkms`/`azurekv` backends directly. Cloud is for users who don't want to manage KMS themselves. The migration path out is always available: `clef migrate-backend --env production --aws-kms-arn THEIR-OWN-KEY`.

# 4. Architecture

## 4.1 System Overview

```
Developer Machine                    CI Runner
==================                   =========

clef set/get/rotate                  clef pack --remote
    |                                    |
    v                                    v
clef-keyservice (localhost)          POST /api/v1/cloud/pack
    |                                    |
    v                                    |
POST /api/v1/cloud/kms/encrypt       (bundle: manifest +
POST /api/v1/cloud/kms/decrypt        scoped .enc.yaml files)
    |                                    |
    +----------------+-------------------+
                     |
                     v
        +---------------------------+
        |  Clef Cloud (AWS)         |
        |                           |
        |  API Gateway              |
        |      |                    |
        |  +---+---+  +----------+ |
        |  | KMS   |  | Pack     | |    Hardpack seam:
        |  | proxy |  | Lambda   | |    Pack Lambda OR
        |  +---+---+  +----+-----+ |    Nitro Enclave
        |      |            |       |    (same contract)
        |      v            v       |
        |  +------+   +---------+  |
        |  | AWS  |   | S3      |  |
        |  | KMS  |   | Artifact|  |
        |  +------+   +----+----+  |
        |                   |       |
        |  +----------------+---+   |
        |  | Serve Lambda       |   |
        |  | (Express/agent)    |   |
        |  +--------------------+   |
        +---------------------------+
                     |
                     v
            User's Runtime
            GET /s/v1/{identity}/secrets
```

## 4.2 Components

### KMS Proxy (existing Cloud API endpoints)

Handles encrypt/decrypt requests from the keyservice sidecar. Resolves Clef key IDs to AWS ARNs via DynamoDB. Calls AWS KMS SDK. This is the managed KMS product.

```
POST /api/v1/cloud/kms/encrypt    { keyArn: "clef:...", plaintext: "<b64>" }
POST /api/v1/cloud/kms/decrypt    { keyArn: "clef:...", ciphertext: "<b64>" }
```

### Pack Endpoint (new)

Accepts a minimal bundle (manifest + scoped encrypted files), decrypts via managed KMS, packs an artifact, stores it in S3.

```
POST /api/v1/cloud/pack
Content-Type: multipart/form-data

config: { identity, environment, ttl? }
bundle: <gzipped tarball of manifest + .enc.yaml files>
```

Response:
```json
{
  "status": "success",
  "revision": "1712044800000-a1b2c3d4",
  "artifactSize": 4096,
  "identity": "api-gateway",
  "environment": "production"
}
```

#### One binary, two deployment targets

The pack Lambda is **not** a TypeScript wrapper around `packages/core`. It is the same Go binary from `clef-sh/hardpack`, compiled without the `nitro` build tag. The hardpack codebase is already architected for this:

The core pack pipeline (`internal/core/pack/packer.go`) depends on two interfaces — `adapter.KMSClient` and `resolve.SopsDecryptor` — neither of which knows about Nitro Enclaves. Everything enclave-specific is confined to `internal/adapter/aws/`. The `attestedKMSClient` (`kms.go`) already handles both cases: when `attestationDoc` is `nil`, it does a plain KMS Decrypt; when present, it uses the `Recipient` parameter for attestation-bound decryption.

The Lambda adapter is a ~80-line implementation of `PlatformAdapter`:

```
internal/adapter/aws/
  enclave.go   ← NitroAdapter (existing, //go:build nitro)
  lambda.go    ← LambdaAdapter (new, //go:build !nitro)
  kms.go       ← attestedKMSClient (shared, handles both)
```

```
LambdaAdapter implements PlatformAdapter:
  Boot()     → returns metadata without attestation (no NSM, no PCR0)
  KMS()      → returns plain KMSClient using Lambda execution role credentials
  Shutdown() → no-op
```

Build targets:

```makefile
build:          # Enclave binary (existing)
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags nitro ./cmd/runner

build-lambda:   # Lambda binary (new)
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./cmd/runner
```

No `-tags` defaults to `!nitro`, which gives the Lambda binary. Nitro-specific code (NSM device, vsock transport, attestation document binding) doesn't even compile into the Lambda binary.

**What stays identical across both:**

| Layer | Same code? |
|-------|-----------|
| Manifest parsing | Yes |
| Matrix resolution | Yes |
| SOPS decryption | Yes (pluggable KMS via `KMSDecryptFunc`) |
| AES-256-GCM pack | Yes |
| DEK wrap with KMS | Yes |
| ECDSA signing | Yes |
| Artifact JSON format | Yes |

**What differs:**

| | Lambda (`!nitro`) | Nitro Enclave (`nitro`) |
|---|---|---|
| KMS transport | Standard HTTPS | Vsock → vsock-proxy → KMS |
| KMS Decrypt | Plain Decrypt call | Decrypt with Recipient (attestation-bound) |
| Boot | Lambda execution role | NSM attestation + RSA key gen |
| Artifact metadata | No PCR0, no attestation receipt | Includes PCR0 + attestation |

The tier upgrade from basic → hardpack is literally swapping which binary the infrastructure runs. Same source, same pack logic, same artifact format. No behavioral drift between tiers, no "Lambda does it slightly differently" bugs.

```
clef pack --remote  →  Cloud API  →  tier check
                                      ├─ basic:    Lambda running hardpack binary (LambdaAdapter)
                                      └─ hardpack: Enclave running hardpack binary (NitroAdapter)
```

**Pack bundle contents** (assembled by CLI, same format for both tiers):
```
bundle/
  clef.yaml                          # Manifest
  secrets/
    api/production.enc.yaml          # Scoped SOPS files (ciphertext)
    database/production.enc.yaml
```

No application source code. No git objects for basic tier (source integrity verification via Merkle proof is a Hardpack feature). The bundle contains only what the pack process needs.

### Artifact Storage (S3)

```
s3://clef-cloud-artifacts/
  {projectId}/{identity}/{environment}/
    artifact.json        # Current artifact
    archive/
      {revision}.json    # Previous artifacts (retention policy TBD)
```

Each `clef pack --remote` overwrites the current artifact. Previous versions are archived for rollback.

### Serve Lambda (existing agent, wrapped)

Express app from `@clef-sh/agent` wrapped in a Lambda handler via serverless-express. Same routes, same contract as self-hosted agent. The only difference is the artifact source: S3 instead of local filesystem.

Bearer token auth. Token hash lookup in DynamoDB resolves to project + identity.

#### Caching model

The `@clef-sh/agent` runtime already implements a two-tier caching architecture that maps cleanly to Lambda's execution model:

**Cached mode** (default, `CLEF_AGENT_CACHE_TTL=300`):

```
Cold start:
  S3 GetObject → KMS Decrypt (unwrap DEK) → AES-GCM decrypt → SecretsCache (in-memory)
  ~100-200ms total

Warm start (Lambda reuse, same execution environment):
  Serve directly from SecretsCache
  ~1-5ms (no S3, no KMS)

Background poller:
  Runs every cacheTtl/10 (default 30s)
  Content-hash short-circuit: skips parse/validate/decrypt if S3 ETag unchanged
  On new artifact: atomic swap into SecretsCache
```

Lambda keeps the execution environment alive for ~5-15 minutes between invocations. The `SecretsCache`, `ArtifactPoller`, and Express app all survive across warm starts. For any service hitting the endpoint more than once every 15 minutes (which is every production service), the vast majority of requests are served from in-memory cache with zero S3 or KMS calls.

**JIT mode** (`CLEF_AGENT_CACHE_TTL=0`):

```
Every request:
  Read encrypted artifact from EncryptedArtifactStore (in-memory, pre-fetched)
  → KMS Decrypt (unwrap DEK) → AES-GCM decrypt → return plaintext
  ~50-100ms per request

Background poller:
  Polls S3 every 5s, updates EncryptedArtifactStore if changed
  No plaintext in memory between requests
```

JIT mode uses KMS as a live authorization gate — every request proves the caller still has KMS access. More secure, but adds KMS latency per request. Appropriate for high-security deployments; overkill for most Cloud users.

**TTL expiry handling:**

The `SecretsCache.isExpired(ttlSeconds)` check compares `Date.now() - swappedAt` against the configured TTL. If a Lambda freezes and wakes after the TTL has passed, the TTL guard middleware returns 503 until the poller completes a fresh fetch. Stale secrets are never served — this is correct behavior.

**Recommendation for Cloud defaults:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| `CLEF_AGENT_CACHE_TTL` | `300` (5 min) | Matches Lambda warm lifetime. Most requests served from cache. |
| Polling interval | `30s` (auto: TTL/10) | Frequent enough to pick up new deployments quickly. |
| Disk cache | Disabled | Lambda has no persistent filesystem. `/tmp` could be used but adds complexity for marginal benefit given the in-memory cache. |

**Latency breakdown:**

| Scenario | S3 calls | KMS calls | Latency |
|----------|----------|-----------|---------|
| Warm start, cache valid | 0 | 0 | ~1-5ms |
| Warm start, poller refresh (ETag match) | 1 (HEAD) | 0 | ~10-20ms (background) |
| Warm start, poller refresh (new artifact) | 1 (GET) | 1 | ~100-200ms (background) |
| Cold start | 1 (GET) | 1 | ~100-200ms (blocking) |
| JIT mode, every request | 0 (from store) | 1 | ~50-100ms |

## 4.3 DynamoDB Schema

All Cloud records live in the existing Clef DynamoDB table.

| Record | PK | SK | Key fields |
|--------|----|----|-----------|
| Project | `SYNC_PROJECT#{projectId}` | `METADATA` | team, tier (basic/hardpack), status, createdAt |
| Integration | `INTEGRATION#{integrationId}` | `METADATA` | projectId, repoName (optional) |
| Key mapping | `INTEGRATION#{integrationId}` | `KEY#{keyAlias}` | awsKmsArn, provider, region, status |
| Serve token | `PROJECT_TOKEN#{tokenHash}` | `METADATA` | projectId, identity |
| Identity | `PROJECT_IDENTITY#{projectId}#{identity}` | `METADATA` | environment, lastRevision, artifactS3Path |
| Device session | `DEVICE_SESSION#{sessionId}` | `METADATA` | status, token, integrationId, keyId, expiresAt (TTL) |

### Access Patterns

| Pattern | Key condition |
|---------|--------------|
| Resolve Clef key ID | `pk = INTEGRATION#<id>`, `sk = KEY#<alias>` |
| Auth serve request | `pk = PROJECT_TOKEN#<hash>`, `sk = METADATA` |
| Get identity artifact | `pk = PROJECT_IDENTITY#<projectId>#<identity>`, `sk = METADATA` |
| Poll device session | `pk = DEVICE_SESSION#<sessionId>`, `sk = METADATA` |
| List keys for integration | `pk = INTEGRATION#<id>`, `sk begins_with KEY#` |
| List identities for project | `pk begins_with PROJECT_IDENTITY#<projectId>#` |

# 5. Onboarding Flow

See Cloud CLI Integration PRD, Section 6.3 for the full device flow specification. Summary:

```
$ clef cloud init --env production

1. CLI initiates device flow session
2. Browser opens to cloud.clef.sh (public site)
3. User signs up / logs in
4. Stripe Checkout (payment)
5. "You can close this tab"
6. CLI picks up token + integration ID + key ID
7. CLI updates clef.yaml (cloud backend for production)
8. CLI re-encrypts production files from age to Cloud KMS
9. Done. User commits changes.
```

No GitHub App install. No webhook configuration. No VCS-specific steps.

# 6. CI Integration

After `clef cloud init`, the user adds a pack step to their CI pipeline.

## 6.1 Hosted Pack (recommended)

```yaml
# GitHub Actions
- name: Pack and deploy secrets
  run: clef pack --remote --identity api-gateway --env production
  env:
    CLEF_CLOUD_TOKEN: ${{ secrets.CLEF_CLOUD_TOKEN }}
```

```yaml
# GitLab CI
pack_secrets:
  script:
    - clef pack --remote --identity api-gateway --env production
  variables:
    CLEF_CLOUD_TOKEN: $CLEF_CLOUD_TOKEN
```

```yaml
# Bitbucket Pipelines
- step:
    script:
      - clef pack --remote --identity api-gateway --env production
```

The `--remote` flag sends the bundle to Cloud. Cloud decrypts and packs. The CI runner never has KMS access. The only secret is the Cloud bearer token.

**CLI install in CI:** The user installs the Clef CLI in CI via npm (`npx @clef-sh/cli`) or a pre-built binary. The keyservice binary is NOT needed for `--remote` pack — the CLI sends encrypted files to Cloud, which handles decryption.

## 6.2 Local Pack with Push (advanced)

For users who want to pack locally (e.g., for air-gapped environments or to avoid sending encrypted files to Cloud):

```yaml
- run: clef pack --identity api-gateway --env production --push
  env:
    CLEF_CLOUD_TOKEN: ${{ secrets.CLEF_CLOUD_TOKEN }}
```

The `--push` flag packs locally (CI needs keyservice binary + KMS access via Cloud token) and uploads the artifact to Cloud's S3. Cloud only serves; it never sees the plaintext.

## 6.3 Comparison

| | `--remote` | `--push` |
|---|---|---|
| Where pack runs | Cloud Lambda | User's CI |
| CI needs keyservice | No | Yes |
| CI needs KMS access | No (Cloud decrypts) | Yes (via Cloud token + keyservice) |
| Encrypted files sent to Cloud | Yes (for decryption) | No |
| Trust model | Cloud sees ciphertext during pack | Cloud only stores/serves artifact |
| Hardpack upgrade | Automatic (tier flag) | N/A (local pack) |
| Recommended for | Most users | Air-gapped / high-security |

# 7. Upgrade Paths

## 7.1 Age → Cloud

```
clef cloud init --env production
```

Covered in Section 5 and the CLI Integration PRD.

## 7.2 Cloud (basic) → Hardpack

The user's tier flag changes in DynamoDB. `clef pack --remote` now routes to a Nitro Enclave instead of a Lambda. The command, bundle format, and artifact format are identical. The user gets attestation receipts on top.

```
Before:  clef pack --remote  →  Cloud API  →  Pack Lambda      →  S3
After:   clef pack --remote  →  Cloud API  →  Nitro Enclave    →  S3
                                               (+ attestation)
```

No client-side changes. No re-encryption. No manifest updates.

**Both tiers run the same Go binary from `clef-sh/hardpack`.** The Lambda runs the binary compiled without the `nitro` build tag (`LambdaAdapter`). The enclave runs it compiled with `nitro` (`NitroAdapter`). Same pack pipeline, same SOPS decryption, same artifact format. The only differences are KMS transport (HTTPS vs vsock), attestation (none vs PCR0-bound), and how credentials are obtained (Lambda role vs forwarded over vsock). See Section 4.2 "Pack Endpoint" for the full architecture.

The seam is in the Cloud API: look up tier in DynamoDB, route to the correct backend. The Hardpack PRD (`clef-sh/hardpack/PRD-cloud-service.md`) defines the enclave infrastructure.

## 7.3 Cloud → Self-Managed KMS

```
clef migrate-backend --env production --aws-kms-arn arn:aws:kms:us-east-1:THEIR-ACCOUNT:key/...
```

Re-encrypts all production files from the Clef key ID to the user's own KMS ARN. After migration, `sops.kms[0].arn` contains their ARN, not a Clef key ID. SOPS calls KMS directly using the user's local AWS credentials. No keyservice needed. The user now owns their keys entirely.

## 7.4 Cloud → Self-Hosted Serve

Users who want to serve secrets from their own infrastructure can pack locally and run the `@clef-sh/agent` directly:

```bash
# Pack locally, serve with self-hosted agent
clef pack --identity api-gateway --env production --output ./artifacts/
clef-agent --artifact ./artifacts/api-gateway-production.json --port 8080
```

The agent binary is the same Express app that Cloud's Serve Lambda runs. Same API contract. The user just operates it themselves.

# 8. Security Model

## 8.1 What Cloud Sees

| Data | When | Why |
|------|------|-----|
| Clef key ID | Every encrypt/decrypt | Resolves to KMS ARN |
| DEK (32 bytes, encrypted) | Every encrypt/decrypt | Wraps/unwraps via KMS |
| Encrypted SOPS files | `--remote` pack only | Decrypts to produce artifact |
| Packed artifact (encrypted) | After pack | Stores for serving |
| Plaintext secrets | Transiently during pack + serve | In Lambda memory only, never persisted |

## 8.2 What Cloud Never Sees

- User's age private keys (age is local-only)
- Repository source code (pack bundle contains only manifest + .enc.yaml)
- Git history or metadata (no `contents:read`, no webhook)
- Secrets for environments not using Cloud (dev/staging stay on age)

## 8.3 Trust Boundary

Cloud is a trusted operator for production secrets. The user trusts Clef's Lambda and KMS management for the `cloud` backend. This is the same trust model as any managed KMS service (AWS KMS itself, GCP Cloud KMS, Azure Key Vault) — the provider operates the key.

For users who want to reduce trust in Clef, the upgrade path is:

1. **Self-managed KMS** — user owns the key, Clef has no access
2. **Hardpack** — enclave attestation proves what code touched the secrets, hardware-enforced isolation excludes Clef operators from the data path

Cloud's basic tier is "trust us, we manage the KMS." Hardpack is "verify the enclave, don't trust us." Both are valid positions for different customers.

# 9. Infrastructure (AWS)

## 9.1 Compute

| Component | Implementation | Notes |
|-----------|---------------|-------|
| KMS proxy | Lambda behind API Gateway | Stateless, scales to zero |
| Pack (basic) | Lambda behind API Gateway | Hardpack Go binary, `!nitro` build, ~2-10s per pack |
| Pack (hardpack) | EC2 with Nitro Enclave | Same Go binary, `nitro` build, warm pool (see Hardpack PRD) |
| Serve endpoint | Lambda behind API Gateway | Stateless, ~100-500ms per request |

The pack Lambda runs the same Go binary from `clef-sh/hardpack` compiled without the `nitro` tag. It is not a separate codebase. The Nitro Enclave runs the same binary compiled with `nitro`. One source repo, two compilation targets, zero behavioral drift.

All Lambdas run in a VPC with KMS and S3 VPC endpoints. No internet egress.

## 9.2 Storage

| Store | Purpose | Encryption |
|-------|---------|-----------|
| DynamoDB | Project records, key mappings, tokens, sessions | AWS-managed encryption at rest |
| S3 | Packed artifacts | SSE-S3 (artifact is already AES-256-GCM encrypted) |

## 9.3 KMS

One AWS KMS key per Cloud integration. Created during `clef cloud init`, stored in DynamoDB key mapping. Used for:

- SOPS encrypt/decrypt (DEK wrapping via keyservice proxy)
- Artifact envelope wrapping (during pack)
- Artifact unwrapping (during serve)

Key rotation is managed by Clef. AWS KMS automatic key rotation (annual) is enabled. The Clef key ID is stable across rotations — the DynamoDB mapping is updated, clients are unaffected.

# 10. Pricing (MVP)

Flat monthly price. No per-request metering for MVP.

Included:
- One managed KMS key
- Unlimited encrypt/decrypt operations (via keyservice)
- Unlimited `clef pack --remote` invocations
- Serve endpoint with reasonable rate limits
- Up to N service identities (TBD)

The unit of value is "production encryption that just works." Don't make the user think about request counts.

# 11. Milestones

## Phase 1: Managed KMS

1. Cloud API: device flow endpoints (`/device/init`, `/device/poll`)
2. Cloud API: KMS proxy endpoints (`/cloud/kms/encrypt`, `/cloud/kms/decrypt`)
3. Cloud API: key management endpoints (`/cloud/keys` CRUD)
4. DynamoDB: key mapping table, device session table
5. `cloud.clef.sh`: auth + payment onboarding site
6. CLI: `clef cloud init` (device flow, keyservice download, manifest update, re-encryption)
7. CLI: `clef cloud login` (re-auth for existing integrations)
8. CLI: `cloud` backend type, SopsClient changes, keyservice lifecycle

**Result:** User can `clef cloud init` and use managed KMS for encrypt/decrypt. No pack or serve yet — they use `clef exec` locally or self-hosted agent.

## Phase 2: Pack + Serve

1. Cloud API: pack endpoint (`/cloud/pack`)
2. CLI: `clef pack --remote` flag
3. S3: artifact storage bucket
4. Serve Lambda: agent wrapped in Lambda handler
5. CLI: `clef pack --push` flag (local pack, remote store)
6. DynamoDB: identity records, serve tokens
7. CLI: `clef cloud status` command

**Result:** Full Cloud product. User encrypts via managed KMS, packs via `--remote`, runtime fetches via serve endpoint.

## Phase 3: Hardpack Seam

1. Cloud API: tier-based routing in pack endpoint
2. EC2 Nitro Enclave fleet (from Hardpack Cloud Service PRD)
3. Attestation receipts in pack response
4. `clef cloud upgrade` command (tier change)

**Result:** Users on basic tier can upgrade to Hardpack with zero client-side changes.

# 12. Open Questions

1. **Pack bundle size limits.** The Hardpack PRD specifies 10 MB max. Should basic tier match this, or be more generous since there's no enclave memory constraint?

2. **Artifact retention.** How many previous artifact versions to keep in S3? Options: last N versions, time-based (30 days), or unlimited with lifecycle policy. Affects rollback capability.

3. **Multi-identity pack.** Should `clef pack --remote` accept multiple identities in one request, or require one request per identity? One-per-request is simpler and matches the Hardpack contract. Multiple-per-request reduces round trips but complicates error handling.

4. ~~**Serve caching.**~~ **Resolved.** The `@clef-sh/agent` runtime already implements in-memory caching with configurable TTL (default 300s) and background polling with content-hash short-circuit. In Lambda, the cache survives across warm starts (~5-15 min). Most requests are served from memory with zero S3/KMS calls. JIT mode (`cacheTtl=0`) is available for users who want per-request KMS authorization at the cost of ~50-100ms latency. See Section 4.2 "Serve Lambda" for the full caching model.

5. **Free trial.** Should `clef cloud init` offer a trial period (14 days, no credit card) to lower the conversion barrier? Adds complexity to the device flow (skip payment, add trial expiry) but could significantly improve conversion.

6. **Lambda provisioned concurrency.** For customers with strict latency SLAs, cold starts (~100-200ms) may be unacceptable. Should Cloud offer provisioned concurrency as a premium option? This is an infrastructure cost question — provisioned Lambdas cost ~$0.015/hr each. For MVP, on-demand is fine; the 5-minute cache TTL aligns with Lambda's warm retention window.
