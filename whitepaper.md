# Clef: Zero-Custody, Zero-Ops Secrets Management

**From Local Development to Production Workloads — Without Servers, Tokens, or Operational Overhead**

---

## Abstract

The dominant architecture for secrets management is a central server that stores and serves secrets. This creates two unavoidable costs: someone must operate that server, and someone must trust it. Every secrets manager forces a choice between these custodial and operational burdens.

Clef eliminates the server entirely. Secrets are encrypted files in git, managed by a CLI, and delivered to production by a lightweight agent that requires no central infrastructure. In KMS envelope mode, no static credential exists anywhere in the pipeline. The architectural insight is that removing the server changes the trust model fundamentally: the question shifts from "who holds the secret key?" to "who has IAM permission?" This is a policy question, not a custody question.

This paper describes the architecture that makes this possible across four deployment contexts: local development, CI/CD pipelines, production workloads with static secrets, and dynamic credential access via customer-owned serverless functions.

---

## 1. The Problem with Secrets Management Today

### 1.1 The Custody Dilemma

Every secrets manager that stores ciphertext or plaintext on its own infrastructure creates a custodial relationship. The vendor becomes a single point of compromise: one breach exposes every customer's secrets simultaneously. Even self-hosted solutions like HashiCorp Vault concentrate risk. A compromised Vault cluster yields every secret it manages.

### 1.2 The Operational Tax

Self-hosted secrets management is operationally expensive. Vault requires a high-availability cluster, a durable storage backend (Consul, PostgreSQL, or cloud storage), an unsealing procedure for every restart, and ongoing maintenance. Newer alternatives like Infisical reduce complexity but still require PostgreSQL, Redis, and an application server. This infrastructure must be monitored, patched, scaled, and kept alive, all for what should be a foundational primitive, not a project.

### 1.3 The Token Bootstrapping Problem

Traditional secrets managers require an authentication token to retrieve secrets, but that token is itself a secret. This chicken-and-egg problem leads to tokens baked into container images, hardcoded in CI variables, or stored in yet another secrets manager. Each token is a static credential with broad access that, if leaked, grants an attacker the keys to the kingdom.

Age-based encryption offers a meaningful improvement over vault tokens: an age key in a developer's OS keychain is a different risk profile than a Vault token in a CI variable. For small teams with a small circle of trust, age keys are simple, portable, require no cloud infrastructure, and provide a manageable custody arrangement where the blast radius is bounded by the team itself. Clef fully supports this model and it is the fastest path to structured secrets management.

However, age keys are still static credentials. In CI, the age key must be stored somewhere. In production, something must hold it. The custody problem is reduced in scope but not eliminated. For organizations that need policy-based access control across CI, staging, and production, Section 6 describes how KMS envelope encryption replaces static credentials with IAM policy.

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

The namespace × environment cross-product forms the **matrix**. Each cell maps to an encrypted file (e.g., `stripe-api/production.enc.yaml`). The matrix is the single source of truth. If a cell is missing, lint catches it. If keys drift between environments, lint catches it. If a recipient is unregistered, lint catches it.

```
                 development    staging    production
  rds-primary    [enc.yaml]    [enc.yaml]  [enc.yaml]
  stripe-api     [enc.yaml]    [enc.yaml]  [enc.yaml]
  sendgrid       [enc.yaml]    [enc.yaml]  [enc.yaml]
  auth0          [enc.yaml]    [enc.yaml]  [enc.yaml]
```

### 2.3 Git as Source of Truth

Clef treats the git repository as the authoritative store for secrets state. This is a deliberate architectural choice, not a convenient default. Git is not a database, and it carries limitations: repository size grows as encrypted files accumulate, branch-heavy workflows multiply encrypted file variants, and git hosting availability becomes a dependency for secret updates (though not for secret delivery; see Section 5.5).

These trade-offs are acceptable because the alternative is worse. A dedicated secrets database introduces a second source of truth, requires its own backup and replication strategy, and creates the exact operational and custodial burdens Clef is designed to eliminate. Git is infrastructure every engineering team already operates, monitors, and protects. Building on it means Clef inherits existing access controls, audit logs, review workflows, and disaster recovery, rather than duplicating them.

### 2.4 Dependency Injection and Testing

All subprocess interactions (SOPS calls, git operations) are abstracted behind a `SubprocessRunner` interface. Production code uses the real implementation; tests inject mocks. This means the core library has zero side effects in test, with no real processes spawned and no filesystem mutations, while maintaining identical code paths.

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

