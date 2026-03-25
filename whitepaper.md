# Clef: No Servers. No Tokens. No Vendor Custody.

**Git-native secrets management from development to production**

---

## Abstract

Every secrets manager requires a server, and every server requires custody. Clef eliminates both. Secrets are encrypted files in git, delivered to production by a lightweight agent. No central infrastructure. No vendor with access to your keys. The question shifts from "who holds the secret key?" to "who has IAM permission?" — a policy question, not a custody question.

This paper describes the architecture across four deployment contexts: local development, CI/CD, production workloads, and dynamic credential generation via customer-owned brokers.

---

## 1. The Problem

Secrets management has three costs that compound:

**Custody.** Every system that stores secrets creates a custodial relationship. A breach of that system exposes everything stored on it. Self-hosted or SaaS — the customer trusts the operator with their plaintext.

**Operations.** Vault requires an HA cluster, a storage backend, and unsealing on every restart. Infisical requires PostgreSQL, Redis, and an application server. This infrastructure must be monitored, patched, and scaled for what should be a primitive, not a project.

**Token bootstrapping.** A secrets manager requires an authentication token. That token is itself a secret. Tokens end up baked into container images, hardcoded in CI, or stored in yet another secrets manager. Each is a static credential with broad access.

Age-based encryption (Clef's quick-start path) addresses operations — no server — but not bootstrapping. An age key is still a static credential that something must hold. KMS envelope mode (Section 6) addresses all three: no server, no vendor custody, no static credential. The bootstrapping problem reduces to IAM policy.

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

**Namespace granularity matters.** The grain is one namespace per external dependency or credential source — `rds-primary`, `stripe-api`, `sendgrid`, `auth0` — not broad category buckets like `database` or `api-keys`. Fine-grained namespaces enable fine-grained access control: a service identity scoped to `["stripe-api"]` gets Stripe credentials and nothing else. A namespace with twenty unrelated secrets defeats this model because scoping becomes meaningless — any service identity that needs one secret in the namespace gets all twenty.

The namespace × environment cross-product forms the **matrix**. Each cell maps to an encrypted file (e.g., `stripe-api/production.enc.yaml`). The matrix is the single source of truth. Lint validates the matrix automatically — missing cells, key drift between environments, and unregistered recipients are all caught before they reach production.

```
                 development    staging    production
  rds-primary    [enc.yaml]    [enc.yaml]  [enc.yaml]
  stripe-api     [enc.yaml]    [enc.yaml]  [enc.yaml]
  sendgrid       [enc.yaml]    [enc.yaml]  [enc.yaml]
  auth0          [enc.yaml]    [enc.yaml]  [enc.yaml]
```

### 2.3 Git as Source of Truth

Clef treats the git repository as the authoritative store for secrets state. Git is not a database, and it carries limitations: repository size grows as encrypted files accumulate, branch-heavy workflows multiply encrypted file variants, and git hosting availability affects the automation of secret updates — though any clone of the repository can be used to update, pack, and deploy independently. Every developer's checkout is a full copy of the secrets state. The git host coordinates collaboration; it is not required for operations. Section 5.5 covers runtime resilience during outages.

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

There is no `clef rollback` command. A proprietary rollback mechanism would introduce a second source of truth where the repo says one thing and the rollback state says another. Git's history, branching, and revert semantics are more capable than any bespoke rollback API, and every developer already knows how to use them.

This is a cleaner rollback story than centralized vault architectures, where restoring a previous secret version requires calling a vendor API, hoping client-side caches pick up the change, and manually verifying that all consumers are serving the correct version. With Clef, the PR diff shows exactly what changed, the merge triggers redeployment, and the agent's revision tracking confirms convergence.

---

## 4. CI/CD: Pack and Distribute

### 4.1 CI Key Management

A CI pipeline that runs `clef pack` needs to decrypt SOPS files. Clef supports a maturity path from convenience to zero-custody:

| Tier            | Key Storage                | Authentication      | Static Credential? | Use Case                 |
| --------------- | -------------------------- | ------------------- | ------------------ | ------------------------ |
| **Quick-start** | Age key in CI secret store | CI secret injection | **Yes**            | Development, small teams |
| **KMS-native**  | No age key                 | IAM role (OIDC)     | **No**             | Production, CI pipelines |

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
6. Optionally signs the envelope with an Ed25519 or KMS ECDSA key

### 4.3 Artifact Signing

The `ciphertextHash` field detects accidental corruption, but it does not prove provenance. An attacker who can write to the artifact store (S3, GCS, or the VCS repository) can replace the artifact with one they encrypted themselves — the hash will be valid because it matches the new ciphertext.

Artifact signing closes this gap. `clef pack` supports two signing modes:

```bash
# Ed25519 — store the private key in CI secrets, deploy the public key to the agent
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-key "$CLEF_SIGNING_KEY"

# KMS ECDSA — use an asymmetric KMS key (ECC_NIST_P256)
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-kms-key arn:aws:kms:us-east-1:123456789012:key/abcd-1234
```

The signing process:

1. After encryption and metadata assembly (including `expiresAt` if set), the packer constructs a **canonical signing payload**: a deterministic, newline-separated string containing the domain prefix `clef-sig-v1`, all security-relevant fields (version, identity, environment, revision, packedAt, ciphertextHash, sorted keys, expiresAt, envelope fields), with missing optional fields represented as empty strings.
2. For Ed25519, the payload is signed directly. For KMS ECDSA, a SHA-256 digest of the payload is passed to `kms:Sign` with `ECDSA_SHA_256` and `MessageType: DIGEST`.
3. The base64-encoded signature and algorithm identifier (`"Ed25519"` or `"ECDSA_SHA256"`) are written to the artifact JSON.

The runtime verifies signatures before decryption:

- The **verify key** is injected via deployment configuration (`CLEF_AGENT_VERIFY_KEY`), never read from the artifact itself. An artifact that embeds its own public key proves nothing — an attacker signs with their key and includes it.
- The verification algorithm is derived from the public key's ASN.1 type, not from the artifact's `signatureAlgorithm` field. The artifact field is informational; the key type is authoritative. This prevents algorithm downgrade attacks.
- When a verify key is configured, unsigned artifacts are **hard-rejected** — the runtime throws, the cache is not updated, and a `signature_missing` telemetry event is emitted. Invalid signatures produce a `signature_invalid` event. There is no fallback to unsigned mode.
- When no verify key is configured, signing is not enforced. This preserves backward compatibility with pre-signing deployments.

**What signing protects against**: artifact store compromise (S3 bucket takeover, CDN poisoning) and transport-layer attacks (MITM replacing the artifact in transit). The trust boundary reduces from "anyone who can write to S3" to "the CI runner that holds the signing key."

**What signing does not protect against**: a compromised CI runner has the signing key and access to plaintext during pack — it can produce validly signed artifacts with arbitrary content. An insider with merge permissions can change the manifest to point to a different verify key. These are mitigated by CI runner isolation and CODEOWNERS, not by signing.

The signing key (Ed25519 private key or KMS key ARN) is a CI secret, not a versioned configuration. It does not appear in the manifest, the artifact JSON, or any CLI output. The KMS signing key is a different key from the envelope wrapping key: signing uses an asymmetric key (ECC_NIST_P256); envelope wrapping uses a symmetric key (SYMMETRIC_DEFAULT).

### 4.4 The Artifact Envelope

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
  "signature": "base64...",
  "signatureAlgorithm": "Ed25519",
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
- **`expiresAt`**: Optional expiry timestamp that the runtime enforces, enabling short-lived credential rotation. Covered by the signature when signing is enabled — an attacker cannot extend the TTL without invalidating the signature.
- **`revokedAt`**: When present, signals immediate revocation. The runtime wipes its cache and refuses to serve secrets.
- **`signature`**: Optional base64-encoded cryptographic signature over a canonical payload containing all security-relevant fields. Verified by the runtime before decryption when a verify key is configured (see Section 4.3).
- **`signatureAlgorithm`**: Informational — the runtime derives the actual verification algorithm from the public key type, not this field.
- **`envelope`**: Optional KMS wrapper enabling tokenless, keyless deployments (see Section 6).

The `ciphertext` field is always base64-encoded age-encrypted binary. Base64 is used because age's binary format cannot survive a JSON string round-trip intact — base64 provides a standard, language-agnostic encoding that any runtime can decode. When the `envelope` field is present, it contains the age private key wrapped by KMS. The runtime first unwraps the age key via `kms:Decrypt`, then base64-decodes and decrypts the ciphertext. Without the envelope, the runtime uses a locally-held age private key directly.

### 4.5 Service Identity Scoping

Service identities provide **cryptographic least privilege**. Each identity has:

- A list of namespace scopes (which secrets it can access)
- Per-environment cryptographic keys (age key pairs or KMS envelope configuration)
- Registration as a SOPS recipient on scoped files only (age mode) or no registration at all (KMS envelope mode)

An `api-gateway` identity scoped to `["api-keys", "database"]` cannot decrypt the `payments` namespace — the enforcement is cryptographic at the file level. But the configuration of that enforcement — who is a recipient on which files — is controlled by the manifest, which lives in git. This means git access control is the access control for secrets. That is both the simplicity and the caveat: one system instead of two, but that one system carries the risk profile of both.

**KMS envelope identities have zero access to git-stored secrets.** In KMS envelope mode, the service identity has no age key pair and is not registered as a SOPS recipient on any file. The `registerRecipients` step is skipped entirely for KMS-backed environments. This means a compromised workload with IAM `kms:Decrypt` permission on the envelope key can unwrap the packed artifact — recovering only the pre-scoped secrets for its identity and environment — but it has no cryptographic path to decrypt anything in git. The SOPS backend uses a different KMS key entirely, and the workload's IAM role should not have permission on it. This separation is the strongest isolation the architecture provides: the workload never touches the source-of-truth encrypted files, only the derivative artifact built specifically for it.

---

## 5. Production Workloads: The Runtime and Agent

### 5.1 The Runtime Library

The Clef runtime (`@clef-sh/runtime`) is a lightweight Node.js library designed for production deployment. It excludes heavy dependencies:

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
| Application code         | Yes (via agent API)   | No                    | No                              |

### 8.2 Threat Model Summary

| Attacker capability                   | What they can see                                                   | What they cannot do                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Read access to git repo               | Key names, encrypted values, recipient list, manifest structure     | Decrypt any secret value (requires age private key or KMS `Decrypt` permission)                                                                |
| Write access to git repo              | Everything above, plus can modify manifest                          | Decrypt existing secrets (can add rogue recipient, but PR review + `clef lint` detect this; see Section 8.7)                                   |
| Compromised CI runner                 | Plaintext of secrets within the service identity scope being packed | Access secrets outside that scope; persist access beyond the CI run (KMS mode)                                                                 |
| Compromised agent sidecar             | Plaintext of secrets in that service identity's current artifact    | Access other service identities' secrets; access historical or future artifact revisions (ephemeral keys)                                      |
| Artifact store write access           | Can replace artifacts in S3/GCS/VCS                                 | Produce a validly signed artifact without the signing key (when signing is enabled; see Section 4.3). Without signing, this is a viable attack |
| Artifact store read access            | Ciphertext and KMS-wrapped ephemeral key                            | Decrypt without `kms:Decrypt` permission on the specific KMS key                                                                               |
| KMS `Decrypt` permission on wrong key | Nothing useful                                                      | Decrypt artifacts wrapped with a different KMS key                                                                                             |

### 8.3 Access Control

In a traditional secrets manager, access control is a separate system: the vault server evaluates policies at request time. In Clef, access control is git. The manifest declares who can decrypt what, SOPS enforces it cryptographically, and git controls who can change the manifest. There is no separate policy server to configure, maintain, or secure — but there is also no separation between the system that holds secrets and the system that controls access to them.

The cryptographic mechanisms are:

- **Per-environment encryption**: Each environment can use a different backend (age, KMS) and different recipients. A developer with the `development` age key cannot decrypt `production`.
- **Per-service-identity scoping**: Service identities are registered as SOPS recipients only on the namespace files they need. The `api-gateway` identity cannot decrypt `payments` secrets because it is not a recipient on those files.
- **Per-artifact ephemeral keys** (KMS mode): Each packed artifact uses a unique ephemeral age key pair. Compromising one artifact's decrypted content reveals nothing about other artifacts.

The trust chain is: git write access → manifest control → recipient list → cryptographic enforcement. An attacker who can merge a change to `clef.yaml` can add themselves as a recipient. This is the same class of risk as an attacker who can modify Vault policies or Doppler project access — the difference is that in Clef, the access control configuration is version-controlled, reviewable in a PR diff, and auditable in git history. The residual risk is an insider with merge permissions who adds a rogue recipient in a PR alongside legitimate changes. `clef lint` detects unrecognized recipients, but the lint output must be reviewed — it does not block merges on its own without CI enforcement.

### 8.4 No Single Point of Failure

Unlike centralized vault architectures, there is no central server to attack, DDoS, or compromise. There is no shared database to breach. There is no root key or master secret that unlocks everything. The git repository is the source of truth, protected by existing git access controls.

The blast radius of a key compromise depends on the KMS key topology. The architecture supports two independent axes of key separation:

**SOPS backend keys** (source encryption): The manifest supports per-environment backend overrides. Each environment can use a different encryption backend and key — age for local development, a regional KMS key for staging, a separate KMS key for production. A compromised key exposes only the SOPS files encrypted with that key, not files in other environments.

**Service identity envelope keys** (artifact encryption): Each service identity declares its own KMS key per environment via `clef service create --kms-env`. The `api-gateway` production artifact can use a different KMS key than the `payments-svc` production artifact.

The full matrix is per-environment SOPS backend key multiplied by per-identity-per-environment envelope key. A concrete example:

- Dev SOPS files: age (local, no cloud dependency)
- Production SOPS files: KMS key A (us-east-1)
- `api-gateway` production envelope: KMS key B
- `payments-svc` production envelope: KMS key C

In this topology, a compromised `api-gateway` runtime has `kms:Decrypt` on key B. It can unwrap its own artifact — the secrets it already has via the agent. It cannot decrypt production SOPS files (key A), dev SOPS files (age, different key entirely), or the `payments-svc` artifact (key C). The blast radius is one service identity in one environment.

At the other end of the spectrum, a single KMS key for everything is operationally simpler — one key, one IAM policy — and is a reasonable starting point. The blast radius of that key's compromise is everything encrypted with it. Organizations should choose the topology that matches their threat model. The architecture supports the full range without code changes — it is a configuration decision in `clef.yaml` and `.sops.yaml`.

### 8.5 Defense in Depth

Multiple layers prevent secret exposure:

1. **Encryption at rest**: SOPS encrypts values in git.
2. **Encryption in transit**: Artifacts are age-encrypted; VCS APIs use HTTPS.
3. **Memory-only plaintext**: No plaintext files, no temp directories. Standard OS-level caveats apply: process environment variables (from `clef exec`) are visible in `/proc/<pid>/environ` on Linux to processes with appropriate permissions, and in-memory values are subject to OS swap unless the host is configured with encrypted swap or `mlock`. These are inherent limitations of any in-memory approach.
4. **Pre-commit scanning**: Pattern and entropy analysis catches accidental plaintext commits.
5. **Integrity verification**: SHA-256 hash in the artifact envelope detects tampering or corruption.
6. **Provenance signing**: Ed25519 or KMS ECDSA signatures prove the artifact was produced by the authorized CI pipeline, not injected by an attacker with artifact store write access (see Section 4.3). The signature covers all security-relevant fields including `expiresAt`, preventing TTL extension attacks.
7. **TTL and revocation**: Short-lived artifacts limit the window of exposure; revocation provides instant invalidation.
8. **Localhost binding**: Agent API never exposed to the network.
9. **Timing-safe auth**: Bearer token comparison resists timing attacks.
10. **Host header validation**: DNS rebinding protection on all server routes.

### 8.6 Audit Trail

In KMS envelope mode, the audit trail is comprehensive, distributed across infrastructure the customer already operates:

1. **KMS audit logs**: Every `kms:Decrypt` call is logged by the cloud provider's audit system (CloudTrail, Cloud Audit Logs, Azure Monitor) with the caller's identity, timestamp, and key identifier. Since each artifact has a unique ephemeral key, each decrypt event maps to a specific artifact revision. This answers: who exercised decryption capability, and when?
2. **VCS history**: Git log shows who changed which secrets (key names are visible in plaintext), when, and in which namespace/environment. The artifact's `revision` field ties runtime consumption back to a specific commit.
3. **CI pipeline logs**: Show who triggered `clef pack`, for which service identity and environment, and when, creating the link from source change to published artifact.
4. **Agent telemetry**: `artifact.refreshed` events with revision, key count, and KMS envelope usage log the consumption side. Delivered as OTLP log records to the customer's observability platform.

The chain from git commit to CI pack to KMS unwrap to agent refresh provides complete provenance from secret authorship to consumption, all in systems the customer already monitors.

**Per-key read granularity**: The agent does not log which individual keys the application reads from the `/v1/secrets/:key` endpoint. In envelope encryption, once the DEK is unwrapped, every key encrypted by that DEK should be assumed accessed since the entire plaintext is in memory. Logging individual key reads would imply false granularity. The correct audit boundary is the KMS decrypt call in the cloud provider's audit logs: it tells you who unwrapped the DEK, when, and for which artifact revision. That is the meaningful access event, and it lives in the customer's own infrastructure.

### 8.7 Repository Integrity and CI Hardening

Clef's architecture shifts trust from "a running secrets server" to "git + CI/CD." The git repository carries the combined risk profile of a secrets store and an access control system. Organizations should protect it accordingly.

**Git as the secrets perimeter.** With a centralized secrets manager, git is just code — an attacker with repo access gets source code but no secrets. With Clef, git contains encrypted secrets. The SOPS backend protects them cryptographically, but the manifest (`clef.yaml`) controls who can decrypt — it declares recipients. An attacker who can merge a change to `clef.yaml` can add their own age public key as a recipient, wait for a re-encryption, and then decrypt.

This is mitigated by process controls that Clef provides tooling for but does not enforce unilaterally:

- **Branch protection**: Require pull request reviews for all changes. No direct pushes to `main` or protected branches.
- **CODEOWNERS**: Assign security-sensitive files (`clef.yaml`, `.sops.yaml`, `*.enc.yaml`) to a security-owner group that must approve changes. This is the single most important control — it prevents rogue recipient additions from merging without security review.
- **`clef lint` as a required CI check**: Detects unrecognized recipients, scope mismatches, and unregistered keys. A rogue recipient addition surfaces as a lint error. But lint only blocks the merge if the organization configures it as a required status check — Clef cannot enforce this from inside the repository.
- **`clef scan` in CI**: Catches accidental plaintext commits in PRs before they reach the default branch.

**CI runners as pack-time operators.** The runner executing `clef pack` decrypts via the SOPS backend, sees plaintext, and re-encrypts into the envelope. This is the equivalent of the Vault admin role. Hardening recommendations:

- **Dedicated pack runner**: Do not pack on the same runner that executes arbitrary PR code. A `workflow_dispatch` or protected-branch-only job limits the attack surface to actors who can trigger production deployments.
- **SOPS backend KMS permissions scoped to the pack role only**: The IAM policy on the SOPS KMS key should grant `kms:Decrypt` only to the CI role, not to developer workstations, enforcing a boundary between who can read source secrets and who can write code.
- **Short-lived CI credentials**: Use OIDC federation (GitHub Actions `id-token: write` → `AssumeRoleWithWebIdentity`) so there are no long-lived secrets in CI. This eliminates the static credential from the CI trust boundary entirely.
- **Artifact signing**: When enabled (Section 4.3), the runtime hard-rejects unsigned or incorrectly signed artifacts. This prevents an attacker who compromises the artifact store from replacing artifacts — they would need both the signing key and artifact store write access.

**The honest assessment.** Git and CI/CD carry more load in this model than they do with a centralized secrets manager. The controls needed — branch protection, CODEOWNERS, required CI checks, scoped IAM — are things most teams should already have. The difference is that with Vault, sloppiness in these areas does not expose secrets. With Clef, it can — because the encrypted secrets and the access control manifest are both in the repo. The upside is that all of it is auditable in `git log`, reviewable in PRs, and enforceable with tools the team already uses. No second system to secure.

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

| Solution            | Who holds secrets?                  | Default blast radius                                                       | Granular scoping available?                       |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Vault (self-hosted) | Customer's Vault cluster            | All secrets in that cluster                                                | Yes, via policies and namespaces                  |
| Vault (HCP)         | HashiCorp                           | All secrets in that tenant                                                 | Yes, via policies                                 |
| Doppler             | Doppler                             | All secrets in that org                                                    | Yes, via projects and environments                |
| AWS Secrets Manager | AWS                                 | Per-account                                                                | Yes, via per-secret IAM policies                  |
| **Clef**            | **Customer's git + customer's KMS** | **Per-service, per-environment (with separate KMS keys; see Section 8.4)** | **Yes, git-controlled cryptographic enforcement** |

Most tools support granular access control when configured correctly. The difference is where the access control lives. Vault and Doppler evaluate policies on a central server — a separate system to configure and secure. Clef's access control is the git repository itself: the manifest declares recipients, SOPS enforces the cryptography, and git branch protection controls who can change the manifest. This is simpler (one system, not two) but it means the git repository carries the combined risk profile of a secrets store and an access control system. Organizations should protect it accordingly.

Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) deserve specific mention: for teams invested in a cloud provider's IAM, these services provide identity-based access control without a static bootstrap credential — a property they share with Clef's KMS mode. The architectural difference is that cloud secret managers store secrets on the provider's infrastructure while Clef stores encrypted secrets in git. Both are valid trust models; the choice depends on whether the team prioritizes managed convenience or git-native versioning and vendor independence.

