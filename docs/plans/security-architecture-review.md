# Security Architecture Review: Clef vs. Centralized Vault

*Session date: March 25, 2026*

---

## 1. KMS Isolation — Service Identity vs. SOPS Backend

**Q: When creating a service identity with a separate KMS key, is it that KMS (not the SOPS backend KMS) that is used to create the envelope when packing artifacts? Confirm that a compromised workload with IAM decrypt permissions could not reveal anything in git.**

**Confirmed.** The following code path was traced:

### Service identity creation stores a separate KMS key per environment

In `packages/core/src/service-identity/manager.ts`, when `kmsEnvConfigs` is provided for an environment, the identity stores `{ kms: kmsConfig }` (the service-identity-specific KMS key). No age keys are generated, and **no recipient is registered on the SOPS files**:

```ts
if (kmsConfig) {
  environments[env.name] = { kms: kmsConfig };
} else {
  // Age-only path — generates age key pair, registers as SOPS recipient
}
```

The `registerRecipients` method explicitly skips KMS environments — `if (isKmsEnvelope(envConfig)) continue;` — so the service identity has **zero access** to the SOPS-encrypted files in git.

### Pack uses the service identity's KMS key, not the SOPS backend

In `packages/core/src/artifact/packer.ts`, the KMS envelope path:

1. Decrypts the SOPS files via the **SOPS backend** (available to the operator running `clef pack`)
2. Generates an **ephemeral age key pair** (exists only in memory)
3. Age-encrypts the plaintext secrets to the ephemeral public key
4. Wraps the ephemeral **private** key with `this.kms.wrap(kmsConfig.keyId, ...)` — this is the **service identity's KMS key**, read from `envConfig.kms.keyId`

The CLI in `packages/cli/src/commands/pack.ts` resolves the KMS provider from the service identity's config:

```ts
if (envConfig && isKmsEnvelope(envConfig)) {
  kmsProvider = createKmsProvider(envConfig.kms.provider, { region: envConfig.kms.region });
}
```

### Runtime unwraps using the service identity's KMS key only

In `packages/runtime/src/poller.ts`, the runtime reads `artifact.envelope.keyId` (the service identity's KMS ARN baked into the artifact) and calls `kms.unwrap()` with that key to recover the ephemeral age private key, then decrypts the ciphertext.

### Security isolation confirmed

The two KMS keys are completely independent:

- **SOPS backend KMS** — encrypts files in git. Used by the `sops` binary. The workload never needs access to this.
- **Service identity KMS** — wraps the ephemeral envelope key inside the packed artifact. The workload only needs `kms:Decrypt` on this key.

A compromised workload with IAM permission to call `kms:Decrypt` on the service identity's key can unwrap the packed artifact envelope — but that gives it **only the secrets scoped to its namespaces for one environment**. It cannot decrypt anything in git because the SOPS backend uses a different KMS key entirely, and the service identity has no SOPS recipient registered on those files.

---

## 2. Comparison with Centralized Vault Architectures

**Q: How does this compare with centralized vault architectures? Would this setup be more or less secure?**

### Attack surface geometry

**Centralized vault** (Vault, AWS Secrets Manager, etc.): single API endpoint that every workload authenticates to at runtime. Compromise the vault's auth backend or network path → access to **all** secrets for any identity the attacker can impersonate. The vault is a high-value target with a large blast radius.

**Clef's model**: there is no central secret-serving infrastructure at runtime. The packed artifact is a static file on S3/GCS. The only runtime dependency is the cloud KMS API (which is managed infrastructure you don't operate). There is no Clef server to attack.

### Blast radius on workload compromise