The **KMS-native tier** is the path for organizations that need policy-based access control, auditability, and zero static credentials. SOPS files are encrypted directly with KMS (not age), and `clef pack` uses KMS envelope encryption for the output artifact. CI needs only IAM permissions. The KMS key never leaves the HSM. Access is controlled by IAM policy, which is auditable, revocable, scoped, and centrally managed.

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
  "ciphertext": "-----BEGIN AGE ENCRYPTED FILE-----\n...",
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

The `ciphertext` field and the `envelope` field are not independent modes but complementary layers. The `ciphertext` is always age-encrypted. When the `envelope` is present, it contains the age private key wrapped by KMS. The runtime first unwraps the age key via `kms:Decrypt`, then uses it to decrypt the ciphertext. Without the envelope, the runtime uses a locally-held age private key directly.

### 4.4 Service Identity Scoping

Service identities provide **cryptographic least privilege**. Each identity has:

- A list of namespace scopes (which secrets it can access)
- Per-environment cryptographic keys (age key pairs or KMS envelope configuration)
- Registration as a SOPS recipient on scoped files only

An `api-gateway` identity scoped to `["api-keys", "database"]` cannot decrypt the `payments` namespace. The cryptographic enforcement is at the file level, not an ACL that can be bypassed. A compromised service identity yields only the secrets that service was authorized to access.

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
│  Your app code   │◄────────►│  127.0.0.1:7779   │
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

### 5.5 Resilience During VCS Outages

The normal flow depends on git hosting for CI-triggered `clef pack` runs. If your git host is unavailable, two mechanisms ensure continuity:

**Runtime side**: The agent's disk cache (Section 5.4) continues serving the last successfully fetched artifact. Applications keep running with current secrets until the cache TTL expires. For most outages, this is sufficient since git hosting downtime is typically measured in minutes.

**Pack side**: Any machine with the repository checked out locally can run `clef pack` and push the artifact directly to the storage backend (S3, HTTP, etc.). The packed artifact is self-contained. It does not reference git at runtime and does not require the git host to be reachable. In KMS envelope mode, the only external dependency is the KMS API, which operates on a separate availability plane from your git host.

A git outage degrades the automation of secret updates, not the availability of secrets themselves.

---

## 6. Tokenless Secrets: KMS Envelope Encryption

### 6.1 The Token Bootstrapping Problem, Solved

As discussed in Section 1.3, age keys reduce the custody problem but don't eliminate it. **KMS envelope encryption breaks this cycle.** No static credential exists anywhere in the pipeline:

- CI authenticates via IAM role; KMS does the crypto server-side; key material never leaves the HSM.
- Runtime authenticates via IAM role; same.
- The KMS key cannot be exported.
- Access control is IAM policy: auditable, revocable, scoped, centrally managed.
- Every `clef pack` generates an ephemeral key pair. There is no long-lived secret to rotate or protect.

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

## 7. Dynamic Credentials via Customer Lambda

### 7.1 The Framework Approach

Vault and similar tools maintain hundreds of "secrets engine" integrations: database credential generators, cloud IAM token issuers, certificate authorities. Each integration is a maintenance burden and a potential attack surface. When an upstream API changes, every customer is affected simultaneously.

Clef takes a different approach: **Clef defines the contract; customers implement the logic.** The artifact envelope schema (`version`, `identity`, `environment`, `ciphertext`, `expiresAt`, `revokedAt`) is the interface. Any system that produces a valid envelope can serve as a credential source.

This means evaluating Clef against Vault's built-in database secrets engine is not an apples-to-apples comparison. Vault provides immediate, out-of-the-box credential generation. Clef requires the customer to write and maintain a Lambda function. The trade-off is ownership: Vault's engine is convenient until it breaks, at which point every Vault user is affected and the fix depends on HashiCorp's release cycle. A customer-owned broker breaks only for that customer and the fix is a code change they control.

To reduce this adoption friction, the **Clef Broker Registry** provides community-maintained templates for common patterns (RDS IAM, STS AssumeRole, OAuth token refresh) that scaffold into the customer's infrastructure via `clef install`. The templates are free and open because they grow the ecosystem. See Section 10 for the commercial extensions that build on this foundation.

### 7.2 The Customer-Owned Broker Pattern

A typical dynamic credential flow uses a customer-owned Lambda function (or equivalent serverless function):