### 9.3 Dynamic Credentials

| Solution                  | Credential generation               | Adoption cost                       | Blast radius of bug |
| ------------------------- | ----------------------------------- | ----------------------------------- | ------------------- |
| Vault secrets engines     | Vault-maintained plugins            | Operate Vault cluster               | All Vault users     |
| Infisical dynamic secrets | Infisical-maintained (enterprise)   | Operate Infisical server            | All Infisical users |
| **Clef**                  | **Broker SDK + registry templates** | **`clef install` + deploy handler** | **One customer**    |

### 9.4 Integration Breadth

| Solution            | Native integrations                                          | Consumer interface                    |
| ------------------- | ------------------------------------------------------------ | ------------------------------------- |
| Vault               | Hundreds of auth methods, secrets engines, community plugins | Client libraries, CLI, API            |
| Doppler             | Dozens of platform integrations (Vercel, Fly, Railway, etc.) | SDK, CLI, API                         |
| AWS Secrets Manager | Native to AWS services (Lambda, ECS, RDS)                    | AWS SDK                               |
| **Clef**            | **Broker SDK + community registry**                          | **Agent HTTP API (`127.0.0.1:7779`)** |

Vault and Doppler have broader out-of-the-box integration coverage. Clef's consumption interface is a single HTTP API on localhost — any language or framework that can make an HTTP GET can read secrets from the agent. This is simpler (one protocol, no SDK to install) but means every consumer needs HTTP client code rather than a native plugin. The broker registry narrows the gap on the credential generation side, but on the consumption side, the tradeoff is real: breadth of pre-built integrations vs. simplicity of a universal interface.