| Scenario | Centralized Vault | Clef KMS envelope |
|---|---|---|
| Attacker gets workload IAM role | Can call vault API for any secret the role's policy allows — policies are often over-broad | Can only `kms:Decrypt` on the service identity's key → recovers only the scoped, pre-packed secrets for that one environment |
| Attacker gets network access | Can reach the vault endpoint (unless segmented) | No endpoint to reach — artifact is already local or fetched from a static store |
| Attacker gets git repo access | N/A (secrets aren't in git) | Gets SOPS-encrypted files — useless without the SOPS backend KMS key, which is a different key than any workload has |

### Where Clef is more secure

- **No runtime secret server** to DDoS, exploit, or misconfigure. Eliminates an entire class of infrastructure vulnerabilities.
- **Cryptographic scoping** is enforced at pack time (namespace filtering in `resolveIdentitySecrets`), not by policy documents that can drift. A service identity physically cannot decrypt secrets outside its namespace scope — the ciphertext simply doesn't contain them.
- **KMS key isolation**: the SOPS backend key and the envelope key are independent. Compromising a workload's IAM role gives zero leverage against the git-stored secrets.
- **No token/lease management**: vaults require token renewal, lease management, and graceful degradation when the vault is unreachable. Clef's artifacts are static files — no runtime auth handshake that can fail or be intercepted.

### Where Clef is less secure (or requires more care)

- **Secret freshness**: vault serves the latest value on every read. Clef serves whatever was in the artifact at pack time. If a secret is rotated, you must re-pack and redeploy.
- **Revocation latency**: vault can revoke a token instantly. Clef has `revokedAt` in the artifact and TTL-based expiry, but the runtime must poll for a new artifact to notice — there's a window.
- **Operator trust**: the person running `clef pack` has access to the plaintext. In vault, operators can configure policies without ever seeing secret values.
- **Audit trail**: vault has built-in audit logging of every secret access. Clef's artifact fetch is just an S3 GET — KMS CloudTrail logs every `Decrypt` call but it's not unified.

---

## 3. Vault Revocation — How Instant Is It Really?

**Q: How would Vault do instant revocation? What is the process vs. Clef's `pack` + `aws s3 cp`, and how is it actually easier?**

### Vault "revocation" — what actually happens

**Revoking a token/lease**: `vault token revoke <token>` invalidates the auth token so the workload can't fetch *new* secrets. But the workload already has the secret value in memory. The running process still has `DB_PASSWORD=xyz` in its environment or config. Vault didn't reach into the process and wipe it.

**Rotating a compromised secret** still requires:
1. Rotate the credential at the source (e.g., change the DB password in RDS)
2. Update the value in Vault
3. Wait for the workload to re-fetch (restart, or rely on short polling interval)

If the workload caches secrets (and most do), there's a stale window there too.

**Dynamic secrets** (Vault's strongest case): For backends like database credentials where Vault generates short-lived credentials per-lease, revocation is more meaningful — Vault can `REVOKE` the DB user it created. But this only works for a subset of secret types that Vault has a backend for.

### Clef revocation

1. `clef pack api-gateway production --output ./artifact.json`
2. `aws s3 cp ./artifact.json s3://bucket/path.json`
3. Runtime polls, sees new revision, decrypts and swaps in-memory cache

Or for immediate kill: set `revokedAt` in the artifact, upload it, runtime sees revocation on next poll and wipes its cache.

### The actual delta

For **static secrets** (API keys, signing keys, config values — i.e., most secrets): both systems require the same manual steps: rotate at source → update the store → wait for the workload to pick it up. The "instant revocation" claim was overstated.

Vault's edge is narrow and specific to its dynamic secret backends.

---

## 4. Dynamic Secrets — The Broker System

**Q: This tool also supports dynamic secret backends via the `@clef-sh/broker` SDK. The agent only cares about the envelope interface — so it could be a Lambda, not just static S3.**

Correct. The broker system closes the dynamic secrets gap. Here's the actual code path:

### What the broker does

A broker is a Lambda (or container/Cloud Function) that implements one method:

```ts
interface BrokerHandler {
  create(config: Record<string, string>): Promise<BrokerCreateResult>;
  revoke?(entityId: string, config: Record<string, string>): Promise<void>;
}
```

The `@clef-sh/broker` SDK's `packEnvelope()` in `packages/broker/src/envelope.ts` produces the **exact same artifact envelope format** that `clef pack` produces: ephemeral age key, KMS-wrapped, with `expiresAt`. The runtime's `ArtifactPoller` doesn't know or care whether the envelope came from a static S3 file or a live Lambda — it just implements the `ArtifactSource` interface:

```ts
interface ArtifactSource {
  fetch(): Promise<{ raw: string; contentHash?: string }>;
}
```

### Concrete broker examples in the repo

| Broker | Tier | What it does |
|---|---|---|
| `brokers/aws/sts-assume-role` | 1 (self-expiring) | Calls `AssumeRole`, returns `AWS_ACCESS_KEY_ID` / `SECRET` / `SESSION_TOKEN` |
| `brokers/aws/rds-iam` | 1 | Generates a 15-minute RDS IAM auth token |
| `brokers/agnostic/oauth-client-credentials` | 1 | Exchanges client credentials for an access token |
| `brokers/agnostic/sql-database` | 2 (stateful) | Creates ephemeral DB user via `CREATE ROLE`, implements `revoke()` to `DROP ROLE` on shutdown |

The Tier 2 SQL handler proactively `DROP ROLE`s the previous credential before issuing the next one — the SDK's `createHandler()` automatically calls `revoke()` before generating a new credential and on `shutdown()`.

### Revised comparison

The "revocation latency" and "secret freshness" disadvantages don't apply when a broker is in the path. The broker generates fresh, short-lived credentials on each poll. There's nothing stale to revoke — the STS token or DB user expires on its own.

This gives Vault's dynamic secret capability without Vault's infrastructure burden: the broker is a stateless Lambda, the envelope contract is the same, and the KMS isolation model is unchanged.

---

## 5. Which Is More Secure? Recommendation

**Q: Which one would you recommend?**

**Clef with KMS envelope + brokers.**

### The security argument is structural, not feature-based

Vault is a **runtime dependency you operate**. It has a network endpoint, an auth backend, a storage backend, an audit backend, TLS termination, HA configuration, unsealing, and upgrade cycles. Every one of those is an attack surface and an operational failure mode.

Clef eliminates that service entirely. The things you depend on at runtime are:

1. **Cloud KMS** — managed by AWS/GCP/Azure, hardened beyond what any team can replicate
2. **A static file on S3** (or a stateless Lambda for dynamic secrets) — no auth backend to exploit, no unsealing, no HA to misconfigure
3. **The envelope contract** — a JSON schema, not a running process

### Threat model comparison

| Threat | Vault | Clef |
|---|---|---|
| Compromised workload IAM | Calls Vault API → gets whatever the policy allows (policies drift, are often over-broad) | `kms:Decrypt` on one key → gets only the pre-scoped artifact for one identity + one environment |
| Compromised source control | N/A | SOPS files encrypted with a different KMS key — useless |
| Compromised network | Vault endpoint is reachable (mTLS helps but adds complexity) | No endpoint. S3 + KMS calls only |
| Supply chain / operator | Vault operator can read any secret via root token or policy escalation | Pack-time operator sees plaintext, but blast radius is scoped to what they pack. No root token equivalent |
| Infrastructure outage | Vault down = workloads can't fetch secrets | S3 down = stale artifact served from disk cache. KMS down = can't decrypt new artifacts, but current cache holds |

### When you'd still pick Vault

- You already run Vault, have a dedicated platform team maintaining it, and your compliance framework specifically requires it
- You need Vault's transit encryption engine or PKI CA — capabilities Clef doesn't replicate

---

## 6. Changed Security Posture for Git and CI/CD

**Q: Does this mean git and CI/CD runners become more of a target? Do I need to change my security posture around those two surfaces?**

Yes. The whitepaper states it directly:

> *"The git repository carries the combined risk profile of a secrets store and an access control system. Organizations should protect it accordingly."*

### Git becomes your secrets perimeter

With Vault, git is just code. With Clef, git contains the encrypted secrets. The **manifest** (`clef.yaml`) controls who can decrypt — it declares recipients. An attacker who can **merge** a change to `clef.yaml` can add their own age public key as a recipient, wait for a re-encryption, and then decrypt.

**Required controls:**

- **Branch protection on `main`/`production`** — no direct pushes, require PR reviews
- **CODEOWNERS** — assign `clef.yaml`, `.sops.yaml`, and `*.enc.yaml` to a security-owner group that must approve changes
- **`clef lint` in CI as a required check** — detects unrecognized recipients and scope mismatches. A rogue recipient addition surfaces as a lint error, but only blocks the merge if wired as a required status check
- **`clef scan` in CI** — catches accidental plaintext commits in PRs before they reach the default branch

### CI/CD runners become pack-time operators

The runner executing `clef pack` decrypts via the SOPS backend, sees plaintext, and re-encrypts into the envelope. This is the equivalent of the Vault admin role.

**Required controls:**

- **Dedicated pack runner** — don't pack on the same runner that runs arbitrary PR code. A `workflow_dispatch` or protected-branch-only job is ideal
- **SOPS backend KMS permissions scoped to the pack role only** — IAM policy on the KMS key should allow `kms:Decrypt` only for the CI role
- **Short-lived CI credentials** — use OIDC federation (GitHub Actions `id-token: write` → AWS `AssumeRoleWithWebIdentity`) so there are no long-lived secrets in CI
- **Artifact integrity** — the packed artifact has `ciphertextHash` for tamper detection. For stronger guarantees, sign the artifact or use S3 Object Lock

### What Clef already provides (activate these)

| Feature | How to activate | What it catches |
|---|---|---|
| Pre-commit hook | `clef hooks install` (auto-runs on `clef init`) | Unencrypted `.enc.yaml` commits, plaintext secrets in staged files |
| `clef scan --staged` | Runs via the pre-commit hook | Pattern matches (AWS keys, Stripe keys, etc.) + Shannon entropy detection |
| `clef lint` | Add to CI as a required status check | Rogue recipients, missing matrix files, scope drift, SOPS corruption |
| Protected environments | `protected: true` in manifest | Confirmation prompt on writes to production — prevents accidents |
| Single-recipient warning | `clef lint` | Warns when a file has only one recipient (no recovery if key lost) |

### Summary

Git and CI/CD **do** carry more load now. But the controls required (branch protection, CODEOWNERS, required CI checks, scoped IAM) are things most teams should already have. The difference is that with Vault, sloppiness in these areas doesn't expose secrets. With Clef, it can — because the encrypted secrets and the access control manifest are both in the repo.

The upside is that all of it is auditable in `git log`, reviewable in PRs, and enforceable with tools you already use. No second system to secure.
