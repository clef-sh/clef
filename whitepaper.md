# Clef: Zero-Custody, Zero-Ops Secrets Management

**From Local Development to Production Workloads — Without Servers, Tokens, or Operational Overhead**

---

## Abstract

Modern applications depend on dozens of secrets — database credentials, API keys, encryption keys, service tokens — yet the tools designed to manage them impose significant operational burden. Teams must choose between hosted vaults that take custody of their most sensitive data, or self-hosted infrastructure that demands dedicated engineering effort to deploy, scale, and keep alive.

Clef takes a fundamentally different approach. Built on git-native encryption and serverless primitives, Clef delivers secrets management with **zero custody** (Clef never sees, stores, or processes customer secrets) and **zero ops** (no servers, databases, or infrastructure to maintain). This paper describes the architecture that makes this possible across four deployment contexts: local development, CI/CD pipelines, production workloads with static secrets, and dynamic credential access via customer-owned serverless functions.

---

## 1. The Problem with Secrets Management Today

### 1.1 The Custody Dilemma

Every secrets manager that stores ciphertext or plaintext on its own infrastructure creates a custodial relationship. The vendor becomes a single point of compromise — one breach exposes every customer's secrets simultaneously. Even self-hosted solutions like HashiCorp Vault concentrate risk: a compromised Vault cluster yields every secret it manages.

### 1.2 The Operational Tax

Self-hosted secrets management is operationally expensive. Vault requires a high-availability cluster, a durable storage backend (Consul, PostgreSQL, or cloud storage), an unsealing procedure for every restart, and ongoing maintenance. Newer alternatives like Infisical reduce complexity but still require PostgreSQL, Redis, and an application server. This infrastructure must be monitored, patched, scaled, and kept alive — all for what should be a foundational primitive, not a project.

### 1.3 The Token Bootstrapping Problem

Traditional secrets managers require an authentication token to retrieve secrets — but that token is itself a secret. This chicken-and-egg problem leads to tokens baked into container images, hardcoded in CI variables, or stored in yet another secrets manager. Each token is a static credential with broad access that, if leaked, grants an attacker the keys to the kingdom.

---

## 2. Clef's Architecture

Clef eliminates these problems by treating secrets as **encrypted files in git**, managed by a CLI that enforces structure, and consumed by a lightweight runtime that requires no central server.

### 2.1 The Foundation: SOPS + age Encryption