```
                          Customer's AWS Account
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  EventBridge Timer (every 50 min)                            │
│       │                                                      │
│       ▼                                                      │
│  Lambda: credential-broker                                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Generate short-lived DB credentials                 │  │
│  │    (RDS IAM auth token, or STS AssumeRole,             │  │
│  │     or any custom credential source)                   │  │
│  │                                                        │  │
│  │ 2. Pack into Clef artifact envelope:                   │  │
│  │    { ciphertext: age_encrypt(credentials),             │  │
│  │      expiresAt: now + 60min,                           │  │
│  │      envelope: { wrappedKey: kms_wrap(ephemeral) } }   │  │
│  │                                                        │  │
│  │ 3. Write to S3 / commit to git / push to HTTP store    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Agent Sidecar (in ECS/EKS/Lambda)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Polls artifact source                                  │  │
│  │ Adaptive interval: 80% of expiresAt remaining          │  │
│  │ → Unwraps via KMS → decrypts → atomic cache swap       │  │
│  │ → Serves to app via localhost HTTP                     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 What Clef Provides vs. What the Customer Owns

**Clef provides:**

- The **artifact envelope specification**: A versioned, integrity-checked, expiry-aware JSON schema.
- The **agent**: A production-hardened sidecar that handles polling, KMS unwrap, age decryption, cache management, revocation detection, and adaptive refresh scheduling.
- The **Lambda extension**: Native AWS Lambda Extensions API integration for serverless workloads.
- **Reference implementations**: Documented examples for common patterns (RDS IAM, STS AssumeRole, OAuth token refresh, custom broker template).

**The customer owns:**

- The credential generation logic (their Lambda, their IAM roles, their database access).
- The storage location (their S3 bucket, their git repo, their HTTP endpoint).
- The refresh schedule (their EventBridge rule, their cron job).
- The KMS key (their key, their key policy, their rotation schedule).

### 7.4 Why This Matters

This inversion of responsibility has concrete implications:

1. **No vendor dependency for credential logic.** If Clef disappears tomorrow, the customer's Lambda still generates credentials. They just need a different delivery mechanism.
2. **No maintenance burden on Clef.** AWS SDK changes, database driver updates, and cloud API deprecations are the customer's concern for their own broker. Clef's contract (the envelope schema) is stable.
3. **Bounded blast radius.** A bug in a Vault database secrets engine affects every Vault user. A bug in a customer's broker affects only that customer.
4. **Full auditability.** The customer's Lambda execution logs, IAM CloudTrail events, and KMS usage logs provide a complete audit trail within their own AWS account.

### 7.5 The Agent in Lambda

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

The extension registers for `INVOKE` and `SHUTDOWN` events via the Lambda Extensions API. On each invocation, it checks whether the refresh TTL has elapsed; if so, it fetches and decrypts the latest artifact before the function handler reads secrets. On `SHUTDOWN`, it flushes telemetry and releases resources.

Lambda functions access secrets via a local HTTP call. No SDK, no environment variable parsing, no cold-start credential bootstrapping. The extension handles all of it.

### 7.6 Eliminating Static Secrets Entirely

Taken to its full extent, the dynamic credential pattern can eliminate static secrets from the entire system. Every secret becomes a short-lived credential generated on demand:

- **Database access**: Lambda generates RDS IAM auth tokens (15-minute TTL).
- **Cloud IAM**: Lambda calls STS AssumeRole, returns scoped temporary credentials.
- **Third-party services**: Lambda fetches short-lived tokens from OAuth flows or vendor APIs.
- **Service-to-service auth**: Lambda mints JWTs with short expiry.

Each Lambda produces a valid Clef envelope with a tight `expiresAt`. The agent polls adaptively at 80% of TTL. No secret lives longer than its TTL window. Git history becomes irrelevant because every historical credential has already expired at the target system by design.

**What this achieves**: Expired credentials are worthless ciphertext. Rotation is just the next Lambda invocation. The blast radius of any compromise is time-bounded to the TTL window. The full Clef delivery machinery (agent, adaptive polling, revocation, telemetry) operates without static key baggage.

**What's hard about it**: Not everything supports short-lived credentials. Some third-party SaaS APIs only issue static API keys. Operational complexity increases, since maintaining a fleet of Lambda functions with their own IAM roles, error handling, and monitoring is real engineering work. And cold-start latency can block applications if the agent's cache expires before a fresh credential arrives.

**The pragmatic conclusion**: The fully dynamic model is the correct architecture for high-security environments that can afford the engineering investment. For most organizations, the sweet spot is a hybrid approach: dynamic credentials for sensitive, high-rotation targets (database access, cloud IAM, payment processor tokens) and static encrypted secrets via `clef set` for the long tail of low-risk configuration that doesn't support short-lived credentials.

The architecture accommodates both through the same agent and the same envelope format. A single Clef agent can serve static secrets from a packed artifact alongside dynamic credentials from a Lambda endpoint. The consumption interface is identical. The investment in the agent, the envelope contract, and the adaptive polling machinery is amortized across every secret type.

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

### 8.3 Cryptographic Access Control

Access to secrets is enforced cryptographically, not by ACLs:

- **Per-environment encryption**: Each environment can use a different backend (age, KMS) and different recipients. A developer with the `development` age key cannot decrypt `production`.
- **Per-service-identity scoping**: Service identities are registered as SOPS recipients only on the namespace files they need. The `api-gateway` identity cannot decrypt `payments` secrets because it is not a recipient on those files.
- **Per-artifact ephemeral keys** (KMS mode): Each packed artifact uses a unique ephemeral age key pair. Compromising one artifact's decrypted content reveals nothing about other artifacts.

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

1. **KMS CloudTrail**: Every `kms:Decrypt` call is logged with the caller's IAM principal, timestamp, and key ARN. Since each artifact has a unique ephemeral key, each decrypt event maps to a specific artifact revision. This answers: who exercised decryption capability, and when?
2. **VCS history**: Git log shows who changed which secrets (key names are visible in plaintext), when, and in which namespace/environment. The artifact's `revision` field ties runtime consumption back to a specific commit.
3. **CI pipeline logs**: Show who triggered `clef pack`, for which service identity and environment, and when, creating the link from source change to published artifact.
4. **Agent telemetry**: `artifact.refreshed` events with revision, key count, and KMS envelope usage log the consumption side. Delivered as OTLP log records to the customer's observability platform.

The chain from git commit to CI pack to KMS unwrap to agent refresh provides complete provenance from secret authorship to consumption, all in systems the customer already monitors.

**Per-key read granularity**: The agent does not log which individual keys the application reads from the `/v1/secrets/:key` endpoint. This is intentional. In envelope encryption, once the DEK is unwrapped, every key encrypted by that DEK should be assumed accessed since the entire plaintext is in memory. Logging individual key reads would imply false granularity. The correct audit boundary is the `kms:Decrypt` call in CloudTrail: it tells you who unwrapped the DEK, when, and for which artifact revision. That is the meaningful access event, and it lives in the customer's own CloudTrail.

This is where Clef Pro adds value. The open-source audit trail is comprehensive but distributed; assembling the provenance chain across CloudTrail, git, CI, and telemetry requires manual correlation. Clef Pro ingests this metadata (never ciphertext or plaintext) and presents it as a single pane of glass: cross-repo visibility, policy evaluation over time, rotation compliance dashboards, and incident-ready audit reports.

### 8.7 Repository Integrity

Clef's security model assumes the git repository is the trusted source of truth. A threat that Clef does not cryptographically prevent is a **malicious manifest change**: an attacker with write access to the repo could modify `clef.yaml` to add a rogue recipient, granting themselves decryption access to scoped namespaces.

This is mitigated by process controls:

- **Branch protection**: Require pull request reviews for changes to `clef.yaml` and encrypted files.
- **CODEOWNERS**: Assign security-sensitive files (`clef.yaml`, `.sops.yaml`, `*.enc.yaml`) to a security team that must approve changes.
- **`clef lint` in CI**: Detects unexpected recipients, scope mismatches, and unregistered keys. A rogue recipient addition would surface as a lint warning.
- **`clef report` to Clef Pro**: The control plane can enforce recipient policies, alerting or blocking when a new recipient is added outside an approved set.

Repository write access is the trust boundary. But it is the same trust boundary that governs application code, infrastructure configuration, and CI pipeline definitions. Organizations that protect their `main` branch with reviews and approval gates extend the same protection to their secrets posture.

---

## 9. Comparison with Existing Solutions

### 9.1 Operational Burden

| Solution            | Infrastructure required                  | Operational model                  |
| ------------------- | ---------------------------------------- | ---------------------------------- |
| HashiCorp Vault     | HA cluster + storage backend + unsealing | Dedicated team                     |
| AWS Secrets Manager | None (managed)                           | Per-secret pricing                 |
| Infisical           | PostgreSQL + Redis + app server          | Medium ops                         |
| Doppler             | None (SaaS)                              | Vendor-managed                     |
| **Clef**            | **None (Clef-specific)**                 | **Zero additional infrastructure** |

A clarification on "zero ops": Clef requires no Clef-specific infrastructure because secrets live in git and runtime delivery uses the customer's existing compute and storage. However, the KMS-native path requires provisioning KMS keys, writing IAM policies, configuring CI roles, and managing artifact storage. These are real operational tasks, but they are tasks within the platform engineering the team already does. The claim is not that no work is required, but that no new category of infrastructure is introduced.

### 9.2 Custody Model

| Solution            | Who holds secrets?                  | Default blast radius             | Granular scoping available?         |
| ------------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| Vault (self-hosted) | Customer's Vault cluster            | All secrets in that cluster      | Yes, via policies and namespaces    |
| Vault (HCP)         | HashiCorp                           | All secrets in that tenant       | Yes, via policies                   |
| Doppler             | Doppler                             | All secrets in that org          | Yes, via projects and environments  |
| AWS Secrets Manager | AWS                                 | Per-account                      | Yes, via per-secret IAM policies    |
| **Clef**            | **Customer's git + customer's KMS** | **Per-service, per-environment** | **Yes, cryptographically enforced** |

A fair comparison: most tools support granular access control when configured correctly. The difference is enforcement mechanism. Vault, Doppler, and ASM enforce access via ACL policies evaluated by a central server; if the server is compromised or misconfigured, the policy is bypassed. Clef enforces access cryptographically: a service identity that is not a SOPS recipient on a file cannot decrypt it, regardless of any misconfiguration elsewhere in the system. The policy is the cryptography.

### 9.3 Dynamic Credentials

| Solution                  | Credential generation     | Maintenance burden            | Blast radius of bug |
| ------------------------- | ------------------------- | ----------------------------- | ------------------- |
| Vault secrets engines     | Vault-maintained plugins  | High (Vault team)             | All Vault users     |
| Infisical dynamic secrets | Infisical-maintained      | Medium                        | All Infisical users |
| **Clef**                  | **Customer-owned Lambda** | **Customer's responsibility** | **One customer**    |

---

## 10. Commercial Extensions

The open-source architecture described in this paper leaves two practical concerns unaddressed. Both become commercial products, and both preserve the zero-custody property.

### 10.1 The Broker Registry

Section 7 describes dynamic credentials as a framework where Clef defines the envelope contract and customers implement the credential logic. This is architecturally correct, but it is also engineering work. Building a Lambda that generates RDS IAM auth tokens, handles errors gracefully, and publishes a valid Clef envelope is not trivial. Doing it for STS, OAuth, database tokens, and every other credential source compounds the effort.

The **Clef Broker Registry** is an open, community-driven catalog of broker templates, similar to Homebrew formulas or Terraform modules:

```bash
clef install rds-iam-broker
# Pulls from registry, scaffolds Lambda + IAM role + EventBridge rule
```

Community and vendor-maintained templates for common patterns are published to the registry. `clef install` scaffolds the broker into the customer's own infrastructure: their Lambda, their IAM roles, their KMS keys. The zero-custody property is preserved because the broker executes in the customer's environment.

The brokers are free because they serve as the adoption mechanism. Every broker deployed is another repository flowing secrets through Clef, another team using the agent and envelope format. Charging for broker templates would shrink the ecosystem, which is counterproductive.

### 10.2 Clef Pro

A single team managing secrets across one or two repositories has everything they need in the open-source CLI and agent. An organization managing secrets across 50 or 200 repositories faces a different class of problem: visibility. Which repos have secrets that haven't been rotated in 90 days? Which service identities span which repos? Which environments are drifted? Which recipients are deprovisioned engineers?

The data to answer these questions exists in git history, SOPS metadata, CI logs, and agent telemetry. Assembling it manually across hundreds of repos is not practical.

**Clef Pro** is a zero-custody control plane that aggregates this metadata (never ciphertext, never plaintext, never key material) into a unified view: cross-repo matrix visibility, recipient management at org scale, policy enforcement and compliance evaluation, drift dashboards, rotation scheduling, and audit aggregation. The control plane receives only what `clef report` publishes: rotation timestamps, recipient fingerprints, policy evaluation results, and git event data. It operates on the same metadata boundary described in Section 8.1.

### 10.3 Architectural Consistency

The open-source ecosystem and the commercial control plane are consistent with the core thesis. The Broker Registry grows the ecosystem without taking custody: brokers run in the customer's account. Clef Pro monetizes visibility and governance without touching secrets: the control plane sees metadata, not ciphertext. The vendor relationship remains one of tooling, not custody.

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
