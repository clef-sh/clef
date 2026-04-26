# Clef: No Servers. No Tokens. No Vendor Custody.

**Git-native secrets management from development to production**

---

## Abstract

A secrets server is unnecessary overhead. The secrets already live in git — encrypted, versioned, reviewed — and the compute that needs them already has an identity: an IAM role, a service account, an OIDC token. The missing piece is not a server. It is an architecture that connects those two facts without introducing a third system to trust.

Clef is that architecture. Secrets are SOPS-encrypted files in git. A lightweight agent delivers them to production as packed, signed artifacts. No central server. No vendor custody. In KMS mode, no static credential exists anywhere in the pipeline — authentication is an IAM policy, not a key you can leak.

The recommended production topology uses up to three separate KMS keys — one for source encryption (SOPS backend), one for artifact wrapping (envelope), and one for artifact signing (provenance) — plus a dedicated secrets repository, eliminating both static credentials and cross-environment blast radius. Everything else in this paper is a stepping stone toward that destination. Section 1.1 provides a quick decision guide for readers who want to know upfront whether Clef fits their situation.

---

## 1. The Problem

Secrets management has three costs that compound, and the third one is the root of the other two:

**Token bootstrapping.** A secrets manager requires an authentication token. That token is itself a secret. Without deliberate configuration, tokens end up baked into container images, hardcoded in CI, or stored in yet another secrets manager. Vault, cloud-native managers, and others have answers — Vault's auth methods (AppRole, Kubernetes auth, AWS IAM auth) and cloud secret managers' native IAM integration both reduce or eliminate static bootstrap credentials. The cost is configuration complexity: Vault auth methods require their own setup, lifecycle management, and operational surface; cloud-native managers solve it at the expense of vendor custody. The question is not whether a solution exists but what it costs to operate one.

**Custody.** Every system that stores secrets creates a custodial relationship. A breach of that system exposes everything stored on it. Self-hosted or SaaS — the customer trusts the operator with their plaintext. Custody is a direct consequence of bootstrapping: if something must hold a token to authenticate, that thing is now a custodian.

**Operations.** Vault requires an HA cluster, a storage backend, and unsealing on every restart. Infisical requires PostgreSQL, Redis, and an application server. This infrastructure must be monitored, patched, and scaled for what should be a primitive, not a project. Operational burden is a direct consequence of custody: the more systems that hold credentials, the more systems that must be kept running, secured, and audited.

