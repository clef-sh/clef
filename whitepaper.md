# Clef: No Servers. No Tokens. No Vendor Custody.

**Secrets management from local development to production — without central infrastructure**

---

## Abstract

The dominant architecture for secrets management is a central server that stores and serves secrets. This creates two unavoidable costs: someone must operate that server, and someone must trust it. Every secrets manager forces a choice between these custodial and operational burdens.

Clef eliminates the server entirely. Secrets are encrypted files in git, managed by a CLI, and delivered to production by a lightweight agent that requires no central infrastructure. In KMS envelope mode, no static credential exists anywhere in the pipeline. The architectural insight is that removing the server changes the trust model fundamentally: the question shifts from "who holds the secret key?" to "who has IAM permission?" This is a policy question, not a custody question.

This paper describes the architecture that makes this possible across four deployment contexts: local development, CI/CD pipelines, production workloads with static secrets, and dynamic credential access via customer-owned serverless functions.

---

## 1. The Problem with Secrets Management Today

### 1.1 The Custody Dilemma

Every secrets manager that stores ciphertext or plaintext on its own infrastructure creates a custodial relationship. A breach of that infrastructure exposes whatever data the customer has stored on it. Even self-hosted solutions concentrate risk: a compromised Vault cluster exposes every secret it manages.

### 1.2 The Operational Tax

Self-hosted secrets management is operationally expensive. Vault requires a high-availability cluster, a durable storage backend (Consul, PostgreSQL, or cloud storage), an unsealing procedure for every restart, and ongoing maintenance. Newer alternatives like Infisical reduce complexity but still require PostgreSQL, Redis, and an application server. This infrastructure must be monitored, patched, scaled, and kept alive, all for what should be a foundational primitive, not a project.

### 1.3 The Token Bootstrapping Problem

Traditional secrets managers require an authentication token to retrieve secrets, but that token is itself a secret. This chicken-and-egg problem leads to tokens baked into container images, hardcoded in CI variables, or stored in yet another secrets manager. Each token is a static credential with broad access that, if leaked, grants an attacker the keys to the kingdom.

Age-based encryption gives Clef feature parity with existing secrets managers on the bootstrapping problem. An age key is a static credential — in CI it must be stored in a CI secret, in production something must hold it. This is the same custodial model as a Doppler service token or an Infisical API key — a static credential that something must hold. Vault can avoid static credentials through its native IAM and OIDC auth methods, but that capability requires operating a Vault server. The tradeoff is the operational burden described in Section 1.2. Age keys are simpler (no server, no SDK, no renewal logic) but they are not architecturally different.

For local development, age keys are effective. The key lives in the developer's OS keychain, protected by device authentication, and never leaves the machine. For small teams with a small circle of trust, this is a manageable custody arrangement. Clef fully supports this model and it is the fastest path to structured secrets management.

Where Clef goes beyond the competition is the KMS envelope mode described in Section 6 — which eliminates static credentials entirely and replaces the bootstrapping problem with IAM policy.

---

## 2. Clef's Architecture

Clef treats secrets as **encrypted files in git**, managed by a CLI that enforces structure, and consumed by a lightweight runtime that requires no central server.

### 2.1 The Foundation: SOPS + age Encryption