### 9.5 Security Posture

The architectural differences produce different security properties. Neither system is universally stronger — the tradeoffs depend on the threat model.

**Where Clef is stronger:**

- **No runtime secret server** to DDoS, exploit, or misconfigure. Eliminates an entire class of infrastructure vulnerabilities (unsealing, storage backend, auth backend, TLS termination, HA failover).
- **Cryptographic scoping enforced at pack time**, not by policy documents that can drift. A service identity physically cannot decrypt secrets outside its namespace scope — the ciphertext does not contain them.
- **KMS key isolation**: the SOPS backend key and the envelope key are independent. Compromising a workload's IAM role gives zero leverage against the git-stored secrets (see Section 4.5).
- **No token/lease management**: Vault requires token renewal, lease management, and graceful degradation when the vault is unreachable. Clef's artifacts are static files — no runtime auth handshake that can fail or be intercepted.

**Where Clef requires more care:**

- **Secret freshness**: Vault serves the latest value on every read. Clef serves whatever was in the artifact at pack time. If a secret is rotated at the source, the artifact must be re-packed and redeployed. Broker-backed dynamic credentials (Section 7) eliminate this gap for credential types that support short-lived generation.
- **Revocation latency**: Vault can invalidate a token immediately so the workload cannot fetch new secrets — but the workload still holds the secret value in memory, and rotating the credential at the source still requires the same steps regardless of the manager. Clef has `revokedAt` and TTL-based expiry, but the runtime must poll to notice. For static secrets (API keys, config values — most secrets), both systems require the same manual steps: rotate at source, update the store, wait for the workload to pick it up. Vault's edge is narrow and specific to its dynamic secret backends that can `REVOKE` server-side credentials they generated.
- **Operator trust during pack**: the person or CI runner executing `clef pack` has access to plaintext. In Vault, operators can configure policies without ever seeing secret values. However, the blast radius is scoped: `clef pack` only decrypts the SOPS files within the service identity's namespace scope.
- **Git and CI/CD carry more load**: the repository is simultaneously code, secrets, and access control. This is the core tradeoff — one system to secure, but it must be treated with the seriousness of all three (see Section 8.7).