Age-based encryption (Clef's quick-start path) addresses operations — no server — but not bootstrapping. An age key is still a static credential that something must hold. That static credential is the bootstrapping problem deferred, not solved. KMS envelope mode (Section 6) addresses all three: no server, no vendor custody, no static credential. The bootstrapping problem reduces to an IAM policy — the same IAM the team already manages for compute.

### 1.1 Is Clef Right for You?

Not every team needs what Clef provides. Honest guidance before investing in the rest of this paper:

**A small team on a PaaS with a handful of environment variables**: Doppler or the platform's native secrets. The overhead of git-native encryption, SOPS, and age key management may not be justified for five secrets.

**A team already using a cloud provider's IAM extensively**: Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) are serious alternatives. They offer native IAM integration, managed rotation for supported services, and zero infrastructure — similar properties to Clef's KMS mode. The key difference: secrets are not versioned in git. No PR review, no drift detection, no cross-environment comparison. Clef is stronger when the team values git-native workflows and cross-environment consistency. Cloud secret managers are stronger when the team wants managed rotation and minimal tooling.

**A team that needs dynamic credentials today with minimal engineering investment**: Vault. Its built-in secrets engines for databases, cloud IAM, and PKI are production-proven and require no custom code. Clef's dynamic credential architecture requires implementing a broker handler. Vault's integration breadth is larger by an order of magnitude.

**A team that already operates AWS Secrets Manager, AWS Parameter Store, GCP Secret Manager, Azure Key Vault, or another cloud secret store and wants git-native review and drift detection without replacing runtime consumption**: Clef's pack backends (Section 4.6) are the delivery seam. A backend plugin decrypts the matrix and writes to the existing store, so production continues to read from the system it already knows. Clef becomes the source-of-truth and delivery layer; the cloud store remains the consumer-facing surface. (Teams running HashiCorp Vault, Doppler, or Infisical face a different decision — those products position themselves as the source of truth, so a pack-to-X workflow is unusual and only makes sense for bootstrap or disaster-recovery seeding. See Section 4.6 for the framing.)

**A team that wants secrets versioned alongside code, git-native review workflows, and no central server**: Clef. This is the use case the architecture is designed for. Start with age keys and a single repository — it works in an afternoon. Graduate to KMS as IAM maturity allows.

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

### 3.5 Per-Key Rotation Policy

Rotation is a credential-security control: its purpose is to bound the blast radius of a leaked secret by limiting how long the leaked value is valid. The only thing that invalidates a leaked copy is changing the value at the source system. Re-encrypting the same value with a new recipient, or migrating to a different KMS backend, does nothing for that threat — the leaked value is still live.

Clef records rotation state **per key**, not per file. Each matrix cell has a `.clef-meta.yaml` sidecar (committed to git alongside the `.enc.yaml`) that carries one rotation record per key:

```yaml
# {namespace}/{environment}.clef-meta.yaml
version: 1
pending: []
rotations:
  - key: STRIPE_KEY
    last_rotated_at: "2026-03-15T09:11:02.000Z"
    rotated_by: "alice <alice@example.com>"
    rotation_count: 4
```

The record is written or bumped only when a plaintext value actually changes. `clef set ns/env KEY value` records a rotation; `clef delete` removes the record; `clef import` records only when the imported value differs from the existing one. Re-encryption operations — `clef rotate` (key-pair rotation), `clef recipients add`, `clef migrate-backend` — deliberately do not touch rotation records. They also bump `sops.lastmodified` on the encrypted file, which is surfaced in compliance output as a separate raw signal, but that signal is informational: it answers "when was the file last written?", not "when was the secret last rotated?"

`clef policy check` evaluates compliance **per key**. A key with no rotation record is treated as a violation — the policy can't claim a secret is compliant without a record of when its value last changed. `clef set` establishes the record honestly; there is no auto-backfill subcommand that would fabricate timestamps.

The two metadata files — the SOPS-encrypted cell and the plaintext `.clef-meta.yaml` — are always written atomically in the same transaction. Either both land in the commit or `TransactionManager` rolls back both via `git reset --hard`. Re-encryption operations write only the cell, leaving the rotation record intact. This is an explicit design choice: there is no sync logic between the two files because neither owner reads the other's data.

**What this does not protect against.** A user who bypasses Clef — running raw `sops edit` on a cell — changes the plaintext value without updating the rotation record. The next `clef policy check` will report the key as compliant based on a stale record. The mitigation is the same as with any manual-edit bypass: lint runs on CI, code review on the `.enc.yaml` commit, and treating the repository as an access-controlled surface (Section 2.3). Clef does not attempt cryptographic binding between rotation records and ciphertext because it would require decryption at policy-check time (defeating the keyless-compliance property) and leak equality of values across environments via matching hashes.

**Merge behavior.** When two branches rotate the same key or move the same key between `pending` and `rotations`, Clef provides a dedicated merge driver (`merge=clef-metadata` in `.gitattributes`, registered by `clef hooks install`) that auto-resolves without user intervention. The rule: for rotation records, the later `last_rotated_at` wins and `rotation_count` becomes `max + 1` to record the merge itself; for pending entries, a resolution on either side (the key moved to `rotations` on one branch) supersedes any lingering pending entry on the other. This is distinct from the SOPS merge driver for encrypted values, which cannot auto-resolve because ciphertext values are not ordered.

---

## 4. CI/CD: Pack and Distribute

The sections that follow reference cloud KMS operations by their IAM permission names. These are written in AWS notation (`kms:Decrypt`, etc.) but every major cloud provider has direct equivalents:

| Permission    | What it does                                                | Cloud-generic equivalent                                      |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `kms:Decrypt` | Decrypt data (or unwrap a wrapped key) using a KMS key      | GCP `cloudkms.cryptoKeys.decrypt`, Azure `keys/decrypt`       |
| `kms:Encrypt` | Encrypt data (or wrap a key) using a KMS key                | GCP `cloudkms.cryptoKeys.encrypt`, Azure `keys/encrypt`       |
| `kms:Sign`    | Produce a digital signature using an **asymmetric** KMS key | GCP `cloudkms.cryptoKeyVersions.useToSign`, Azure `keys/sign` |

Two categories of KMS key appear in the architecture:

| Key type       | Purpose in Clef                                                                                                          | Example algorithms                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **Symmetric**  | SOPS backend encryption; envelope wrapping of ephemeral DEKs                                                             | AES-256-GCM (AWS `SYMMETRIC_DEFAULT`) |
| **Asymmetric** | Artifact signing (provenance). The private half never leaves the HSM; the public half is exported for local verification | ECDSA P-256 (AWS `ECC_NIST_P256`)     |

These terms are used consistently throughout Sections 4–8. Where a section refers to "the SOPS key," "the envelope key," or "the signing key," it means a KMS key with the corresponding permission and type from the tables above.

### 4.1 CI Key Management

A CI pipeline that runs `clef pack` needs to decrypt SOPS files. Clef supports a maturity path from convenience to zero-custody:

| Tier             | SOPS backend | Service identity   | Static credential? | Production-ready? |
| ---------------- | ------------ | ------------------ | ------------------ | ----------------- |
| **Quick-start**  | age          | age                | **Yes**            | No                |
| **KMS standard** | KMS          | KMS (single key)   | **No**             | Yes               |
| **KMS hardened** | KMS          | KMS (separate key) | **No**             | **Recommended**   |

The quick-start tier is the fastest path to working secrets. The KMS hardened tier is the destination. Everything in between is a stepping stone — each layer removes one static credential from the system. The rest of this section describes what it takes to reach each tier.

The **quick-start tier** is the right starting point for most teams. `clef init` generates an age key, encrypts the matrix, and installs git hooks in one command. Teams already using vanilla SOPS with age keys can adopt Clef by adding a `clef.yaml` manifest — existing encrypted files, existing keys, and existing `.sops.yaml` recipients all continue to work without modification. No cloud infrastructure required, no KMS key to provision, no IAM policies to write.

The limitation is specifically at the production service identity boundary: a runtime that needs to decrypt its artifact must hold the age private key somewhere — an env var, a secrets manager entry, a file on disk. That stored key is a static credential, which is the problem the rest of the architecture is designed to eliminate. Age keys for local development, CI decryption with a stored key, and team member access are all reasonable uses of this tier. Age keys as production runtime credentials are where the tradeoff becomes significant.

The **KMS-native tier** eliminates all static credentials from the CI pipeline. This requires three things to be true simultaneously:

1. **The SOPS backend is KMS.** The `.sops.yaml` creation rule points to a KMS key ARN (AWS, GCP, or Azure), not an age recipient. SOPS encrypts and decrypts `.enc.yaml` files by calling the cloud KMS API directly — no private key exists anywhere. This is configured at `clef init` time with `--backend awskms --kms-arn <arn>`.
2. **The service identity uses KMS envelope encryption.** The `clef.yaml` service identity has a `kms:` block (provider + keyId) instead of a `recipient:` age public key. `clef pack` generates a random AES-256 data encryption key (DEK) per invocation, wraps the DEK with this KMS key via `kms:Encrypt`, and zeroes the plaintext DEK after packing.
3. **CI authenticates via IAM role.** GitHub Actions OIDC federation, GCP Workload Identity, or equivalent platform-native identity — not a stored access key or service account JSON.

When all three hold, no static credential exists anywhere in the pipeline. CI's IAM role calls `kms:Decrypt` on the SOPS key (the KMS key in `.sops.yaml`) to read the source encrypted files, and `kms:Encrypt` on the service identity's envelope key (the KMS key in `clef.yaml` under `service_identities[].environments[].kms.keyId`) to wrap the DEK in the output artifact.

The SOPS key and envelope key can be the same KMS key (simpler — one key, one IAM policy) or different keys (separation of duty — a compromised runtime that can unwrap its own artifact cannot decrypt the source SOPS files, because it has `kms:Decrypt` on the envelope key but not on the SOPS key).

If any one of the three uses age instead of KMS, a static credential enters the pipeline at that point. The zero-credential claim applies only when all three are KMS-native. This is an honest boundary — mixing age and KMS is fully supported, and the security of each layer is independent.

### 4.2 The Artifact Packing Pipeline

`clef pack` is a **decrypt-scope-emit** step: it resolves a service identity's namespace scope, decrypts only those SOPS files, merges the values, and hands them to a backend for delivery. The default backend produces a self-contained JSON envelope that Clef's runtime consumes. Other backends perform write-through delivery to external stores directly — see Section 4.6 for the full set of delivery modes.

```bash
# Default backend: emit a signed JSON envelope
clef pack api-gateway production --output ./artifact.json
aws s3 cp ./artifact.json s3://my-bucket/clef/api-gateway/production.json
```

The shared pack steps, regardless of backend:

1. Resolve the service identity's namespace scope from the manifest
2. Decrypt only the SOPS files within that scope
3. Merge values from all scoped namespaces into a single key-value map
4. Hand the decrypted map to the backend's `pack()` function

The default `json-envelope` backend then:

5. Encrypts the merged plaintext — AES-256-GCM with a random DEK for KMS envelope identities (the DEK is wrapped by the service identity's KMS key), or age encryption for age-only identities
6. Writes a JSON envelope with integrity metadata
7. Optionally signs the envelope with an Ed25519 or KMS ECDSA key

Other backends replace steps 5–7 with whatever the target system needs — for example, the AWS Secrets Manager backend calls `PutSecretValue` with a JSON-bundled value, and the AWS Parameter Store backend calls `PutParameter` once per key. The decrypt-scope-merge preamble is shared; emission is pluggable.

### 4.3 Artifact Signing

The `ciphertextHash` field detects accidental corruption, but it does not prove provenance. An attacker who can write to the artifact store (S3, GCS, or the VCS repository) can replace the artifact with one they encrypted themselves — the hash will be valid because it matches the new ciphertext.

Artifact signing closes this gap. Both signing modes produce the same artifact format and the same verification behavior on the runtime side — they differ in how the signature is produced at pack time and how the signing credential is managed.

#### Signing Payload (shared)

Regardless of mode, the packer constructs a **canonical signing payload** after encryption and metadata assembly: a deterministic, newline-separated string containing the domain prefix `clef-sig-v2`, all security-relevant fields (version, identity, environment, revision, packedAt, ciphertextHash, sorted keys, expiresAt, envelope fields), with missing optional fields represented as empty strings. The base64-encoded signature and an algorithm identifier (`"Ed25519"` or `"ECDSA_SHA256"`) are written to the artifact JSON.

#### Ed25519 Signing

Ed25519 is the self-contained option — no cloud infrastructure required. You generate a key pair, store the private key as a CI secret, and deploy the public key to the agent.

```bash
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-key "$CLEF_SIGNING_KEY"
```

The payload is signed directly with the Ed25519 private key. The private key is a CI secret (e.g. a GitHub Actions encrypted secret or equivalent). Leaking this key allows an attacker to produce validly signed artifacts. Rotating it requires generating a new key pair and redeploying the public key to all agents.

#### KMS ECDSA Signing

KMS ECDSA eliminates the CI secret entirely. Instead of holding a private key, the CI runner's IAM role is granted `kms:Sign` permission on an asymmetric KMS key. The private key never leaves the HSM.

```bash
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-kms-key arn:aws:kms:us-east-1:123456789012:key/abcd-1234
```

A SHA-256 digest of the canonical payload is passed to `kms:Sign` with `ECDSA_SHA_256` and `MessageType: DIGEST`. There is no private key to leak — the risk surface is an IAM misconfiguration granting `kms:Sign` to an unauthorized principal, which is auditable via CloudTrail (or equivalent).

The signing key is a **third KMS key**, distinct from both the SOPS backend key (symmetric, used for source file encryption) and the envelope wrapping key (symmetric, used to wrap the DEK). The signing key is asymmetric and only the `kms:Sign` permission is needed — never `kms:Encrypt` or `kms:Decrypt`.

#### Verification (shared)

Both modes produce an artifact that the runtime verifies identically. The runtime never calls KMS for verification — it uses a locally-held public key.

The **verify key** is configured via `CLEF_AGENT_VERIFY_KEY` as a base64-encoded DER SPKI public key. For Ed25519, this is the public half of the generated key pair. For KMS ECDSA, it is the public key **exported from the asymmetric KMS key** and deployed as configuration. In both cases:

- The verify key is injected via deployment configuration, never read from the artifact itself. An artifact that embeds its own public key proves nothing — an attacker signs with their key and includes it.
- The verification algorithm is derived from the public key's ASN.1 type, not from the artifact's `signatureAlgorithm` field. The artifact field is informational; the key type is authoritative. This prevents algorithm downgrade attacks.
- When a verify key is configured, unsigned artifacts are **hard-rejected** — the runtime throws, the cache is not updated, and a `signature_missing` telemetry event is emitted. Invalid signatures produce a `signature_invalid` event. There is no fallback to unsigned mode.
- When no verify key is configured, signing is not enforced. This preserves backward compatibility with pre-signing deployments.

#### Threat Scope

**What signing protects against**: artifact store compromise (S3 bucket takeover, CDN poisoning) and transport-layer attacks (MITM replacing the artifact in transit). The trust boundary reduces from "anyone who can write to the artifact store" to "the CI runner authorized to sign."

**What signing does not protect against**: a compromised CI runner can produce validly signed artifacts with arbitrary content — in Ed25519 mode it holds the private key, in KMS mode it has `kms:Sign` permission. An insider with merge permissions can change the manifest to point to a different verify key. These are mitigated by CI runner isolation and CODEOWNERS (Section 8.8), not by signing.

Neither the Ed25519 private key nor the KMS key ARN appears in the manifest, the artifact JSON, or any CLI output. The signing credential (whether a stored key or an IAM permission) is an operational concern managed outside of version control.

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
  "ciphertext": "base64...",
  "expiresAt": "2026-03-22T11:00:00.000Z",
  "signature": "base64...",
  "signatureAlgorithm": "Ed25519",
  "envelope": {
    "provider": "aws",
    "keyId": "arn:aws:kms:us-east-1:...",
    "wrappedKey": "base64...",
    "algorithm": "SYMMETRIC_DEFAULT",
    "iv": "base64...",
    "authTag": "base64..."
  }
}
```

Key design properties:

- **`ciphertextHash`**: SHA-256 of the ciphertext, verified by the runtime before decryption, detecting tampering or corruption in transit.
- **`expiresAt`**: Optional expiry timestamp that the runtime enforces, enabling short-lived credential rotation. Covered by the signature when signing is enabled — an attacker cannot extend the TTL without invalidating the signature.
- **`revokedAt`**: When present, signals immediate revocation. The runtime wipes its cache and refuses to serve secrets.
- **`signature`**: Optional base64-encoded cryptographic signature over a canonical payload containing all security-relevant fields. Verified by the runtime before decryption when a verify key is configured (see Section 4.3).
- **`signatureAlgorithm`**: Informational — the runtime derives the actual verification algorithm from the public key type, not this field.
- **`envelope`**: Optional KMS wrapper enabling tokenless, keyless deployments (see Section 6). Contains the KMS-wrapped DEK (`wrappedKey`), KMS key identifier (`keyId`), encryption algorithm, AES-GCM initialization vector (`iv`), and authentication tag (`authTag`).

The `ciphertext` field is base64-encoded encrypted binary — age format for age-only artifacts, AES-256-GCM for KMS envelope artifacts. Base64 is used because neither format can survive a JSON string round-trip intact — base64 provides a standard, language-agnostic encoding that any runtime can decode. When the `envelope` field is present, it contains the AES-256 DEK wrapped by KMS, plus the GCM initialization vector and authentication tag. The runtime first unwraps the DEK via `kms:Decrypt`, then base64-decodes and AES-256-GCM decrypts the ciphertext. Without the envelope, the runtime uses a locally-held age private key to decrypt the age-encrypted ciphertext directly.

### 4.5 Service Identity Scoping

Service identities provide **cryptographic least privilege**. Each identity has:

- A list of namespace scopes (which secrets it can access)
- A role: **CI** (decrypts source SOPS files directly — the identity's key is registered as a SOPS recipient on scoped files) or **runtime** (decrypts packed artifacts only — the identity's key is never registered on SOPS files)
- Per-environment cryptographic configuration (age recipient keys or KMS envelope keys)

An `api-gateway` identity scoped to `["api-keys", "database"]` cannot decrypt the `payments` namespace — the enforcement is cryptographic at the file level. The configuration of that enforcement — who is a recipient on which files — is controlled by the manifest in git (see Section 2.3 for the implications of git as the access control layer).

**Runtime identities have zero access to git-stored secrets.** A runtime identity (`pack_only: true` for age, or any KMS envelope identity) is never registered as a SOPS recipient on any file — the `registerRecipients` step is skipped entirely. A compromised workload with that identity's credential can only unwrap the packed artifact built specifically for it, recovering pre-scoped secrets for its environment. It has no cryptographic path to decrypt anything in git, even with read access to the repository. This is the strongest file-level isolation the architecture provides: the workload never touches the source-of-truth encrypted files, only the derivative artifact.

The two runtime modes — age and KMS envelope — share this isolation property. They differ in what the workload holds: an age runtime identity stores an age private key (still a static credential, see Section 4.1), while a KMS envelope identity holds only an IAM permission (`kms:Decrypt` on a specific key, no static secret). With separate KMS keys for the SOPS backend and the envelope (Section 4.1), KMS envelope mode adds a second layer: even if the workload were misconfigured with permission to read the encrypted files, it would lack `kms:Decrypt` on the SOPS key and could not decrypt them.

### 4.6 Delivery Modes

The JSON envelope is the default _output_ of `clef pack`, but it is not the only delivery path. Clef ships three delivery modes — each independently useful, and combinable within one manifest — covering different consumption preferences:

**Envelope + agent (the default).** `clef pack` writes a signed JSON envelope to an artifact store (S3, HTTP, or the VCS repository). The Clef agent polls the store, decrypts in memory, and serves secrets on `127.0.0.1:7779`. This is the path Sections 5 and 6 describe in detail, and it is the right default when the consuming workload is a long-running process (container, VM, sidecar) that can host a lightweight local HTTP client.

**Pack backend plugins.** `clef pack --backend <id>` swaps the emit step. A backend receives the decrypted key-value map plus the SOPS services and performs whatever delivery the target requires — `PutSecretValue` on AWS Secrets Manager, `PutParameter` on SSM Parameter Store, the equivalent calls on GCP Secret Manager or Azure Key Vault, or a custom HTTP `POST` to an internal store. Authentication uses the target's own SDK (IAM roles, service-account JSON, bearer tokens). Clef ships the plugin seam, the resolver (`@clef-sh/pack-<id>` → `clef-pack-<id>` → verbatim npm name), documentation, the bundled `json-envelope` backend, and two official plugins: `@clef-sh/pack-aws-parameter-store` and `@clef-sh/pack-aws-secrets-manager`. The plugin model fits cleanly with **cloud consumption surfaces** — AWS/GCP/Azure secret stores, Kubernetes Secrets, ECS task definitions — read-mostly storage primitives that runtime services load from natively and that expect to be populated from CI or IaC. It is a poor fit for **source-of-truth secret managers** (HashiCorp Vault, Doppler, Infisical) whose product positioning is to be the system of record themselves; the only legitimate pack-to-X workflow there is bootstrap or disaster-recovery seeding from a git-tracked snapshot. Plugin authors writing for that second category should document the bootstrap framing explicitly. Writing a new plugin against a cloud surface is a small handler — see `@clef-sh/pack-aws-parameter-store` for the worked example.

**IaC-native constructs (CDK).** The `@clef-sh/cdk` package provides `ClefArtifactBucket` (provisions a hardened S3 bucket and uploads the envelope — keeps the agent in the loop), `ClefSecret` (unwraps at stack deploy time, writes to AWS Secrets Manager), and `ClefParameter` (unwraps at stack deploy time, writes to SSM Parameter Store — one construct per parameter). The unwrap path uses a CloudFormation Custom Resource backed by a singleton Lambda whose IAM role has **no baseline `kms:Decrypt`**; authority is minted per-deploy via `kms:CreateGrant` scoped to Decrypt-only operations on the envelope key, and revoked when the stack updates or deletes. The consuming workload reads the resulting ASM secret or SSM parameter via whatever native mechanism it already uses — ECS `Secret.fromSecretsManager` or `Secret.fromSsmParameter`, `GetSecretValue` through the AWS SDK, CFN dynamic references, or the AWS Parameters and Secrets Lambda Extension. No Clef code in the runtime.

The three modes can coexist in one manifest. A service identity can be delivered via the agent in one environment, via AWS Secrets Manager in another, and via SSM Parameter Store in a third, without changing its `clef.yaml` entry — the delivery choice belongs to the pack invocation, not the identity.

| Mode                     | Decrypt site | Consumer reads from           | Auth at consume time  | Shipped                    |
| ------------------------ | ------------ | ----------------------------- | --------------------- | -------------------------- |
| Envelope + agent         | Runtime      | Agent HTTP (`127.0.0.1:7779`) | Bearer token (local)  | Yes (`@clef-sh/agent`)     |
| Pack backend plugin      | Pack time    | Target store's native API     | Target's IAM / tokens | Seam + AWS plugins shipped |
| CDK `ClefSecret`         | Deploy time  | AWS Secrets Manager           | AWS IAM               | Yes (`@clef-sh/cdk`)       |
| CDK `ClefParameter`      | Deploy time  | SSM Parameter Store           | AWS IAM               | Yes (`@clef-sh/cdk`)       |
| CDK `ClefArtifactBucket` | Runtime      | Agent (artifact lives in S3)  | Bearer token (local)  | Yes (`@clef-sh/cdk`)       |

**Zero custody holds across all modes.** No mode moves plaintext outside the team's trust boundary: the agent decrypts in the workload's memory, pack backends decrypt in CI and write to the team's own secrets store, CDK constructs decrypt in a per-deploy-granted Lambda running in the team's AWS account. The encryption and IAM topology from Sections 4.1, 4.3, and 8.4 applies identically — the difference is where the final decrypt happens and what consumes it.

**Trade-offs to be honest about:**

- _Pack backends_ peg freshness to the pack cadence. A secret rotated in `clef set` + merged + packed becomes live in the target store as soon as the pack job finishes — so CI latency is the floor on secret freshness. Broker-based dynamic credentials (Section 7) close this gap for credential types that support short-lived generation.
- _CDK constructs_ tie secret rotation to `cdk deploy`. A secret change requires a stack update. For secrets that rotate frequently the envelope-plus-agent path (or a pack backend targeting ASM invoked on its own cadence) is a better fit.
- _Envelope + agent_ requires the agent in every consumer. This is minimal (one sidecar per pod, one Lambda extension per function) but it is runtime code that must be operated. The CDK path eliminates it for AWS-native targets.

The choice between modes is not a security decision — the three share the same KMS envelope and IAM posture — it is about where the team prefers the final decrypt to happen and which delivery surface their existing infrastructure already reads from.

---

## 5. Production Workloads: The Runtime and Agent

This section describes the **envelope + agent** delivery mode from Section 4.6. The runtime library and agent are the reference implementation of the envelope consumer — the right default when the consuming workload is a long-running process. For IaC-native delivery (deploy-time unwrap to ASM or SSM), see the CDK constructs in Section 4.6. For write-through delivery to an existing secrets store, see pack backends in Section 4.6. Those paths skip the agent entirely and do not use the components described below.

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

### 6.1 Token Bootstrapping Without a Second System

As discussed in Section 1.3, age keys reduce the custody problem but don't eliminate it. **KMS envelope encryption breaks this cycle** — when the full KMS-native stack is in place (Section 4.1: SOPS backend is KMS, service identity uses KMS envelope, CI authenticates via IAM role). Under those conditions, no static credential exists anywhere in the pipeline:

- CI calls `kms:Decrypt` on the SOPS key (the KMS key in `.sops.yaml`) to read encrypted files. No private key.
- `clef pack` calls `kms:Encrypt` on the service identity's envelope key to wrap the ephemeral DEK. No static key stored.
- When KMS ECDSA signing is enabled, `clef pack` also calls `kms:Sign` on a separate asymmetric signing key to sign the artifact (see Section 4.3). No signing secret stored.
- Runtime calls `kms:Decrypt` on the envelope key to unwrap the DEK. No static key deployed.
- All authenticate via IAM role. Key material never leaves the HSM.
- Every `clef pack` generates a fresh random DEK. There is no long-lived secret to rotate or protect.

**Ephemeral DEK lifecycle — step by step:**

**CI pipeline (pack time):**

1. `clef pack` calls `kms:Decrypt` on the SOPS backend key to decrypt the source `.enc.yaml` files. Plaintext exists only in the CI runner's memory.
2. A fresh 32-byte random DEK and 12-byte IV are generated. The DEK is unique to this pack invocation — it will never be reused.
3. The decrypted secrets (scoped to the service identity's namespaces) are encrypted with AES-256-GCM using the DEK and IV.
4. The DEK is wrapped (encrypted) by calling `kms:Encrypt` on the service identity's envelope KMS key. The plaintext DEK is then zeroed.
5. If signing is enabled, the canonical payload is signed — either directly with an Ed25519 private key (CI secret) or via `kms:Sign` on an asymmetric KMS key (IAM permission, no secret). See Section 4.3.
6. The artifact envelope is assembled: AES-256-GCM ciphertext, KMS-wrapped DEK, IV, GCM authentication tag, integrity hash, optional signature. Published to VCS, S3, or the artifact store.

**Production runtime (serve time):**

1. The agent fetches the artifact from VCS API, S3, or HTTP.
2. Validates the envelope: version, integrity hash (SHA-256 of ciphertext), signature (if verification key is configured), and expiry.
3. Extracts the wrapped DEK from the `envelope` field and calls `kms:Decrypt` to unwrap it. This is the only KMS call at runtime — and it is the authorization gate. If the workload's IAM role lacks `kms:Decrypt` permission on this key, the request fails here.
4. Uses the unwrapped DEK with the IV and authentication tag to AES-256-GCM decrypt the secrets. The DEK is zeroed immediately after use.
5. Serves the decrypted secrets via `GET /v1/secrets`. In cached mode, the plaintext is held in memory until the next poll. In JIT mode (Section 6.4), steps 3–4 execute on every request and no plaintext is retained between requests.

**What the runtime needs**: IAM permission to call `kms:Decrypt` on a specific KMS key. No token. No static credential. No secret to bootstrap.

**What this means**: An EC2 instance, ECS task, or Lambda function with the right IAM role can decrypt secrets without any provisioned credentials. The IAM role is the authentication. KMS is the key management. Clef is the envelope and delivery mechanism.

### 6.2 Ephemeral DEK Rotation

Each `clef pack` invocation generates a fresh random AES-256 DEK. This means:

- No long-lived symmetric key exists in production.
- Each artifact revision has a unique encryption key.
- Compromising one artifact's DEK yields only that artifact's secrets, not historical or future versions.
- Key rotation is automatic: every pack is a rotation.

### 6.3 IAM as the Authentication Layer

In KMS envelope mode, the security model reduces to IAM permissions on a small set of KMS keys. In the hardened topology these are three separate keys; in simpler setups the SOPS and envelope keys may be the same (see Section 4.1).

1. **Who can call `kms:Decrypt`?** CI pipelines (to decrypt SOPS files via the SOPS backend key) and production workloads (to unwrap the DEK via the envelope key). With separate keys, these are two different IAM policies — the workload has no permission on the SOPS key.
2. **Who can call `kms:Encrypt`?** CI pipelines that wrap the DEK during `clef pack` (envelope key). In KMS-native mode, also used for SOPS encryption (SOPS backend key).
3. **Who can call `kms:Sign`?** CI pipelines that sign artifacts during `clef pack` (signing key — asymmetric, separate from both the SOPS and envelope keys). Only relevant when KMS ECDSA signing is enabled (see Section 4.3). The signing key requires only the `kms:Sign` permission — never `kms:Encrypt` or `kms:Decrypt`.
4. **Who can read the artifact?** Anyone with VCS API access or HTTP access to the storage location. But the artifact is useless without `kms:Decrypt` on the correct envelope key. The wrapped DEK is inert without KMS. When signing is enabled, a replaced artifact will also fail signature verification.

### 6.4 Just-In-Time Decryption: IAM as a Live Authorization Gate

In the default cached mode, the agent decrypts the artifact once and serves plaintext from memory until the next poll. If a workload is compromised and its IAM policy is revoked, secrets continue to be served from cache until the TTL expires — up to 5 minutes with the default configuration. For most workloads this is acceptable. For high-security environments where a compromise demands immediate credential cutoff, it is not.

**Just-in-time mode** (`CLEF_AGENT_CACHE_TTL=0`) eliminates this window. Instead of caching decrypted plaintext, the agent calls `kms:Decrypt` on every `GET /v1/secrets` request. No plaintext is held between requests. KMS becomes the live authorization gate — revoking the workload's IAM policy causes the next request to fail immediately with a 503, because the `kms:Decrypt` call returns Access Denied.

The agent still polls for fresh encrypted artifacts (every 5 seconds in JIT mode), but the poll only fetches and validates — no decryption occurs until a client requests secrets. Health checks are served from the encrypted artifact's metadata without touching KMS. Key names (`GET /v1/keys`) require decryption in JIT mode, since key names are not stored in the envelope — an intercepted artifact reveals nothing about its contents.

**Incident response flow:**

1. **Revoke** the workload's IAM policy → next `GET /v1/secrets` fails instantly (KMS denies unwrap)
2. **Rotate** the compromised secrets → `clef set` + `clef pack` + push
3. **Re-enable** IAM → agent picks up the new artifact within 5 seconds, next request decrypts successfully

The total recovery window is bounded by the artifact poll interval (5 seconds) plus the time to rotate and push — typically under 30 seconds end to end. Revocation itself is instant.

**Trade-off: latency.** Each `GET /v1/secrets` request incurs a KMS round-trip (~10–50ms depending on region and provider). This is negligible for workloads that read secrets at startup or on config reload. For workloads that read secrets on every inbound request, the cached mode with a short TTL (e.g., 30 seconds) may be more appropriate. The two modes serve different points on the security-latency spectrum — JIT mode is not universally better, it is the right choice when instant revocation outweighs the per-request KMS cost.

**Audit visibility improves.** In cached mode, a single KMS decrypt event covers an entire TTL window of secret reads. In JIT mode, every application read maps to a distinct KMS audit log entry. CloudTrail (or the equivalent) shows exactly when secrets were accessed, not just when the cache was last refreshed.

---

## 7. Dynamic Credentials

### 7.1 The Contract

A broker is any HTTP endpoint that returns a valid Clef artifact envelope. The agent polls it. The agent does not know or care what generated the credential — it validates the envelope, decrypts, and serves. The envelope specification (`version`, `identity`, `environment`, `ciphertext`, `ciphertextHash`, `expiresAt`, `revokedAt`, optional KMS `envelope`) is the only interface between credential generation and credential consumption.

### 7.2 The Broker SDK

Building a conforming envelope from scratch requires symmetric key generation, AES-256-GCM encryption, KMS wrapping, SHA-256 hashing, and JSON construction. The `@clef-sh/broker` package handles all of it. A broker author implements one function:

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

### 7.3 Broker Tiers, Registry, and Lambda Deployment

Credential sources divide into three tiers: Tier 1 (self-expiring — STS tokens, RDS IAM tokens, OAuth access tokens) implements only `create()`; Tier 2 (stateful — SQL database users, Redis ACL users) adds `revoke()` so the SDK can clean up before each rotation; Tier 3 (complex teardown) adds custom state. The SDK handles all envelope construction, encryption, caching, and lifecycle — the broker author writes only the credential generation call.

A Broker Registry provides `clef install rds-iam`-style scaffolding for common sources (STS AssumeRole, RDS IAM tokens, OAuth client credentials, parameterized SQL via Handlebars templates). For serverless workloads the agent runs as a Lambda extension, registering for `INVOKE` and `SHUTDOWN` events and serving secrets to the function handler via `http://127.0.0.1:7779/v1/secrets` — no SDK, no env var parsing, no cold-start credential bootstrapping.

Full broker tier specifications, the registry catalog, and the Lambda extension deployment guide are covered in the [dynamic credentials documentation](https://docs.clef.sh/guide/dynamic-credentials).

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
| Write access to git repo              | Everything above, plus can modify manifest                          | Decrypt existing secrets (can add rogue recipient, but PR review + `clef lint` detect this; see Section 8.8)                                   |
| Compromised CI runner                 | Plaintext of secrets within the service identity scope being packed | Access secrets outside that scope; persist access beyond the CI run (KMS mode)                                                                 |
| Compromised agent sidecar             | Plaintext of secrets in that service identity's current artifact    | Access other service identities' secrets; access historical or future artifact revisions (ephemeral DEKs)                                      |
| Artifact store write access           | Can replace artifacts in S3/GCS/VCS                                 | Produce a validly signed artifact without the signing key (when signing is enabled; see Section 4.3). Without signing, this is a viable attack |
| Artifact store read access            | Ciphertext and KMS-wrapped DEK                                      | Decrypt without `kms:Decrypt` permission on the specific KMS key                                                                               |
| KMS `Decrypt` permission on wrong key | Nothing useful                                                      | Decrypt artifacts wrapped with a different KMS key                                                                                             |

### 8.3 Access Control

Access control in Clef is the git repository itself: the manifest declares recipients, SOPS enforces the cryptography, and git controls who can change the manifest. Section 2.3 covers the implications — git carries the combined risk profile of a secrets store and an access control system. This section focuses on the cryptographic mechanisms that enforce scoping regardless of git controls:

- **Per-environment encryption**: Each environment can use a different backend (age, KMS) and different recipients. A developer with the `development` age key cannot decrypt `production`.
- **Per-service-identity scoping**: Service identities are registered as SOPS recipients only on the namespace files they need. The `api-gateway` identity cannot decrypt `payments` secrets because it is not a recipient on those files.
- **Per-artifact ephemeral DEKs** (KMS mode): Each packed artifact uses a unique random AES-256 DEK. Compromising one artifact's decrypted content reveals nothing about other artifacts.

The trust chain is: git write access → manifest control → recipient list → cryptographic enforcement. The residual risk — an insider who adds a rogue recipient via a legitimate-looking PR — is mitigated by `clef lint` (detects unrecognized recipients), CODEOWNERS, and required CI checks (see Section 8.8).

### 8.4 No Single Point of Failure

Unlike centralized vault architectures, there is no central server to attack, DDoS, or compromise. There is no shared database to breach. There is no root key or master secret that unlocks everything. The git repository is the source of truth, protected by existing git access controls.

The blast radius of a key compromise depends on the KMS key topology. The architecture supports three independent axes of key separation:

**SOPS backend keys** (source encryption, symmetric): The manifest supports per-environment backend overrides. Each environment can use a different encryption backend and key — age for local development, a regional KMS key for staging, a separate KMS key for production. A compromised key exposes only the SOPS files encrypted with that key, not files in other environments. Relevant permissions: `kms:Decrypt` (to read), `kms:Encrypt` (to write).

**Service identity envelope keys** (artifact encryption, symmetric): Each service identity declares its own KMS key per environment via `clef service create --kms-env`. The `api-gateway` production artifact can use a different KMS key than the `payments-svc` production artifact. Relevant permissions: `kms:Encrypt` (CI wraps the DEK), `kms:Decrypt` (runtime unwraps it).

**Signing key** (artifact provenance, asymmetric): When KMS ECDSA signing is enabled, a separate asymmetric KMS key is used to sign artifacts at pack time. This key requires only the `kms:Sign` permission — never `kms:Encrypt` or `kms:Decrypt`. Because it is asymmetric, it cannot be the same key as either the SOPS backend or envelope key. The signing key does not protect secrets directly; it proves that an artifact was produced by an authorized CI pipeline (see Section 4.3).

The full matrix is per-environment SOPS backend key multiplied by per-identity-per-environment envelope key, plus an optional signing key. A concrete example:

- Dev SOPS files: age (local, no cloud dependency)
- Production SOPS files: KMS key A (us-east-1, symmetric)
- `api-gateway` production envelope: KMS key B (symmetric)
- `payments-svc` production envelope: KMS key C (symmetric)
- Artifact signing: KMS key D (asymmetric, ECC_NIST_P256)

In this topology, a compromised `api-gateway` runtime has `kms:Decrypt` on key B. It can unwrap its own artifact — the secrets it already has via the agent. It cannot decrypt production SOPS files (key A), dev SOPS files (age, different key entirely), or the `payments-svc` artifact (key C). It has no `kms:Sign` permission on key D, so it cannot produce forged artifacts that would pass signature verification. The blast radius is one service identity in one environment.

At the other end of the spectrum, a single symmetric KMS key for SOPS and envelope is operationally simpler — one key, one IAM policy — and is a reasonable starting point for teams migrating from age. The blast radius of a compromised runtime in this topology is higher than it appears: if the runtime's envelope key and the SOPS backend key are the same, then a stolen IAM credential that grants `kms:Decrypt` on the envelope also grants `kms:Decrypt` on every SOPS source file in git. An attacker who compromises the workload, exfiltrates its IAM credential, and has read access to the repository can decrypt all source secrets — not just the runtime artifact. With separate keys, the runtime's `kms:Decrypt` permission covers only the envelope key; the SOPS source files are encrypted under a different CMK the runtime has no permission on, so the git repository is inert to the attacker even with the stolen credential.

The three-key topology — SOPS source files on one symmetric CMK, artifact envelopes on a separate symmetric CMK per service identity, and artifact signing on a dedicated asymmetric key — is the recommended production configuration. It is also the architecture that makes the strongest claim: no static credentials exist anywhere in the system, a fully compromised workload cannot be leveraged to read secrets beyond its own scope, and forged artifacts are rejected at the provenance layer. This is the destination the maturity tiers in Section 4.1 are pointing toward. The architecture supports the full range without code changes — it is a configuration decision in `clef.yaml`, `.sops.yaml`, and CI pipeline variables.

### 8.5 Defense in Depth

Multiple layers prevent secret exposure:

1. **Encryption at rest**: SOPS encrypts values in git.
2. **Encryption in transit**: Artifacts are encrypted (AES-256-GCM for KMS envelope, age for age-only); VCS APIs use HTTPS.
3. **Memory-only plaintext**: No plaintext files, no temp directories. Standard OS-level caveats apply: process environment variables (from `clef exec`) are visible in `/proc/<pid>/environ` on Linux to processes with appropriate permissions, and in-memory values are subject to OS swap unless the host is configured with encrypted swap or `mlock`. These are inherent limitations of any in-memory approach.
4. **Pre-commit scanning**: Pattern and entropy analysis catches accidental plaintext commits.
5. **Integrity verification**: SHA-256 hash in the artifact envelope detects tampering or corruption.
6. **Provenance signing**: Ed25519 or KMS ECDSA signatures prove the artifact was produced by the authorized CI pipeline, not injected by an attacker with artifact store write access (see Section 4.3). The signature covers all security-relevant fields including `expiresAt`, preventing TTL extension attacks.
7. **TTL and revocation**: Short-lived artifacts limit the window of exposure; revocation provides instant invalidation. In JIT mode (Section 6.4), KMS authorization is checked on every request — revoking IAM kills access immediately with no TTL delay.
8. **Localhost binding**: Agent API never exposed to the network.
9. **Timing-safe auth**: Bearer token comparison resists timing attacks.
10. **Host header validation**: DNS rebinding protection on all server routes.

### 8.6 KMS Key Loss and Disaster Recovery

In KMS mode, the SOPS backend key is the root of all source encryption. If this key is permanently deleted or its policy is irreparably mangled, every `.enc.yaml` file encrypted with it becomes unrecoverable — git preserves the ciphertext, but no path to plaintext exists. This is a property of the encryption model, not a Clef limitation: any system that delegates key management to a cloud KMS inherits this dependency.

Cloud providers have built-in safeguards against accidental deletion: AWS KMS enforces a mandatory 7–30 day waiting period before key destruction, during which the deletion can be cancelled. GCP and Azure have equivalent protections. These waiting periods are the primary safety net and should not be shortened.

Recommended operational controls:

- **Deny `ScheduleKeyDeletion` in the key policy** for all roles except a dedicated break-glass administrator. This prevents accidental or unauthorized deletion even by principals with broad KMS permissions.
- **CloudTrail / Cloud Audit alerting** on any `ScheduleKeyDeletion` or `DisableKey` event targeting SOPS or envelope keys. Detection during the waiting period allows cancellation.
- **Break-glass age recipient**: Add an offline age public key as a secondary SOPS recipient on all encrypted files (`clef recipients add`). Store the corresponding private key in a physical safe or hardware security module, never on a networked system. If the KMS key is lost, this age key can still decrypt every file in the repository. This is the one Clef-specific recommendation — everything else is standard KMS operational hygiene.

Clef does not implement its own key recovery mechanism. The cloud provider's KMS infrastructure is purpose-built for key lifecycle management, and layering a second recovery system on top would add complexity without meaningful additional protection.

### 8.7 Audit Trail

In KMS envelope mode, the audit trail is comprehensive, distributed across infrastructure the customer already operates:

1. **KMS audit logs**: Every `kms:Decrypt` call is logged by the cloud provider's audit system (CloudTrail, Cloud Audit Logs, Azure Monitor) with the caller's identity, timestamp, and key identifier. Since each artifact has a unique ephemeral DEK, each decrypt event maps to a specific artifact revision. This answers: who exercised decryption capability, and when?
2. **VCS history**: Git log shows who changed which secrets (key names are visible in plaintext), when, and in which namespace/environment. The artifact's `revision` field ties runtime consumption back to a specific commit.
3. **CI pipeline logs**: Show who triggered `clef pack`, for which service identity and environment, and when, creating the link from source change to published artifact.
4. **Agent telemetry**: `artifact.refreshed` events with revision, key count, and KMS envelope usage log the consumption side. Delivered as OTLP log records to the customer's observability platform.

The chain from git commit to CI pack to KMS unwrap to agent refresh provides complete provenance from secret authorship to consumption, all in systems the customer already monitors.

**Per-key read granularity**: The agent serves secrets as a complete bundle via `GET /v1/secrets` — there is no per-key endpoint. In envelope encryption, one KMS unwrap decrypts the entire namespace payload. Logging individual key reads would imply false granularity since all values are decrypted together. The correct audit boundary is the KMS decrypt call in the cloud provider's audit logs: it tells you who unwrapped the DEK, when, and for which artifact revision. That is the meaningful access event, and it lives in the customer's own infrastructure. In JIT mode (Section 6.4), each `GET /v1/secrets` request maps to a distinct KMS audit log entry.

### 8.8 Repository Integrity and CI Hardening

As established in Section 2.3, the git repository carries the combined risk profile of a secrets store and an access control system. This section details the specific controls that harden it:

- **Branch protection**: Require pull request reviews for all changes. No direct pushes to `main` or protected branches.
- **CODEOWNERS**: Assign security-sensitive files (`clef.yaml`, `.sops.yaml`, `*.enc.yaml`) to a security-owner group that must approve changes. This is the single most important control — it prevents rogue recipient additions from merging without security review.
- **`clef lint` as a required CI check**: Detects unrecognized recipients, scope mismatches, and unregistered keys. A rogue recipient addition surfaces as a lint error. But lint only blocks the merge if the organization configures it as a required status check — Clef cannot enforce this from inside the repository.
- **`clef scan` in CI**: Catches accidental plaintext commits in PRs before they reach the default branch.

**CI runners as pack-time operators.** The runner executing `clef pack` decrypts via the SOPS backend, sees plaintext, and re-encrypts into the envelope. This is the equivalent of the Vault admin role. Hardening recommendations:

- **Dedicated pack runner**: Do not pack on the same runner that executes arbitrary PR code. A `workflow_dispatch` or protected-branch-only job limits the attack surface to actors who can trigger production deployments.
- **SOPS backend KMS permissions scoped to the pack role only**: The IAM policy on the SOPS KMS key should grant `kms:Decrypt` only to the CI role, not to developer workstations, enforcing a boundary between who can read source secrets and who can write code.
- **Short-lived CI credentials**: Use OIDC federation (GitHub Actions `id-token: write` → `AssumeRoleWithWebIdentity`) so there are no long-lived secrets in CI. This eliminates the static credential from the CI trust boundary entirely.
- **Artifact signing**: When enabled (Section 4.3), the runtime hard-rejects unsigned or incorrectly signed artifacts. This prevents an attacker who compromises the artifact store from replacing artifacts — they would need both the signing key and artifact store write access.

The controls above — branch protection, CODEOWNERS, required CI checks, scoped IAM — are things most teams should already have. With Clef, they are not optional best practices; they are the secrets perimeter (see Section 2.3).

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

"Zero additional infrastructure" means no new servers to deploy, patch, or scale. It does not mean zero configuration. The KMS-native path requires provisioning KMS keys, writing IAM policies, configuring CI roles, and managing artifact storage — real operational tasks, but within the platform engineering the team already does, not a new category of infrastructure.

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

Clef positions as a _delivery_ layer rather than a consumption layer. The consumer-facing surface is whatever the chosen delivery mode produces (Section 4.6), not a new API consumers must adopt.

| Solution            | Consumer interface                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Vault               | Client libraries, CLI, API                                                                                                        |
| Doppler             | SDK, CLI, API                                                                                                                     |
| AWS Secrets Manager | AWS SDK, ECS secret injection, Lambda extension, CFN dynamic refs                                                                 |
| **Clef**            | **Agent HTTP (`127.0.0.1:7779`), OR the consumer surface of the chosen delivery target (ASM SDK, SSM, Vault API, Doppler, etc.)** |

Three consumer surfaces are available today, one per delivery mode:

- **Envelope + agent**: Consumers read from `127.0.0.1:7779` using any HTTP client. Universal, language-agnostic, one sidecar per workload.
- **Pack backend write-through**: Consumers keep reading from whatever store the backend wrote to — `GetSecretValue` through the AWS SDK for ASM, `ssm:GetParameter` for SSM, the equivalent native API for any other cloud secret store. No Clef code in the runtime.
- **CDK deploy-time unwrap**: `ClefSecret` writes to ASM so ECS `Secret.fromSecretsManager` and Lambda `GetSecretValue` keep working unchanged; `ClefParameter` writes to SSM so `ecs.Secret.fromSsmParameter` and the AWS Parameters and Secrets Lambda Extension keep working unchanged.

**What's shipped vs. roadmap.** The envelope + agent path, the pack-backend plugin seam (resolver, `PackBackend` interface, developer docs, the bundled `json-envelope` backend), the three CDK constructs, and two official pack plugins (`@clef-sh/pack-aws-parameter-store` and `@clef-sh/pack-aws-secrets-manager`) are all shipped. GCP Secret Manager and Azure Key Vault plugins are likely next on customer pull — both are cloud consumption surfaces and follow the same template. Plugins for source-of-truth secret managers (Vault, Doppler, Infisical) are not on the default roadmap because pack-to-X conflicts with what those products are designed to be; if a customer has a bootstrap or DR-seed use case, a plugin is a small handler against the stable interface. Vault and Doppler have broader out-of-the-box integration breadth than Clef does today; Clef's bet is that the architectural property — secrets live in git, delivery is pluggable, consumption uses the native cloud surface — is more durable than any individual integration.

### 9.5 Security Posture

The architectural differences produce different security properties. Neither system is universally stronger — the tradeoffs depend on the threat model.

**Where Clef is stronger:**

- **No runtime secret server** to DDoS, exploit, or misconfigure. Eliminates an entire class of infrastructure vulnerabilities (unsealing, storage backend, auth backend, TLS termination, HA failover).
- **Cryptographic scoping enforced at pack time**, not by policy documents that can drift. A service identity physically cannot decrypt secrets outside its namespace scope — the ciphertext does not contain them.
- **KMS key isolation**: the SOPS backend key, envelope key, and signing key are independent. Compromising a workload's IAM role gives zero leverage against the git-stored secrets or artifact signing (see Sections 4.3 and 4.5).
- **No token/lease management**: Vault requires token renewal, lease management, and graceful degradation when the vault is unreachable. Clef's artifacts are static files — no runtime auth handshake that can fail or be intercepted.

**Where Clef requires more care:**

- **Secret freshness**: Vault serves the latest value on every read. Clef serves whatever was in the artifact at pack time. If a secret is rotated at the source, the artifact must be re-packed and redeployed. Broker-backed dynamic credentials (Section 7) eliminate this gap for credential types that support short-lived generation.
- **Revocation latency**: Vault can invalidate a token immediately so the workload cannot fetch new secrets — but the workload still holds the secret value in memory, and rotating the credential at the source still requires the same steps regardless of the manager. Clef has `revokedAt` and TTL-based expiry, but the runtime must poll to notice. For static secrets (API keys, config values — most secrets), both systems require the same manual steps: rotate at source, update the store, wait for the workload to pick it up. Vault's edge is narrow and specific to its dynamic secret backends that can `REVOKE` server-side credentials they generated.
- **Operator trust during pack**: the person or CI runner executing `clef pack` has access to plaintext. In Vault, operators can configure policies without ever seeing secret values. However, the blast radius is scoped: `clef pack` only decrypts the SOPS files within the service identity's namespace scope.
- **Git and CI/CD carry more load**: the repository is simultaneously code, secrets, and access control (see Sections 2.3 and 8.7).

### 9.6 When to Use What

See Section 1.1 for a decision guide covering when Clef is and is not the right choice. The summary: Clef is the right fit when the team values secrets versioned alongside code, git-native review workflows, and no central server. The comparison details in Sections 9.1–9.5 are most relevant once that threshold question is answered.

---

## 10. Observability and Scaling

The architecture described in this paper leaves two practical concerns that grow with organizational scale: visibility across many repositories, and the engineering burden of building dynamic credential brokers. Both are addressed with open infrastructure.

### 10.1 Telemetry

Audit and observability are different concerns, handled by different infrastructure. Audit — who accessed what, when, and with what authorization — is the responsibility of the systems that perform the access: KMS audit logs for decryption events, VCS history for authorship, CI logs for packaging (Section 8.7). Clef does not duplicate this; the audit trail lives in infrastructure the organization already operates and monitors.

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

Clef's architecture delivers six properties that no existing secrets manager provides simultaneously:

1. **Zero custody**: Clef never sees, stores, or processes customer secrets. The git repository and the customer's KMS are the only systems that hold cryptographic material. To be precise: in KMS mode, custody is delegated to the cloud provider's HSM-backed key service. The customer trusts AWS/GCP/Azure with key material inside the HSM. This is a reasonable trust model for organizations already running production workloads on those cloud providers, but it is a trust delegation, not an absence of trust.

2. **Zero additional infrastructure**: No servers to deploy, databases to maintain, or clusters to scale. Secrets live in git. Runtime delivery uses the customer's existing compute and storage. The operational work of provisioning KMS keys and IAM policies is real but falls within existing platform engineering, not a new category of infrastructure.

3. **Tokenless access** (KMS mode): No static credential exists in the CI or production pipeline. Authentication is IAM policy; key material never leaves the HSM.

4. **Artifact provenance**: Packed artifacts can be cryptographically signed (Ed25519 or KMS ECDSA) so the runtime verifies the artifact was produced by an authorized CI pipeline before decryption. This reduces the trust boundary from "anyone who can write to the artifact store" to "the CI runner that holds the signing key" — closing the gap between integrity verification (ciphertextHash, which proves the artifact was not corrupted) and provenance verification (signature, which proves the artifact was produced by a trusted source).

5. **Dynamic credentials without vendor lock-in**: The artifact envelope is an open contract. Customers implement credential generation in their own serverless functions, using their own IAM roles, against their own data sources. Clef provides the delivery and lifecycle machinery, not the credential logic.

6. **Pluggable delivery**: Production delivery is not locked to one mechanism. The envelope + agent path is the self-contained default; pack backends write through to a cloud secret store (AWS Secrets Manager, AWS Parameter Store today; GCP Secret Manager, Azure Key Vault, Kubernetes Secrets follow the same template) so consumers keep using the native client they already use; CDK constructs unwrap at AWS stack deploy time into Secrets Manager or SSM for IaC-native workloads. The three modes share the same KMS envelope and IAM posture — the choice is about where the final decrypt happens and which consumer surface the team prefers.

The result is a secrets management system where the blast radius of a runtime compromise is bounded to one service identity in one environment (when separate KMS keys are used for SOPS and envelope encryption; see Section 8.4), where operational burden is limited to existing platform engineering, and where the vendor relationship is one of tooling, not custody.

The trade-off is that git and CI/CD carry more load than they do with a centralized secrets manager. The encrypted secrets, the access control manifest, and the signing pipeline all live within the team's existing version control and CI infrastructure. The controls required — branch protection, CODEOWNERS, required CI checks, scoped IAM — are well-understood practices, but they must be treated with the seriousness of a secrets perimeter, not just a code repository (see Section 8.8).

---

_Clef is open-source under the MIT license. Learn more at [clef.sh](https://clef.sh)._