At its core, Clef is a structured layer on top of [Mozilla SOPS](https://github.com/getsops/sops) and [age encryption](https://age-encryption.org). SOPS encrypts individual values within YAML/JSON files while leaving keys in plaintext, enabling meaningful git diffs, code review of structural changes, and automated drift detection without decryption. Age provides modern, simple public-key encryption with no configuration files or key servers.

**The non-negotiable constraint**: decrypted values exist only in memory. No intermediate file is written. No temporary directory is used. Clef enforces this at the architecture level, not as a policy. During encryption (`clef set`), plaintext is passed via stdin and ciphertext emitted via stdout. During decryption, the reverse applies. In both directions, the SOPS binary operates as a streaming transform with no disk-backed intermediary.

### 2.2 The Manifest and Matrix Model

Every Clef-managed repository contains a `clef.yaml` manifest that declares:

- **Namespaces**: Logical groupings of secrets, scoped to a single concern or external dependency
- **Environments**: Deployment targets (e.g., `development`, `staging`, `production`)
- **Encryption backend**: age, AWS KMS, GCP KMS, or PGP, configured globally or per-environment
- **Schemas**: Optional type and pattern constraints per namespace
- **Service identities**: Per-service, per-environment cryptographic access scoping

**Namespace granularity matters.** The intended grain is one namespace per external dependency or credential source — `rds-primary`, `stripe-api`, `sendgrid`, `auth0` — not broad category buckets like `database` or `api-keys`. This is a deliberate departure from the flat `.env` file mentality where all secrets live in one bag. Fine-grained namespaces enable fine-grained access control: a service identity scoped to `["stripe-api"]` gets Stripe credentials and nothing else. A namespace with twenty unrelated secrets defeats this model because scoping becomes meaningless — any service identity that needs one secret in the namespace gets all twenty.

The namespace × environment cross-product forms the **matrix**. Each cell maps to an encrypted file (e.g., `stripe-api/production.enc.yaml`). The matrix is the single source of truth. Lint validates the matrix automatically — missing cells, key drift between environments, and unregistered recipients are all caught before they reach production.

```
                 development    staging    production
  rds-primary    [enc.yaml]    [enc.yaml]  [enc.yaml]
  stripe-api     [enc.yaml]    [enc.yaml]  [enc.yaml]
  sendgrid       [enc.yaml]    [enc.yaml]  [enc.yaml]
  auth0          [enc.yaml]    [enc.yaml]  [enc.yaml]
```

### 2.3 Git as Source of Truth

Clef treats the git repository as the authoritative store for secrets state. This is deliberate. Git is not a database, and it carries limitations: repository size grows as encrypted files accumulate, branch-heavy workflows multiply encrypted file variants, and git hosting availability affects the automation of secret updates — though any clone of the repository can be used to update, pack, and deploy independently. Every developer's checkout is a full copy of the secrets state. The git host coordinates collaboration; it is not required for operations. Section 5.5 covers runtime resilience during outages.

These trade-offs are acceptable because the alternative is worse. A dedicated secrets database introduces a second source of truth: the code references secrets by name, the database holds the values, and the two must be kept in sync across every deployment. When secrets and code are versioned separately, drift between them — a key the code expects but the database doesn't have, a database entry nothing references — is a class of bug with no single place to diagnose. With git, the encrypted values and the code that uses them are versioned together. A single commit is the complete state. And because SOPS stores key names in plaintext, a static analysis pass can cross-reference code usage (`process.env.DB_URL`, `secrets.get("API_KEY")`) against the keys present in the encrypted files — no decryption required. This makes it possible to prove at lint time that every secret the code references exists in the matrix, and that every secret in the matrix is referenced by code. A separate secrets database cannot offer this without a live connection to the database at analysis time.

A separate database also requires its own backup and replication strategy and creates the operational and custodial burdens Clef is designed to eliminate. Git is infrastructure every engineering team already operates, monitors, and protects. Building on it means Clef inherits existing access controls, audit logs, review workflows, and disaster recovery, rather than duplicating them.

A git repository containing encrypted secrets is a higher-value target than a typical code repository. Even without decryption keys, read access reveals: namespace names (which expose the external dependencies your system uses), environment topology, service identity structure and scoping, recipient fingerprints (which can be correlated to individuals or roles), and the complete history of changes to all of the above. This is a reconnaissance map of your secrets infrastructure.

VCS providers were not designed with this level of criticality in mind. They are built to host code, not to serve as the access control layer for a secrets store. By using git for both, the repository inherits a combined risk profile: it is simultaneously a code repository, a secrets store, and an access control system. This is the core tradeoff of the architecture.

The argument for accepting this tradeoff is operational: properly securing one system is likely easier than properly securing two. A team that enforces branch protection, requires PR reviews, runs `clef lint` in CI, and restricts repository access has one set of controls to maintain. A team running Vault alongside git has two access control surfaces, two audit logs, two sets of credentials, and two systems that must stay in sync. The simpler system is easier to get right — but it must be treated with the seriousness of both.

For organizations where the reconnaissance risk of a repository breach is unacceptable, the repository should be private with access restricted to the team that manages secrets. This partially undermines the "secrets and code versioned together" benefit — a separate private secrets repository reintroduces coordination overhead between the code repo and the secrets repo. The tradeoff is real, and the right choice depends on the organization's threat model.

---

## 3. Local Development: Secrets as Code

### 3.1 Developer Workflow

A developer working with Clef-managed secrets uses the CLI directly:

```bash
# Initialize a new Clef project
clef init

# Set a secret
clef set database/development DB_URL "postgres://localhost:5432/myapp"

# Read a secret
clef get database/development DB_URL

# Inject secrets into a process
clef exec database/development -- node server.js

# Compare secrets across environments
clef compare database/development database/staging

# Lint for drift, missing keys, schema violations
clef lint
```

The `clef exec` command is the primary consumption mechanism during development. It decrypts the target namespace/environment, merges values into a child process's environment, and spawns the command. Secrets flow from the encrypted SOPS file through memory into the process environment, never touching disk as plaintext. The child process inherits the secrets as standard environment variables, requiring zero application code changes.

### 3.2 Git Integration

Clef installs git hooks that prevent common mistakes:

- **Pre-commit hook**: Validates that staged `.enc.yaml` files contain SOPS metadata (catches accidental commits of plaintext) and runs `clef scan` to detect leaked secrets in any staged file.
- **Merge driver**: When two branches modify the same encrypted file, Clef decrypts all three versions (base, ours, theirs), performs a key-level three-way merge, and re-encrypts the result. Conflicts are reported at the key level, not as unintelligible ciphertext diffs.
- **Secret scanning**: Pattern-based detection (AWS keys, API tokens, private key headers) plus Shannon entropy analysis flags high-entropy strings that look like credentials.

### 3.3 Drift Detection Without Decryption

Because SOPS stores key names in plaintext, Clef can detect **key-set drift** across environments, and even across repositories, without any decryption keys or the SOPS binary. The drift detector reads encrypted files as plain YAML, extracts top-level keys (excluding the `sops:` metadata block), and compares them. This means a CI job can validate cross-repo consistency with zero cryptographic access.

### 3.4 Versioning and Rollback

Git is the first-class versioning and rollback mechanism. Rolling back a secret change follows the same workflow as rolling back any code change:

```
git revert <commit> → PR → review → merge → CI packs and deploys
```

The entire secrets state is in the repository. There is no external database to reconcile with, no API to call, no cache to invalidate manually. CI picks up the reverted manifest and encrypted files, runs `clef pack`, and publishes a new artifact. The agent polls, detects the new revision, and swaps atomically.

The absence of a `clef rollback` command is a conscious design choice. Adding a proprietary rollback mechanism would introduce a second source of truth where the repo says one thing and the rollback state says another. Git's history, branching, and revert semantics are more capable than any bespoke rollback API, and every developer already knows how to use them.

This is a cleaner rollback story than centralized vault architectures, where restoring a previous secret version requires calling a vendor API, hoping client-side caches pick up the change, and manually verifying that all consumers are serving the correct version. With Clef, the PR diff shows exactly what changed, the merge triggers redeployment, and the agent's revision tracking confirms convergence.

---

## 4. CI/CD: Pack and Distribute

### 4.1 CI Key Management

A CI pipeline that runs `clef pack` needs to decrypt SOPS files. Clef supports a maturity path from convenience to zero-custody:

| Tier            | Key Storage                           | Authentication                              | Static Credential?                                                | Use Case                 |
| --------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | ------------------------ |
| **Quick-start** | Age key as CI secret (`CLEF_AGE_KEY`) | CI platform's secret store                  | **Yes** — the age key is a static credential stored externally    | Development, small teams |
| **KMS-native**  | No age key — full KMS envelope mode   | IAM role with `kms:Encrypt` + `kms:Decrypt` | **No** — IAM is the authentication, key material never leaves KMS | Production, CI pipelines |

The **quick-start tier** is a complete solution for small teams. Store an age key in GitHub Actions secrets and go. The age key is a static credential in an external store, which means CI depends on that store's security, but for teams with a small circle of trust, this is a manageable custody arrangement. No cloud infrastructure required, no KMS key to provision, no IAM policies to write. Many teams will run this way permanently and that's fine.

The **KMS-native tier** eliminates all static credentials from the CI pipeline. This requires three things to be true simultaneously:

1. **The SOPS backend is KMS.** The `.sops.yaml` creation rule points to a KMS key ARN (AWS, GCP, or Azure), not an age recipient. SOPS encrypts and decrypts `.enc.yaml` files by calling the cloud KMS API directly — no private key exists anywhere. This is configured at `clef init` time with `--backend awskms --kms-arn <arn>`.
2. **The service identity uses KMS envelope encryption.** The `clef.yaml` service identity has a `kms:` block (provider + keyId) instead of a `recipient:` age public key. `clef pack` generates an ephemeral age key pair per invocation, wraps the ephemeral private key with this KMS key, and discards both after packing.
3. **CI authenticates via IAM role.** GitHub Actions OIDC federation, GCP Workload Identity, or equivalent platform-native identity — not a stored access key or service account JSON.

When all three hold, no static credential exists anywhere in the pipeline. CI's IAM role calls `kms:Decrypt` on the SOPS key (the KMS key in `.sops.yaml`) to read the source encrypted files, and `kms:Encrypt` on the service identity's envelope key (the KMS key in `clef.yaml` under `service_identities[].environments[].kms.keyId`) to wrap the ephemeral key in the output artifact.

The SOPS key and envelope key can be the same KMS key (simpler — one key, one IAM policy) or different keys (separation of duty — a compromised runtime that can unwrap its own artifact cannot decrypt the source SOPS files, because it has `kms:Decrypt` on the envelope key but not on the SOPS key).

If any one of the three uses age instead of KMS, a static credential enters the pipeline at that point. The zero-credential claim applies only when all three are KMS-native. This is an honest boundary — mixing age and KMS is fully supported, and the security of each layer is independent.

### 4.2 The Artifact Packing Pipeline

For production workloads, Clef introduces **packed artifacts**: self-contained JSON envelopes that bundle encrypted secrets for a specific service identity and environment.

```bash
clef pack api-gateway production --output ./artifact.json
# Upload to any HTTP-accessible store
aws s3 cp ./artifact.json s3://my-bucket/clef/api-gateway/production.age.json
```

The `clef pack` command:

1. Resolves the service identity's namespace scope from the manifest
2. Decrypts only the SOPS files within that scope
3. Merges values from all scoped namespaces into a single key-value map
4. Re-encrypts the merged plaintext using the service identity's age recipient key (or KMS envelope; see Section 6)
5. Writes a JSON envelope with integrity metadata

### 4.3 The Artifact Envelope

The packed artifact is a structured JSON document:

```json
{
  "version": 1,
  "identity": "api-gateway",
  "environment": "production",
  "packedAt": "2026-03-22T10:00:00.000Z",
  "revision": "1711101600000-a1b2c3d4",
  "ciphertextHash": "sha256:...",
  "ciphertext": "YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgy...",
  "keys": ["DB_URL", "API_KEY", "STRIPE_SECRET"],
  "expiresAt": "2026-03-22T11:00:00.000Z",
  "envelope": {
    "provider": "aws",
    "keyId": "arn:aws:kms:us-east-1:...",
    "wrappedKey": "base64...",
    "algorithm": "SYMMETRIC_DEFAULT"
  }
}
```

Key design properties:

- **`ciphertextHash`**: SHA-256 of the ciphertext, verified by the runtime before decryption, detecting tampering or corruption in transit.
- **`keys`**: Plaintext list of available secret names (not values), enabling the runtime to report which secrets are available without decryption.
- **`expiresAt`**: Optional expiry timestamp that the runtime enforces, enabling short-lived credential rotation.
- **`revokedAt`**: When present, signals immediate revocation. The runtime wipes its cache and refuses to serve secrets.
- **`envelope`**: Optional KMS wrapper enabling tokenless, keyless deployments (see Section 6).

The `ciphertext` field is always base64-encoded age-encrypted binary. Base64 is used because age's binary format cannot survive a JSON string round-trip intact — base64 provides a standard, language-agnostic encoding that any runtime can decode. When the `envelope` field is present, it contains the age private key wrapped by KMS. The runtime first unwraps the age key via `kms:Decrypt`, then base64-decodes and decrypts the ciphertext. Without the envelope, the runtime uses a locally-held age private key directly.

### 4.4 Service Identity Scoping

Service identities provide **cryptographic least privilege**. Each identity has:

- A list of namespace scopes (which secrets it can access)
- Per-environment cryptographic keys (age key pairs or KMS envelope configuration)
- Registration as a SOPS recipient on scoped files only

An `api-gateway` identity scoped to `["api-keys", "database"]` cannot decrypt the `payments` namespace — the enforcement is cryptographic at the file level. But the configuration of that enforcement — who is a recipient on which files — is controlled by the manifest, which lives in git. This means git access control is the access control for secrets. That is both the simplicity and the caveat: one system instead of two, but that one system carries the risk profile of both.

---

## 5. Production Workloads: The Runtime and Agent

### 5.1 The Runtime Library

The Clef runtime (`@clef-sh/runtime`) is a lightweight Node.js library designed for production deployment. It intentionally excludes heavy dependencies:

- **No SOPS binary**: Decryption uses the `age-encryption` npm package directly.
- **No git dependency**: Artifacts are fetched via VCS REST APIs or plain HTTP.
- **No plaintext on disk**: Decrypted values live in an in-memory cache with atomic swap semantics; an optional encrypted disk cache provides resilience during VCS outages.
- **Single production dependency**: `age-encryption` (plus optional `@aws-sdk/client-kms` for envelope mode).

### 5.2 The Agent Sidecar

The Clef agent (`@clef-sh/agent`) wraps the runtime in an HTTP API designed for sidecar deployment:

```
Application Container          Agent Sidecar
┌──────────────────┐           ┌──────────────────┐
│                  │  HTTP     │  Express API     │
│  Your app code   │◄─────────►│  127.0.0.1:7779  │
│                  │  Bearer   │                  │
│  fetch secrets   │  token    │  ArtifactPoller  │
│  from localhost  │           │  SecretsCache    │
│                  │           │  DiskCache       │
└──────────────────┘           └──────────────────┘
                                      │
                                      │ HTTPS
                                      ▼
                               ┌───────────────────┐
                               │  VCS API / HTTP   │
                               │  (GitHub, GitLab, │
                               │   Bitbucket, S3)  │
                               └───────────────────┘
```

The agent exposes:

| Endpoint               | Auth   | Purpose                                            |
| ---------------------- | ------ | -------------------------------------------------- |
| `GET /v1/health`       | None   | Health check with revision and expiry status       |
| `GET /v1/ready`        | None   | Readiness probe (503 until first decrypt succeeds) |
| `GET /v1/secrets`      | Bearer | All secrets as key-value map                       |
| `GET /v1/secrets/:key` | Bearer | Single secret by key                               |
| `GET /v1/keys`         | Bearer | List available key names                           |

Security properties:

- **Localhost only**: Binds exclusively to `127.0.0.1`, never `0.0.0.0`.
- **Timing-safe auth**: Bearer token comparison via `crypto.timingSafeEqual()`.
- **DNS rebinding protection**: Host header validation rejects non-localhost requests.
- **No caching headers**: `Cache-Control: no-store` prevents intermediary plaintext caching.
- **Bearer token**: Defense-in-depth on localhost; randomly generated and shared between sidecar containers via the orchestrator's environment. This is itself a static credential, but its scope is bounded to the lifetime of the execution environment (the ECS task, Kubernetes pod, or Lambda invocation). It is not persisted or reused across deployments.

### 5.3 Adaptive Polling

The agent adapts its poll interval based on the artifact's metadata:

| Condition                | Poll interval                                        |
| ------------------------ | ---------------------------------------------------- |
| Artifact has `expiresAt` | 80% of remaining TTL (ensures refresh before expiry) |
| Cache TTL configured     | TTL / 10                                             |
| Neither                  | 30 seconds                                           |
| Minimum floor            | 5 seconds                                            |

The poller implements content-hash short-circuiting: if the VCS blob SHA or HTTP ETag hasn't changed since the last fetch, the entire decrypt pipeline is skipped. This reduces CPU overhead to near-zero during steady state.

### 5.4 Resilient Caching

The cache system provides multiple layers of fault tolerance:

1. **In-memory cache** (primary): Atomic reference swap replaces the entire snapshot in one assignment. No locks, no intermediate states visible to readers.
2. **Disk cache** (fallback): When VCS API fetches fail due to transient network issues or rate limits, the last successfully fetched artifact is loaded from disk. Atomic writes via temp-file-and-rename prevent partial reads.
3. **TTL enforcement**: Both caches respect a configurable TTL. Stale secrets are wiped, not served.
4. **Revocation**: If the artifact contains a `revokedAt` timestamp, both caches are immediately wiped and all subsequent reads return errors until a valid artifact is available.

### 5.5 Resilience During Outages

The agent supports two artifact source configurations with different resilience characteristics. Which one you use determines your failure modes.

**Hosted artifact (S3, HTTP) — the recommended production path.** The agent polls an artifact stored in S3, a CDN, or any HTTP endpoint. The git host is not in the runtime path at all. A git outage blocks new `clef pack` runs (CI cannot update the artifact) but running agents are unaffected — they continue polling the artifact store, which operates on a separate availability plane. For most organizations, this is the correct configuration for production workloads.

**VCS-direct polling.** The agent polls the VCS API (GitHub, GitLab, Bitbucket) for the artifact file directly from the repository. This is simpler to configure — no artifact store to provision — but it means the agent's availability depends on the VCS API. If the VCS is unreachable and the agent's cache TTL expires, the agent stops serving secrets (it wipes stale caches rather than serving potentially outdated values). Teams using VCS-direct polling should set conservative cache TTLs and understand that a prolonged VCS outage will eventually affect secret delivery.

In both configurations, the disk cache (Section 5.4) provides a buffer: the last successfully fetched artifact is persisted to disk and used as a fallback during transient source failures. This buys time — minutes to hours depending on TTL — but it is not a substitute for a highly available artifact source in production.

Regardless of polling source, any machine with a local clone of the repository can run `clef pack` and push a new artifact directly to the storage backend. The packed artifact is self-contained and does not reference git at runtime.

---

## 6. Tokenless Secrets: KMS Envelope Encryption

### 6.1 The Token Bootstrapping Problem, Solved

As discussed in Section 1.3, age keys reduce the custody problem but don't eliminate it. **KMS envelope encryption breaks this cycle** — when the full KMS-native stack is in place (Section 4.1: SOPS backend is KMS, service identity uses KMS envelope, CI authenticates via IAM role). Under those conditions, no static credential exists anywhere in the pipeline:

- CI calls `kms:Decrypt` on the SOPS key (the KMS key in `.sops.yaml`) to read encrypted files. No private key.
- `clef pack` calls `kms:Encrypt` on the service identity's envelope key to wrap the ephemeral private key. No static key stored.
- Runtime calls `kms:Decrypt` on the envelope key to unwrap the ephemeral private key. No static key deployed.
- All three authenticate via IAM role. Key material never leaves the HSM.
- Every `clef pack` generates a fresh ephemeral key pair. There is no long-lived secret to rotate or protect.

The flow:

```
CI Pipeline (pack time)                    Production Runtime
┌────────────────────────┐                 ┌────────────────────────┐
│ 1. Decrypt SOPS files  │                 │ 1. Fetch artifact      │
│    (via KMS backend)   │                 │    (VCS API / HTTP)    │
│ 2. Generate ephemeral  │                 │                        │
│    age key pair        │                 │ 2. Extract wrapped     │
│ 3. Encrypt merged      │                 │    ephemeral key from  │
│    secrets with        │                 │    envelope            │
│    ephemeral public    │                 │                        │
│    key                 │                 │ 3. Unwrap via KMS      │
│ 4. Wrap ephemeral      │                 │    (kms:Decrypt)       │
│    PRIVATE key with    │                 │                        │
│    KMS                 │                 │ 4. Decrypt secrets     │
│ 5. Publish artifact    │                 │    with ephemeral      │
│    with wrapped key    │                 │    private key         │
│    in envelope         │                 │                        │
└────────────────────────┘                 └────────────────────────┘
```

**What the runtime needs**: IAM permission to call `kms:Decrypt` on a specific KMS key. No token. No static credential. No secret to bootstrap.

**What this means**: An EC2 instance, ECS task, or Lambda function with the right IAM role can decrypt secrets without any provisioned credentials. The IAM role is the authentication. KMS is the key management. Clef is the envelope and delivery mechanism.

### 6.2 Ephemeral Key Rotation

Each `clef pack` invocation generates a fresh ephemeral age key pair. This means:

- No long-lived age private key exists in production.
- Each artifact revision has a unique encryption key.
- Compromising one artifact's key yields only that artifact's secrets, not historical or future versions.
- Key rotation is automatic: every pack is a rotation.

### 6.3 IAM as the Authentication Layer

In KMS envelope mode, the security model reduces to IAM permissions on a single KMS key:

1. **Who can call `kms:Decrypt`?** CI pipelines (to decrypt SOPS files via the KMS backend) and production workloads (to unwrap the ephemeral key for consumption). These can be different KMS keys with different IAM policies for separation of duty.
2. **Who can call `kms:Encrypt`?** CI pipelines that wrap the ephemeral key during `clef pack`. In KMS-native mode, also used for SOPS encryption.
3. **Who can read the artifact?** Anyone with VCS API access or HTTP access to the storage location. But the artifact is useless without `kms:Decrypt` on the correct key. The wrapped ephemeral key is inert without KMS.

---

## 7. Dynamic Credentials

### 7.1 The Contract

A broker is any HTTP endpoint that returns a valid Clef artifact envelope. The agent polls it. The agent does not know or care what generated the credential — it validates the envelope, decrypts, and serves. The envelope specification (`version`, `identity`, `environment`, `ciphertext`, `ciphertextHash`, `expiresAt`, `revokedAt`, optional KMS `envelope`) is the only interface between credential generation and credential consumption.

### 7.2 The Broker SDK

Building a conforming envelope from scratch requires age key generation, age encryption, KMS wrapping, SHA-256 hashing, and JSON construction. The `@clef-sh/broker` package handles all of it. A broker author implements one function:

```typescript
import type { BrokerHandler } from "@clef-sh/broker";
import { Signer } from "@aws-sdk/rds-signer";

export const handler: BrokerHandler = {
  create: async (config) => ({
    data: {
      DB_TOKEN: await new Signer({
        hostname: config.DB_ENDPOINT,
        port: Number(config.DB_PORT ?? "5432"),
        username: config.DB_USER,
      }).getAuthToken(),
    },
    ttl: 900,
  }),
};
```

The SDK's `createHandler()` wraps this into a stateful invoker with envelope construction, KMS wrapping, response caching (80% of TTL), and graceful shutdown with Tier 2 credential revocation:

```typescript
import { createHandler } from "@clef-sh/broker";
import { handler } from "./handler";

const broker = createHandler(handler);
export const lambdaHandler = () => broker.invoke();
process.on("SIGTERM", () => broker.shutdown());
```

This works in any JavaScript context — Lambda, Cloud Functions, Azure Functions, containers, plain Node processes. The SDK does not start an HTTP server; it returns a `{ statusCode, headers, body }` response that the caller adapts to their platform. A `serve()` convenience wrapper is provided for long-running processes that need an HTTP server.

### 7.3 Broker Tiers

Credential sources divide into three tiers based on lifecycle complexity:

| Tier  | Lifecycle                                                        | Broker implements                      | Examples                                                               |
| ----- | ---------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| **1** | Self-expiring — credentials expire naturally, no cleanup needed  | `create()`                             | STS AssumeRole, RDS IAM tokens, OAuth access tokens, GCP access tokens |
| **2** | Stateful — new credential replaces previous, old must be revoked | `create()` + `revoke()`                | SQL database users, MongoDB users, Redis ACL users                     |
| **3** | Complex — multi-step teardown or external coordination           | `create()` + `revoke()` + custom state | IAM users (detach policies, delete keys), LDAP, K8s RBAC               |

Tier 1 brokers are pure functions. Tier 2 brokers implement an additional `revoke(entityId, config)` method; the SDK calls it automatically before each rotation and on `shutdown()`. State tracking is in-memory — if the process dies ungracefully, the credential expires at its natural TTL.

### 7.4 The Broker Registry

The Clef Broker Registry is an open catalog of broker templates. `clef install` downloads a handler into the user's project:

```bash
$ clef install rds-iam
  Name:        rds-iam
  Provider:    aws
  Tier:        1 (self-expiring)
  Created:     brokers/rds-iam/broker.yaml, handler.ts, README.md
```

Official brokers cover the most common credential sources:

| Broker                     | Provider | Tier | Handler                                                                                                                                    |
| -------------------------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sts-assume-role`          | AWS      | 1    | 25 lines — calls `sts:AssumeRole`, returns access key + secret key + session token                                                         |
| `rds-iam`                  | AWS      | 1    | 15 lines — calls `rds-signer:GetAuthToken`, returns a 15-minute database token                                                             |
| `oauth-client-credentials` | Agnostic | 1    | 30 lines — POSTs to any OAuth2 token endpoint, returns `access_token`. One broker for Stripe, Twilio, Auth0, Salesforce, and hundreds more |
| `sql-database`             | Agnostic | 2    | 40 lines — executes Handlebars SQL templates (`CREATE ROLE`, `DROP ROLE`). One handler for Postgres, MySQL, MSSQL, Oracle                  |

The SQL database broker deserves specific mention. Instead of building per-database integrations, it accepts parameterized SQL statements:

```yaml
# broker.yaml — works for any SQL database
CREATE_STATEMENT: |
  CREATE ROLE "{{username}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{username}}";
REVOKE_STATEMENT: |
  DROP ROLE IF EXISTS "{{username}}";
```

The handler generates a random username and password, executes the template, and returns `DB_USER` + `DB_PASSWORD`. On the next rotation, it drops the previous user and creates a new one. Switching from Postgres to MySQL is a YAML change, not a code change.

Each broker is validated by a standard test harness (`validateBroker()`) that checks the `broker.yaml` schema, handler exports, and README structure. Community contributions follow the same validation — fork the registry, add a directory, pass the harness, open a PR.

### 7.5 Architecture

```
Agent (polls at 80% of TTL)          Broker (any HTTP endpoint)
┌──────────────────────┐              ┌──────────────────────┐
│                      │  GET         │  handler.create()    │
│  Polls broker URL    │─────────────►│  age-encrypt         │
│  Validates envelope  │              │  KMS-wrap            │
│  Unwraps via KMS     │◄─────────────│  Return envelope     │
│  Decrypts via age    │  200 (JSON)  │                      │
│  Serves to app       │              │  (SDK handles all    │
│  127.0.0.1:7779      │              │   except create())   │
└──────────────────────┘              └──────────────────────┘
```

The agent is unchanged from Section 5. It fetches a URL, receives a JSON envelope, and processes it identically to a static packed artifact. The broker is the only new component, and the customer owns it.

### 7.6 The Agent in Lambda

For serverless workloads, the Clef agent operates as a Lambda extension:

```
Lambda Execution Environment
┌──────────────────────────────────────────────────┐
│                                                  │
│  Lambda Extensions API (port 9001)               │
│       │                                          │
│       ▼                                          │
│  Clef Agent Extension                            │
│  ┌────────────────────────────────────────────┐  │
│  │ 1. Register for INVOKE + SHUTDOWN events   │  │
│  │ 2. Initial fetch + decrypt on cold start   │  │
│  │ 3. Start HTTP server on 127.0.0.1:7779     │  │
│  │ 4. On INVOKE: refresh if TTL expired       │  │
│  │ 5. On SHUTDOWN: flush telemetry, cleanup   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Function Handler                                │
│  ┌────────────────────────────────────────────┐  │
│  │ const secrets = await fetch(               │  │
│  │   "http://127.0.0.1:7779/v1/secrets",      │  │
│  │   { headers: { Authorization: "Bearer …" }}│  │
│  │ ).then(r => r.json());                     │  │
│  │                                            │  │
│  │ // Use secrets.DB_URL, secrets.API_KEY     │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
└──────────────────────────────────────────────────┘
```

The extension registers for `INVOKE` and `SHUTDOWN` events. On each invocation, it refreshes if the TTL has elapsed. Lambda functions access secrets via a local HTTP call — no SDK, no environment variable parsing, no cold-start credential bootstrapping.

### 7.7 The Static Root Credential Reality

Dynamic credentials do not eliminate static secrets. A broker that generates short-lived database tokens still needs a root credential — the database master password, the IAM principal that calls `rds-generate-db-auth-token`, the OAuth client secret. That root credential is static.

The value of the broker pattern is not that it eliminates static secrets — it **contains** them. The root credential lives in the broker's Clef namespace, encrypted at rest, delivered via KMS envelope + IAM. The broker reads it from the Clef agent at `127.0.0.1:7779`. The same protections that secure application secrets secure the broker's bootstrapping credentials.

```
Application                  Broker                       Static Credential
┌──────────────┐            ┌──────────────┐             ┌──────────────┐
│ Reads short- │            │ Reads root   │             │ Stored in    │
│ lived token  │◄── agent ──│ credential   │◄── agent ───│ Clef (KMS    │
│ from agent   │            │ from agent   │             │ envelope)    │
│              │            │              │             │              │
│ Token TTL:   │            │ Generates    │             │ Protected by │
│ 15 minutes   │            │ short-lived  │             │ IAM policy   │
│              │            │ token        │             │              │
└──────────────┘            └──────────────┘             └──────────────┘
```

The application never sees the root credential. If the broker's execution environment is compromised, the blast radius is one credential source for the duration of the compromise — not the entire secrets store.

### 7.8 What Dynamic Credentials Achieve

- **Time-bounded blast radius**: A leaked short-lived token expires in minutes. A leaked static credential is valid until someone rotates it.
- **Automatic rotation**: Rotation is the next broker invocation, not a manual procedure.
- **Reduced distribution surface**: The root credential exists in one place. Applications receive only ephemeral tokens.
- **Separation of exposure**: Root credentials are KMS-encrypted in git. Application-facing credentials are ephemeral. Compromising git history yields ciphertext (useless without KMS) and expired tokens (useless by design).

### 7.9 The Path Forward

Every dynamic credential system today requires a static bootstrapping credential because target platforms haven't universally adopted tokenless access. IAM auth for RDS exists, but most databases require a password. Workload identity federation exists on GCP, but most SaaS APIs issue static keys.

The envelope contract positions ahead of this curve:

1. **Platform-agnostic.** The envelope doesn't care if the credential was generated from a static root credential or from a tokenless IAM call.
2. **The agent doesn't care about the source.** It polls, validates, decrypts, serves.
3. **The migration path is a deletion.** When a platform adopts tokenless access, update the broker's `create()` function and delete the root credential from the Clef namespace. Nothing downstream changes.
4. **The hybrid model works indefinitely.** Static secrets via `clef pack` and dynamic credentials via brokers flow through the same agent and the same envelope format.

The worst case: the broker pattern continues with the static root credential. The best case: the root credential drops out and the broker simplifies to a thin IAM call — with zero changes to the consuming infrastructure.

---

## 8. Security Model

### 8.1 Zero Custody

Clef's architecture ensures that no Clef-operated system ever has access to customer secrets:

| Component                | Sees plaintext?       | Sees ciphertext?      | Has decryption keys?            |
| ------------------------ | --------------------- | --------------------- | ------------------------------- |
| Git repository           | No                    | Yes (encrypted files) | No (KMS-wrapped key in repo)    |
| CI pipeline              | Briefly (during pack) | Yes                   | Via KMS unwrap (no static keys) |
| Artifact store (S3/HTTP) | No                    | Yes (packed artifact) | No                              |
| Clef agent               | Briefly (in memory)   | Yes                   | Via KMS unwrap (no static keys) |
| Clef Pro control plane   | No                    | No                    | No                              |
| Application code         | Yes (via agent API)   | No                    | No                              |

The Clef Pro control plane (if used) operates on **metadata only**: rotation timestamps, recipient fingerprints, policy evaluation results, and git event data. It never receives ciphertext, plaintext, or decryption keys.

### 8.2 Threat Model Summary

| Attacker capability                   | What they can see                                                   | What they cannot do                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Read access to git repo               | Key names, encrypted values, recipient list, manifest structure     | Decrypt any secret value (requires age private key or KMS `Decrypt` permission)                              |
| Write access to git repo              | Everything above, plus can modify manifest                          | Decrypt existing secrets (can add rogue recipient, but PR review + `clef lint` detect this; see Section 8.6) |
| Compromised CI runner                 | Plaintext of secrets within the service identity scope being packed | Access secrets outside that scope; persist access beyond the CI run (KMS mode)                               |
| Compromised agent sidecar             | Plaintext of secrets in that service identity's current artifact    | Access other service identities' secrets; access historical or future artifact revisions (ephemeral keys)    |
| Artifact store read access            | Ciphertext and KMS-wrapped ephemeral key                            | Decrypt without `kms:Decrypt` permission on the specific KMS key                                             |
| KMS `Decrypt` permission on wrong key | Nothing useful                                                      | Decrypt artifacts wrapped with a different KMS key                                                           |

### 8.3 Access Control

In a traditional secrets manager, access control is a separate system: the vault server evaluates policies at request time. In Clef, access control is git. The manifest declares who can decrypt what, SOPS enforces it cryptographically, and git controls who can change the manifest. There is no separate policy server to configure, maintain, or secure — but there is also no separation between the system that holds secrets and the system that controls access to them.

The cryptographic mechanisms are:

- **Per-environment encryption**: Each environment can use a different backend (age, KMS) and different recipients. A developer with the `development` age key cannot decrypt `production`.
- **Per-service-identity scoping**: Service identities are registered as SOPS recipients only on the namespace files they need. The `api-gateway` identity cannot decrypt `payments` secrets because it is not a recipient on those files.
- **Per-artifact ephemeral keys** (KMS mode): Each packed artifact uses a unique ephemeral age key pair. Compromising one artifact's decrypted content reveals nothing about other artifacts.

The trust chain is: git write access → manifest control → recipient list → cryptographic enforcement. An attacker who can merge a change to `clef.yaml` can add themselves as a recipient. This is the same class of risk as an attacker who can modify Vault policies or Doppler project access — the difference is that in Clef, the access control configuration is version-controlled, reviewable in a PR diff, and auditable in git history. The residual risk is an insider with merge permissions who adds a rogue recipient in a PR alongside legitimate changes. `clef lint` detects unrecognized recipients, but the lint output must be reviewed — it does not block merges on its own without CI enforcement.

### 8.4 No Single Point of Failure

Unlike centralized vault architectures, there is no central server to attack, DDoS, or compromise. There is no shared database to breach. There is no root key or master secret that unlocks everything. The git repository is the source of truth, protected by existing git access controls. KMS keys are per-service, per-environment, so compromise of one key affects only that scope.

### 8.5 Defense in Depth

Multiple layers prevent secret exposure:

1. **Encryption at rest**: SOPS encrypts values in git.
2. **Encryption in transit**: Artifacts are age-encrypted; VCS APIs use HTTPS.
3. **Memory-only plaintext**: No plaintext files, no temp directories. Standard OS-level caveats apply: process environment variables (from `clef exec`) are visible in `/proc/<pid>/environ` on Linux to processes with appropriate permissions, and in-memory values are subject to OS swap unless the host is configured with encrypted swap or `mlock`. These are inherent limitations of any in-memory approach.
4. **Pre-commit scanning**: Pattern and entropy analysis catches accidental plaintext commits.
5. **Integrity verification**: SHA-256 hash in the artifact envelope detects tampering.
6. **TTL and revocation**: Short-lived artifacts limit the window of exposure; revocation provides instant invalidation.
7. **Localhost binding**: Agent API never exposed to the network.
8. **Timing-safe auth**: Bearer token comparison resists timing attacks.

### 8.6 Audit Trail

In KMS envelope mode, the audit trail is comprehensive, distributed across infrastructure the customer already operates:

1. **KMS audit logs**: Every `kms:Decrypt` call is logged by the cloud provider's audit system (CloudTrail, Cloud Audit Logs, Azure Monitor) with the caller's identity, timestamp, and key identifier. Since each artifact has a unique ephemeral key, each decrypt event maps to a specific artifact revision. This answers: who exercised decryption capability, and when?
2. **VCS history**: Git log shows who changed which secrets (key names are visible in plaintext), when, and in which namespace/environment. The artifact's `revision` field ties runtime consumption back to a specific commit.
3. **CI pipeline logs**: Show who triggered `clef pack`, for which service identity and environment, and when, creating the link from source change to published artifact.
4. **Agent telemetry**: `artifact.refreshed` events with revision, key count, and KMS envelope usage log the consumption side. Delivered as OTLP log records to the customer's observability platform.

The chain from git commit to CI pack to KMS unwrap to agent refresh provides complete provenance from secret authorship to consumption, all in systems the customer already monitors.

**Per-key read granularity**: The agent does not log which individual keys the application reads from the `/v1/secrets/:key` endpoint. This is intentional. In envelope encryption, once the DEK is unwrapped, every key encrypted by that DEK should be assumed accessed since the entire plaintext is in memory. Logging individual key reads would imply false granularity. The correct audit boundary is the KMS decrypt call in the cloud provider's audit logs: it tells you who unwrapped the DEK, when, and for which artifact revision. That is the meaningful access event, and it lives in the customer's own infrastructure.

### 8.7 Repository Integrity

Clef's security model assumes the git repository is the trusted source of truth. A threat that Clef does not cryptographically prevent is a **malicious manifest change**: an attacker with write access to the repo could modify `clef.yaml` to add a rogue recipient, granting themselves decryption access to scoped namespaces.

This is mitigated by process controls:

- **Branch protection**: Require pull request reviews for changes to `clef.yaml` and encrypted files.
- **CODEOWNERS**: Assign security-sensitive files (`clef.yaml`, `.sops.yaml`, `*.enc.yaml`) to a security team that must approve changes.
- **`clef lint` in CI**: Detects unexpected recipients, scope mismatches, and unregistered keys. A rogue recipient addition would surface as a lint warning.

Repository write access is the trust boundary. But it is the same trust boundary that governs application code, infrastructure configuration, and CI pipeline definitions. Organizations that protect their `main` branch with reviews and approval gates extend the same protection to their secrets posture.

---

## 9. Comparison with Existing Solutions

### 9.1 Operational Burden

| Solution            | Infrastructure required                  | Operational model                                           |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| HashiCorp Vault     | HA cluster + storage backend + unsealing | Dedicated team                                              |
| AWS Secrets Manager | None (managed)                           | Per-secret pricing                                          |
| Infisical           | PostgreSQL + Redis + app server          | Medium ops                                                  |
| Doppler             | None (SaaS)                              | Vendor-managed                                              |
| **Clef**            | **None (Clef-specific)**                 | **Git workflow + KMS/IAM provisioning (age mode: minimal)** |

A clarification on "zero ops": Clef requires no Clef-specific infrastructure because secrets live in git and runtime delivery uses the customer's existing compute and storage. However, the KMS-native path requires provisioning KMS keys, writing IAM policies, configuring CI roles, and managing artifact storage. These are real operational tasks, but they are tasks within the platform engineering the team already does. The claim is not that no work is required, but that no new category of infrastructure is introduced.

### 9.2 Custody Model

| Solution            | Who holds secrets?                  | Default blast radius             | Granular scoping available?                       |
| ------------------- | ----------------------------------- | -------------------------------- | ------------------------------------------------- |
| Vault (self-hosted) | Customer's Vault cluster            | All secrets in that cluster      | Yes, via policies and namespaces                  |
| Vault (HCP)         | HashiCorp                           | All secrets in that tenant       | Yes, via policies                                 |
| Doppler             | Doppler                             | All secrets in that org          | Yes, via projects and environments                |
| AWS Secrets Manager | AWS                                 | Per-account                      | Yes, via per-secret IAM policies                  |
| **Clef**            | **Customer's git + customer's KMS** | **Per-service, per-environment** | **Yes, git-controlled cryptographic enforcement** |

Most tools support granular access control when configured correctly. The difference is where the access control lives. Vault and Doppler evaluate policies on a central server — a separate system to configure and secure. Clef's access control is the git repository itself: the manifest declares recipients, SOPS enforces the cryptography, and git branch protection controls who can change the manifest. This is simpler (one system, not two) but it means the git repository carries the combined risk profile of a secrets store and an access control system. Organizations should protect it accordingly.

Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) deserve specific mention: for teams invested in a cloud provider's IAM, these services provide identity-based access control without a static bootstrap credential — a property they share with Clef's KMS mode. The architectural difference is that cloud secret managers store secrets on the provider's infrastructure while Clef stores encrypted secrets in git. Both are valid trust models; the choice depends on whether the team prioritizes managed convenience or git-native versioning and vendor independence.

### 9.3 Dynamic Credentials

| Solution                  | Credential generation               | Adoption cost                       | Blast radius of bug |
| ------------------------- | ----------------------------------- | ----------------------------------- | ------------------- |
| Vault secrets engines     | Vault-maintained plugins            | Operate Vault cluster               | All Vault users     |
| Infisical dynamic secrets | Infisical-maintained (enterprise)   | Operate Infisical server            | All Infisical users |
| **Clef**                  | **Broker SDK + registry templates** | **`clef install` + deploy handler** | **One customer**    |

### 9.4 When to Use What

Not every team needs zero-custody. Not every team has the cloud-native maturity for KMS envelope mode. Honest guidance:

**A small team on a PaaS with a handful of environment variables**: Doppler or the platform's native secrets. The overhead of git-native encryption, SOPS, and age keys is not justified for five env vars. Clef is designed for teams that have outgrown `.env` files, not teams that haven't needed to yet.

**A team already using a cloud provider's IAM extensively**: Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) are serious alternatives. They offer native IAM integration, managed rotation for supported services, and zero infrastructure — similar properties to Clef's KMS mode. The tradeoff: secrets are not versioned in git (no PR review, no drift detection, no cross-environment comparison), and each secret is a separate managed resource. Clef is stronger when the team values git-native workflows, namespace-level organization, and cross-environment consistency checking. Cloud secret managers are stronger when the team wants managed rotation and minimal tooling.

**A team that needs dynamic credentials today with minimal engineering investment**: Vault. Its built-in secrets engines for databases, cloud IAM, and PKI are production-proven and require no custom code. Clef's broker model requires building and maintaining the credential logic. The Clef Broker Registry aims to reduce this gap but is not yet a mature ecosystem.

**A team that wants secrets versioned alongside code, git-native review workflows, and no central server**: Clef. This is the use case the architecture is designed for.

---

## 10. Observability and Scaling

The architecture described in this paper leaves two practical concerns that grow with organizational scale: visibility across many repositories, and the engineering burden of building dynamic credential brokers. Both are addressed with open infrastructure.

### 10.1 Telemetry

Audit and observability are different concerns, handled by different infrastructure. Audit — who accessed what, when, and with what authorization — is the responsibility of the systems that perform the access: KMS audit logs for decryption events, VCS history for authorship, CI logs for packaging (Section 8.6). Clef does not duplicate this; the audit trail lives in infrastructure the organization already operates and monitors.

Observability — is the agent healthy, are credentials fresh, are any artifacts expired or revoked — is handled by OTLP (OpenTelemetry Protocol) telemetry emitted by the Clef agent to any compatible backend. No Clef-specific backend is required. Combined with `clef report` (which publishes manifest structure, policy evaluation, and matrix metadata as structured JSON), the full secrets posture is observable through the organization's existing tooling.

### 10.2 The Broker Registry

Section 7 describes the broker SDK and the three-tier handler model. The `@clef-sh/broker` package reduces broker implementation to a `create()` function, but the function must still be written. The **Clef Broker Registry** eliminates that step for common credential sources.

```bash
clef install rds-iam
# Downloads broker.yaml + handler.ts + README.md into brokers/rds-iam/
```

The registry ships official brokers for the highest-value patterns: AWS STS AssumeRole (25 lines), RDS IAM tokens (15 lines), OAuth client credentials (30 lines — covers any OAuth2 SaaS API), and ephemeral SQL database users via Handlebars templates (40 lines — one handler for Postgres, MySQL, MSSQL, Oracle). Community contributions follow the same pattern: fork the registry, add a directory with `broker.yaml` + `handler.ts` + `README.md`, pass the validation harness, open a PR.

The registry is browsable at `registry.clef.sh` with provider and tier filtering. `clef search` provides the same index from the terminal. The zero-custody property is preserved because the broker executes in the customer's environment — the registry distributes code, not a service.

### 10.3 Scaling Across Repositories

A single team managing one or two repositories has everything they need in the open-source CLI, agent, and `clef report`. An organization managing secrets across 50 or 200 repositories needs to answer questions like: which repos have secrets that haven't been rotated in 90 days? Which service identities are drifted? Which agents are serving expired artifacts?

The answer is the OTLP telemetry contract. Every Clef agent already emits the events listed in Section 10.1 to whatever OTLP-compatible backend the organization runs. `clef report` already publishes manifest structure, policy evaluation results, and matrix metadata as structured JSON. The cloud provider's audit logs already capture every KMS access event.

The scaling solution is not a new product — it is the aggregation and alerting capabilities the organization already has. The data sources are OTLP telemetry from agents, structured JSON from `clef report`, VCS history from git, CI pipeline logs, and KMS audit logs from the cloud provider. All are open, structured, and delivered via standard protocols. The tooling to aggregate them is the customer's choice.

---

## 11. Summary

Clef's architecture delivers four properties that no existing secrets manager provides simultaneously:

1. **Zero custody**: Clef never sees, stores, or processes customer secrets. The git repository and the customer's KMS are the only systems that hold cryptographic material. To be precise: in KMS mode, custody is delegated to the cloud provider's HSM-backed key service. The customer trusts AWS/GCP/Azure with key material inside the HSM. This is a reasonable trust model for organizations already running production workloads on those cloud providers, but it is a trust delegation, not an absence of trust.

2. **Zero additional infrastructure**: No servers to deploy, databases to maintain, or clusters to scale. Secrets live in git. Runtime delivery uses the customer's existing compute and storage. The operational work of provisioning KMS keys and IAM policies is real but falls within existing platform engineering, not a new category of infrastructure.

3. **Tokenless access** (KMS mode): No static credential exists in the CI or production pipeline. Authentication is IAM policy; key material never leaves the HSM.

4. **Dynamic credentials without vendor lock-in**: The artifact envelope is an open contract. Customers implement credential generation in their own serverless functions, using their own IAM roles, against their own data sources. Clef provides the delivery and lifecycle machinery, not the credential logic.

The result is a secrets management system where the blast radius of any single compromise is bounded to one service identity in one environment, where operational burden is limited to existing platform engineering, and where the vendor relationship is one of tooling, not custody.

---

_Clef is open-source under the MIT license. Learn more at [clef.sh](https://clef.sh)._