### 9.6 When to Use What

Not every team needs zero-custody. Not every team has the cloud-native maturity for KMS envelope mode. Honest guidance:

**A small team on a PaaS with a handful of environment variables**: Doppler or the platform's native secrets. The overhead of git-native encryption, SOPS, and age keys may not be justified for five secrets. The hardening acheived by using separate KMS keys for VCS and CI may also be overkill for some.

**A team already using a cloud provider's IAM extensively**: Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) are serious alternatives. They offer native IAM integration, managed rotation for supported services, and zero infrastructure — similar properties to Clef's KMS mode. The tradeoff: secrets are not versioned in git (no PR review, no drift detection, no cross-environment comparison), and each secret is a separate managed resource. Clef is stronger when the team values git-native workflows, namespace-level organization, and cross-environment consistency checking. Cloud secret managers are stronger when the team wants managed rotation and minimal tooling.

**A team that needs dynamic credentials today with minimal engineering investment**: Vault. Its built-in secrets engines for databases, cloud IAM, and PKI are production-proven and require no custom code. Clef's broker SDK and registry reduce the implementation to a handler function for common patterns, but the ecosystem is young — Vault's integration breadth is larger by an order of magnitude.

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

The registry ships reference brokers for common patterns: AWS STS AssumeRole, RDS IAM tokens, OAuth client credentials (covers any OAuth2 SaaS API), and ephemeral SQL database users via Handlebars templates (one handler for Postgres, MySQL, MSSQL, Oracle). These are starting points that cover the common path — real-world deployments will accumulate error handling, retry logic, and edge cases beyond the reference handler. The SDK handles the envelope, caching, and lifecycle complexity; the handler is responsible only for the credential generation call. Community contributions follow the same pattern: fork the registry, add a directory with `broker.yaml` + `handler.ts` + `README.md`, pass the validation harness, open a PR.