At its core, Clef is a structured layer on top of [Mozilla SOPS](https://github.com/getsops/sops) and [age encryption](https://age-encryption.org). SOPS encrypts individual values within YAML/JSON files while leaving keys in plaintext — enabling meaningful git diffs, code review of structural changes, and automated drift detection without decryption. Age provides modern, simple public-key encryption with no configuration files or key servers.

**The non-negotiable constraint**: decrypted values exist only in memory. The SOPS binary receives plaintext via stdin and emits ciphertext via stdout. No intermediate file is written. No temporary directory is used. Clef enforces this at the architecture level, not as a policy.

### 2.2 The Manifest and Matrix Model

Every Clef-managed repository contains a `clef.yaml` manifest that declares:

- **Namespaces**: Logical groupings of secrets (e.g., `database`, `api-keys`, `payments`)
- **Environments**: Deployment targets (e.g., `development`, `staging`, `production`)
- **Encryption backend**: age, AWS KMS, GCP KMS, or PGP — configured globally or per-environment
- **Schemas**: Optional type and pattern constraints per namespace
- **Service identities**: Per-service, per-environment cryptographic access scoping

The namespace x environment cross-product forms the **matrix** — each cell maps to an encrypted file (e.g., `database/production.enc.yaml`). The matrix is the single source of truth. If a cell is missing, lint catches it. If keys drift between environments, lint catches it. If a recipient is unregistered, lint catches it.

```
                 development    staging    production
  database       [enc.yaml]    [enc.yaml]  [enc.yaml]
  api-keys       [enc.yaml]    [enc.yaml]  [enc.yaml]
  payments       [enc.yaml]    [enc.yaml]  [enc.yaml]
```

### 2.3 Dependency Injection and Testing

All subprocess interactions (SOPS calls, git operations) are abstracted behind a `SubprocessRunner` interface. Production code uses the real implementation; tests inject mocks. This means the core library has zero side effects in test — no real processes spawned, no filesystem mutations — while maintaining identical code paths.

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

The `clef exec` command is the primary consumption mechanism during development. It decrypts the target namespace/environment, merges values into a child process's environment, and spawns the command. Secrets flow from the encrypted SOPS file through memory into the process environment — never touching disk as plaintext. The child process inherits the secrets as standard environment variables, requiring zero application code changes.

### 3.2 Git Integration

Clef installs git hooks that prevent common mistakes:

- **Pre-commit hook**: Validates that staged `.enc.yaml` files contain SOPS metadata (catches accidental commits of plaintext) and runs `clef scan` to detect leaked secrets in any staged file.
- **Merge driver**: When two branches modify the same encrypted file, Clef decrypts all three versions (base, ours, theirs), performs a key-level three-way merge, and re-encrypts the result. Conflicts are reported at the key level, not as unintelligible ciphertext diffs.
- **Secret scanning**: Pattern-based detection (AWS keys, API tokens, private key headers) plus Shannon entropy analysis flags high-entropy strings that look like credentials.

### 3.3 Drift Detection Without Decryption

Because SOPS stores key names in plaintext, Clef can detect **key-set drift** across environments — and even across repositories — without any decryption keys or the SOPS binary. The drift detector reads encrypted files as plain YAML, extracts top-level keys (excluding the `sops:` metadata block), and compares them. This means a CI job can validate cross-repo consistency with zero cryptographic access.

---

## 4. CI/CD: Pack and Distribute

### 4.1 CI Key Management

A CI pipeline that runs `clef pack` needs to decrypt SOPS files. How the decryption key is provided depends on the environment's security requirements:

| Tier            | Key Storage                                 | Authentication                              | Use Case                                      |
| --------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| **Quick-start** | Age key as CI secret (`CLEF_AGE_KEY`)       | CI platform's secret store                  | Development, staging, small teams             |
| **Production**  | Age key wrapped with KMS, committed to repo | IAM role with `kms:Decrypt`                 | Production CI, no external secrets            |
| **KMS-native**  | No age key — full KMS envelope mode         | IAM role with `kms:Encrypt` + `kms:Decrypt` | Highest security, per-artifact ephemeral keys |

The **production tier** is the recommended approach. The developer's age key is encrypted using a KMS key and stored in the repository (e.g., `.clef/ci-key.enc`). The CI runner's IAM role grants `kms:Decrypt` on that specific key. At pack time, CI unwraps the age key via KMS and uses it to decrypt SOPS files — no external secret manager in the critical path. The repository is fully self-contained.

The **KMS-native tier** goes further: SOPS files are encrypted directly with KMS (not age), and `clef pack` uses KMS envelope encryption for the output artifact. CI needs only `kms:Encrypt` and `kms:Decrypt` permissions — no age keys exist anywhere in the pipeline.

### 4.2 The Artifact Packing Pipeline

For production workloads, Clef introduces the concept of **packed artifacts** — self-contained JSON envelopes that bundle encrypted secrets for a specific service identity and environment.

```bash
clef pack api-gateway production --output ./artifact.json
# Upload to any HTTP-accessible store
aws s3 cp ./artifact.json s3://my-bucket/clef/api-gateway/production.age.json
```

The `clef pack` command:

1. Resolves the service identity's namespace scope from the manifest
2. Decrypts only the SOPS files within that scope
3. Merges values from all scoped namespaces into a single key-value map
4. Re-encrypts the merged plaintext using the service identity's age recipient key (or KMS envelope — see Section 6)
5. Writes a JSON envelope with integrity metadata

### 4.2 The Artifact Envelope

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

- **`ciphertextHash`**: SHA-256 of the ciphertext, verified by the runtime before decryption — detects tampering or corruption in transit
- **`keys`**: Plaintext list of available secret names (not values), enabling the runtime to report which secrets are available without decryption
- **`expiresAt`**: Optional expiry timestamp that the runtime enforces — enables short-lived credential rotation
- **`revokedAt`**: When present, signals immediate revocation — the runtime wipes its cache and refuses to serve secrets
- **`envelope`**: Optional KMS wrapper — enables tokenless, keyless deployments (see Section 6)

### 4.3 Service Identity Scoping

Service identities provide **cryptographic least privilege**. Each identity has:

- A list of namespace scopes (which secrets it can access)
- Per-environment cryptographic keys (age key pairs or KMS envelope configuration)
- Registration as a SOPS recipient on scoped files only

An `api-gateway` identity scoped to `["api-keys", "database"]` cannot decrypt the `payments` namespace — the cryptographic enforcement is at the file level, not an ACL that can be bypassed. This means a compromised service identity yields only the secrets that service was authorized to access.

---

## 5. Production Workloads: The Runtime and Agent

### 5.1 The Runtime Library

The Clef runtime (`@clef-sh/runtime`) is a lightweight Node.js library designed for production deployment. It intentionally excludes heavy dependencies:

- **No SOPS binary** — decryption uses the `age-encryption` npm package directly
- **No git dependency** — artifacts are fetched via VCS REST APIs or plain HTTP
- **No plaintext on disk** — decrypted values live in an in-memory cache with atomic swap semantics; an optional encrypted disk cache provides resilience during VCS outages
- **Single production dependency** — `age-encryption` (plus optional `@aws-sdk/client-kms` for envelope mode)

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

- **Localhost only** — binds exclusively to `127.0.0.1`, never `0.0.0.0`
- **Timing-safe auth** — Bearer token comparison via `crypto.timingSafeEqual()`
- **DNS rebinding protection** — Host header validation rejects non-localhost requests
- **No caching headers** — `Cache-Control: no-store` prevents intermediary plaintext caching

### 5.3 Adaptive Polling

The agent doesn't just poll on a fixed interval — it adapts based on the artifact's metadata:

| Condition                | Poll interval                                        |
| ------------------------ | ---------------------------------------------------- |
| Artifact has `expiresAt` | 80% of remaining TTL (ensures refresh before expiry) |
| Cache TTL configured     | TTL / 10                                             |
| Neither                  | 30 seconds                                           |
| Minimum floor            | 5 seconds                                            |

The poller implements content-hash short-circuiting: if the VCS blob SHA or HTTP ETag hasn't changed since the last fetch, the entire decrypt pipeline is skipped. This reduces CPU overhead to near-zero during steady state.

### 5.4 Resilient Caching

The cache system provides multiple layers of fault tolerance:

1. **In-memory cache** (primary): Atomic reference swap — one assignment replaces the entire snapshot. No locks, no intermediate states visible to readers.
2. **Disk cache** (fallback): When VCS API fetches fail (transient network issues, rate limits), the last successfully fetched artifact is loaded from disk. Atomic writes via temp-file-and-rename prevent partial reads.
3. **TTL enforcement**: Both caches respect a configurable TTL. Stale secrets are wiped, not served.
4. **Revocation**: If the artifact contains a `revokedAt` timestamp, both caches are immediately wiped and all subsequent reads return errors until a valid artifact is available.

---

## 6. Tokenless Secrets: KMS Envelope Encryption

### 6.1 The Token Bootstrapping Problem, Solved

Traditional secrets managers require a static token to authenticate. That token must be provisioned, rotated, and protected — it is itself a secret that needs managing. In cloud environments, this typically means storing the token in a cloud-specific secrets store (AWS Secrets Manager, GCP Secret Manager), which raises the question: why not just put all secrets there?

Clef's KMS envelope mode eliminates this entirely. The flow:

```
CI Pipeline (pack time)                    Production Runtime
┌────────────────────────┐                 ┌────────────────────────┐
│ 1. Decrypt SOPS files  │                 │ 1. Fetch artifact      │
│ 2. Generate ephemeral  │                 │    (VCS API / HTTP)    │
│    age key pair        │                 │                        │
│ 3. Encrypt merged      │                 │ 2. Extract wrapped     │
│    secrets with        │                 │    ephemeral key from  │
│    ephemeral public    │                 │    envelope            │
│    key                 │                 │                        │
│ 4. Wrap ephemeral      │                 │ 3. Unwrap via KMS      │
│    PRIVATE key with    │                 │    (kms:Decrypt)       │
│    KMS                 │                 │                        │
│ 5. Publish artifact    │                 │ 4. Decrypt secrets     │
│    with wrapped key    │                 │    with ephemeral      │
│    in envelope         │                 │    private key         │
└────────────────────────┘                 └────────────────────────┘
```

**What the runtime needs**: IAM permission to call `kms:Decrypt` on a specific KMS key. No token. No static credential. No secret to bootstrap.

**What this means**: An EC2 instance, ECS task, or Lambda function with the right IAM role can decrypt secrets without any provisioned credentials. The IAM role is the authentication. KMS is the key management. Clef is the envelope and delivery mechanism.

### 6.2 Ephemeral Key Rotation

Each `clef pack` invocation generates a fresh ephemeral age key pair. This means:

- No long-lived age private key exists in production
- Each artifact revision has a unique encryption key
- Compromising one artifact's key yields only that artifact's secrets, not historical or future versions
- Key rotation is automatic — every pack is a rotation

### 6.3 IAM as the Authentication Layer

In KMS envelope mode, the security model reduces to IAM permissions on a single KMS key:

1. **Who can call `kms:Decrypt`?** — CI pipelines (to unwrap the age key for packing) and production workloads (to unwrap the ephemeral key for consumption). These can be different KMS keys with different IAM policies for separation of duty.
2. **Who can call `kms:Encrypt`?** — CI pipelines that wrap the ephemeral key during `clef pack`. In KMS-native mode, also used for SOPS encryption.
3. **Who can read the artifact?** — Anyone with VCS API access or HTTP access to the storage location — but the artifact is useless without `kms:Decrypt` on the correct key.

Even if an attacker obtains the artifact (which contains only ciphertext and a KMS-wrapped key), they cannot decrypt it without the `kms:Decrypt` permission on the specific KMS key. The wrapped ephemeral key is useless without KMS.

---

## 7. Dynamic Credentials via Customer Lambda

### 7.1 The Framework Approach

Vault and similar tools maintain hundreds of "secrets engine" integrations — database credential generators, cloud IAM token issuers, certificate authorities. Each integration is a maintenance burden and a potential attack surface. When an upstream API changes, every customer is affected simultaneously.

Clef takes a fundamentally different approach: **Clef defines the contract; customers implement the logic.** The artifact envelope schema (`version`, `identity`, `environment`, `ciphertext`, `expiresAt`, `revokedAt`) is the interface. Any system that produces a valid envelope can serve as a credential source.

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

- The **artifact envelope specification** — a versioned, integrity-checked, expiry-aware JSON schema
- The **agent** — a production-hardened sidecar that handles polling, KMS unwrap, age decryption, cache management, revocation detection, and adaptive refresh scheduling
- The **Lambda extension** — native AWS Lambda Extensions API integration for serverless workloads
- **Reference implementations** — documented examples (not maintained packages) for common patterns:
  - Static passthrough (read from AWS Secrets Manager, pack with short TTL)
  - STS credential broker (call AssumeRole, pack temporary credentials)
  - Database token broker (generate RDS IAM auth token, pack with matching expiry)
  - Custom broker (template for any credential source)

**The customer owns:**

- The credential generation logic (their Lambda, their IAM roles, their database access)
- The storage location (their S3 bucket, their git repo, their HTTP endpoint)
- The refresh schedule (their EventBridge rule, their cron job)
- The KMS key (their key, their key policy, their rotation schedule)

### 7.4 Why This Matters

This inversion of responsibility has profound implications:

1. **No vendor dependency for credential logic** — if Clef disappears tomorrow, the customer's Lambda still generates credentials. They just need a different delivery mechanism.
2. **No maintenance burden on Clef** — AWS SDK changes, database driver updates, and cloud API deprecations are the customer's concern for their own broker. Clef's contract (the envelope schema) is stable.
3. **No blast radius from vendor bugs** — a bug in a Vault database secrets engine affects every Vault user. A bug in a customer's broker affects only that customer.
4. **Full auditability** — the customer's Lambda execution logs, IAM CloudTrail events, and KMS usage logs provide a complete audit trail within their own AWS account.

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

The extension registers for `INVOKE` and `SHUTDOWN` events via the Lambda Extensions API. On each invocation, it checks whether the refresh TTL has elapsed — if so, it fetches and decrypts the latest artifact before the function handler reads secrets. On `SHUTDOWN`, it flushes telemetry and releases resources.

This model means Lambda functions access secrets via a local HTTP call — no SDK, no environment variable parsing, no cold-start credential bootstrapping. The extension handles all of it.

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

### 8.2 Cryptographic Access Control

Access to secrets is enforced cryptographically, not by ACLs:

- **Per-environment encryption**: Each environment can use a different backend (age, KMS) and different recipients. A developer with the `development` age key cannot decrypt `production`.
- **Per-service-identity scoping**: Service identities are registered as SOPS recipients only on the namespace files they need. The `api-gateway` identity cannot decrypt `payments` secrets because it is not a recipient on those files.
- **Per-artifact ephemeral keys** (KMS mode): Each packed artifact uses a unique ephemeral age key pair. Compromising one artifact's decrypted content reveals nothing about other artifacts.

### 8.3 No Single Point of Failure

Unlike centralized vault architectures:

- There is no central server to attack, DDoS, or compromise
- There is no shared database to breach
- There is no root key or master secret that unlocks everything
- The git repository is the source of truth, protected by your existing git access controls
- KMS keys are per-service, per-environment — compromise of one key affects only that scope

### 8.4 Defense in Depth

Multiple layers prevent secret exposure:

1. **Encryption at rest**: SOPS encrypts values in git
2. **Encryption in transit**: Artifacts are age-encrypted; VCS APIs use HTTPS
3. **Memory-only plaintext**: No plaintext files, no temp directories, no swap-to-disk
4. **Pre-commit scanning**: Pattern + entropy analysis catches accidental plaintext commits
5. **Integrity verification**: SHA-256 hash in the artifact envelope detects tampering
6. **TTL + revocation**: Short-lived artifacts limit the window of exposure; revocation provides instant invalidation
7. **Localhost binding**: Agent API never exposed to the network
8. **Timing-safe auth**: Bearer token comparison resists timing attacks

---

## 9. Comparison with Existing Solutions

### 9.1 Operational Burden

| Solution            | Infrastructure required                  | Operational model  |
| ------------------- | ---------------------------------------- | ------------------ |
| HashiCorp Vault     | HA cluster + storage backend + unsealing | Dedicated team     |
| AWS Secrets Manager | None (managed)                           | Per-secret pricing |
| Infisical           | PostgreSQL + Redis + app server          | Medium ops         |
| Doppler             | None (SaaS)                              | Vendor-managed     |
| **Clef**            | **None**                                 | **Zero ops**       |

Clef requires no infrastructure because secrets live in git (infrastructure the team already manages) and runtime delivery uses the customer's existing compute (Lambda, ECS, Kubernetes) and storage (S3, git). There is nothing Clef-specific to deploy, patch, monitor, or scale.

### 9.2 Custody Model

| Solution            | Who holds secrets?                  | Blast radius                     |
| ------------------- | ----------------------------------- | -------------------------------- |
| Vault (self-hosted) | Customer's Vault cluster            | All secrets in that cluster      |
| Vault (HCP)         | HashiCorp                           | All secrets in that tenant       |
| Doppler             | Doppler                             | All secrets in that org          |
| AWS Secrets Manager | AWS                                 | Per-account                      |
| **Clef**            | **Customer's git + customer's KMS** | **Per-service, per-environment** |

### 9.3 Dynamic Credentials

| Solution                  | Credential generation     | Maintenance burden         | Blast radius of bug |
| ------------------------- | ------------------------- | -------------------------- | ------------------- |
| Vault secrets engines     | Vault-maintained plugins  | High (Vault team)          | All Vault users     |
| Infisical dynamic secrets | Infisical-maintained      | Medium                     | All Infisical users |
| **Clef**                  | **Customer-owned Lambda** | **None (customer's code)** | **One customer**    |

---

## 10. Deployment Patterns

### 10.1 Local Development

```
Developer Machine
├── clef.yaml (manifest)
├── .clef/config.yaml (local config, gitignored — points to keychain or key file)
├── database/
│   ├── development.enc.yaml  ← SOPS-encrypted
│   ├── staging.enc.yaml
│   └── production.enc.yaml

$ clef exec database/development -- npm start
# Secrets injected as env vars, process runs
```

**Requirements**: Clef CLI, age private key (stored in OS keychain or key file).
**Infrastructure**: None.

### 10.2 CI/CD Pipeline

```yaml
# GitHub Actions — production tier (KMS-wrapped age key in repo)
- name: Pack artifact
  run: clef pack api-gateway production -o artifact.json --ttl 3600
  # Age key is stored in the repo, encrypted with KMS.
  # CI runner's IAM role has kms:Decrypt — no GitHub secrets needed.

- name: Upload artifact
  run: aws s3 cp artifact.json s3://clef-artifacts/api-gateway/production.age.json
```

```yaml
# GitHub Actions — quick-start tier (age key as CI secret)
- name: Pack artifact
  run: clef pack api-gateway production -o artifact.json --ttl 3600
  env:
    CLEF_AGE_KEY: ${{ secrets.CLEF_AGE_KEY }}
```

**Requirements (production tier)**: Clef CLI, KMS-wrapped age key in repo, IAM role with `kms:Decrypt`.
**Requirements (quick-start)**: Clef CLI, age key as CI platform secret.
**Infrastructure**: None (runs in existing CI).

### 10.3 Container Sidecar

```yaml
# ECS task definition — KMS envelope mode (recommended)
# No age keys, no external secrets. IAM role is the authentication.
services:
  app:
    image: my-app:latest
    environment:
      CLEF_AGENT_URL: http://agent:7779
      CLEF_AGENT_TOKEN: ${CLEF_AGENT_TOKEN}

  agent:
    image: clef-agent:latest
    environment:
      CLEF_AGENT_SOURCE: https://s3.amazonaws.com/bucket/api-gw/production.age.json
      # KMS envelope: task IAM role has kms:Decrypt — no age key needed
```

```yaml
# docker-compose — age key mode (development / quick-start)
services:
  agent:
    image: clef-agent:latest
    environment:
      CLEF_AGENT_SOURCE: https://s3.amazonaws.com/bucket/api-gw/staging.age.json
      CLEF_AGENT_AGE_KEY: ${AGE_PRIVATE_KEY}
```

**Requirements (KMS envelope)**: Agent binary, artifact URL, IAM role with `kms:Decrypt`.
**Requirements (age key)**: Agent binary, artifact URL, age private key.
**Infrastructure**: None beyond the existing container orchestrator.

### 10.4 Lambda with Extension

```bash
# Deploy agent as Lambda layer
# Function code fetches from localhost:7779

CLEF_AGENT_SOURCE=https://s3.amazonaws.com/bucket/api-gw/production.age.json
# KMS envelope mode: no age key, just IAM role
```

**Requirements**: Agent extension layer, artifact URL, IAM role with `kms:Decrypt`.
**Infrastructure**: None.

---

## 11. Observability

The Clef agent emits structured telemetry as OTLP log records, delivered to any OTLP-compatible backend (Datadog, Grafana, New Relic, etc.):

| Event                | Severity | Fields                           |
| -------------------- | -------- | -------------------------------- |
| `agent.started`      | INFO     | version, agentId                 |
| `agent.stopped`      | INFO     | reason, uptimeSeconds            |
| `artifact.refreshed` | INFO     | revision, keyCount, kmsEnvelope  |
| `artifact.revoked`   | WARN     | revokedAt                        |
| `artifact.expired`   | WARN     | expiresAt                        |
| `fetch.failed`       | WARN     | error, diskCacheAvailable        |
| `cache.expired`      | ERROR    | cacheTtl, diskCachePurged        |
| `artifact.invalid`   | ERROR    | reason (integrity/decrypt/parse) |

Telemetry is fire-and-forget — it never blocks the critical path. Events are buffered in memory and flushed periodically (default: every 10 seconds or 50 events). A failed telemetry export does not affect secret delivery.

---

## 12. Summary

Clef's architecture delivers four properties that no existing secrets manager provides simultaneously:

1. **Zero custody**: Clef never sees, stores, or processes customer secrets. The git repository and the customer's KMS are the only systems that hold cryptographic material.

2. **Zero ops**: No servers to deploy, databases to maintain, or clusters to scale. Secrets live in git. Runtime delivery uses the customer's existing compute and storage.

3. **Pure tokenless access**: KMS envelope encryption eliminates the token bootstrapping problem across the entire pipeline — from CI (where the age key is KMS-wrapped in the repo) to production (where the agent unwraps via IAM). No static credentials to provision, rotate, or leak at any stage.

4. **Dynamic credentials without vendor lock-in**: The artifact envelope is an open contract. Customers implement credential generation in their own serverless functions, using their own IAM roles, against their own data sources. Clef provides the delivery and lifecycle machinery — not the credential logic.

The result is a secrets management system where the blast radius of any single compromise is bounded to one service identity in one environment, where operational burden is zero, and where the vendor relationship is one of tooling — not custody.

---

_Clef is open-source under the MIT license. Learn more at [clef.sh](https://clef.sh)._