The registry is browsable at `registry.clef.sh` with provider and tier filtering. `clef search` provides the same index from the terminal. The zero-custody property is preserved because the broker executes in the customer's environment — the registry distributes code, not a service.

### 10.3 Scaling Across Repositories

A single team managing one or two repositories has everything they need in the open-source CLI, agent, and `clef report`. An organization managing secrets across 50 or 200 repositories needs to answer questions like: which repos have secrets that haven't been rotated in 90 days? Which service identities are drifted? Which agents are serving expired artifacts?

The answer is the OTLP telemetry contract. Every Clef agent already emits the events listed in Section 10.1 to whatever OTLP-compatible backend the organization runs. `clef report` already publishes manifest structure, policy evaluation results, and matrix metadata as structured JSON. The cloud provider's audit logs already capture every KMS access event.

The scaling solution is not a new product — it is the aggregation and alerting capabilities the organization already has. The data sources are OTLP telemetry from agents, structured JSON from `clef report`, VCS history from git, CI pipeline logs, and KMS audit logs from the cloud provider. All are open, structured, and delivered via standard protocols. The tooling to aggregate them is the customer's choice.

---

## 11. Summary

Clef's architecture delivers five properties that no existing secrets manager provides simultaneously:

1. **Zero custody**: Clef never sees, stores, or processes customer secrets. The git repository and the customer's KMS are the only systems that hold cryptographic material. To be precise: in KMS mode, custody is delegated to the cloud provider's HSM-backed key service. The customer trusts AWS/GCP/Azure with key material inside the HSM. This is a reasonable trust model for organizations already running production workloads on those cloud providers, but it is a trust delegation, not an absence of trust.

2. **Zero additional infrastructure**: No servers to deploy, databases to maintain, or clusters to scale. Secrets live in git. Runtime delivery uses the customer's existing compute and storage. The operational work of provisioning KMS keys and IAM policies is real but falls within existing platform engineering, not a new category of infrastructure.

3. **Tokenless access** (KMS mode): No static credential exists in the CI or production pipeline. Authentication is IAM policy; key material never leaves the HSM.

4. **Artifact provenance**: Packed artifacts can be cryptographically signed (Ed25519 or KMS ECDSA) so the runtime verifies the artifact was produced by an authorized CI pipeline before decryption. This reduces the trust boundary from "anyone who can write to the artifact store" to "the CI runner that holds the signing key" — closing the gap between integrity verification (ciphertextHash, which proves the artifact was not corrupted) and provenance verification (signature, which proves the artifact was produced by a trusted source).

5. **Dynamic credentials without vendor lock-in**: The artifact envelope is an open contract. Customers implement credential generation in their own serverless functions, using their own IAM roles, against their own data sources. Clef provides the delivery and lifecycle machinery, not the credential logic.

The result is a secrets management system where the blast radius of a runtime compromise is bounded to one service identity in one environment (when separate KMS keys are used for SOPS and envelope encryption; see Section 8.4), where operational burden is limited to existing platform engineering, and where the vendor relationship is one of tooling, not custody.

The trade-off is that git and CI/CD carry more load than they do with a centralized secrets manager. The encrypted secrets, the access control manifest, and the signing pipeline all live within the team's existing version control and CI infrastructure. The controls required — branch protection, CODEOWNERS, required CI checks, scoped IAM — are well-understood practices, but they must be treated with the seriousness of a secrets perimeter, not just a code repository (see Section 8.7).

---

_Clef is open-source under the MIT license. Learn more at [clef.sh](https://clef.sh)._
