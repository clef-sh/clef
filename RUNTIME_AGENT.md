# Runtime Agent — Git-Committed Pack Artifacts + VCS API Fetch

## The Audit Gap

There are three points where secrets are accessed in a Clef-managed setup:

| Access point           | What happens                                         | Who reports it                                                        |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| **CI pipeline**        | `clef exec` / `sops -d` decrypts during build/deploy | **Clef Cloud** — every decrypt aligns 1:1 with a commit and a report  |
| **Developer machines** | `sops -d` locally during development                 | **KMS Auditor** — surfaces unexpected access in CloudTrail/audit logs |
| **Runtime agent**      | Application decrypts secrets at startup              | **Gap — nothing reports this today**                                  |

This document describes the architecture for closing this gap using git as the delivery mechanism — no custom telemetry endpoints, no external artifact stores, no sops binary at runtime.

## The Architecture

CI runs `clef pack` on every secrets commit and **commits the packed artifacts back to the repo**. At runtime, the agent fetches a single file via the VCS provider's HTTP API and decrypts it with `age-encryption`. That's it.

### CI flow

```
Developer commits encrypted SOPS files
  → CI triggers on secrets change
  → clef pack runs for each service identity × environment
  → Packed artifacts committed to repo at .clef/packed/{identity}/{environment}.age
  → Push
```

### Runtime flow

```
Application starts
  → Clef runtime agent initializes
  → Single HTTP call: GET /repos/{owner}/{repo}/contents/.clef/packed/{identity}/{environment}.age
  → age-encryption decrypt with service identity's private key
  → Inject secrets into the application (env vars, config object, etc.)
  → Done — no further network calls during the lifetime of the process
```

### Audit correlation

The VCS API call IS the telemetry. GitHub/GitLab/Bitbucket audit logs record every API access — who, when, from what IP, with what credential. These are third-party logs the service can't tamper with.

```
GitHub audit log: GET contents/.clef/packed/api-gateway/production.age from token tk-prod-api at 10:14:58
Age decrypt: service identity key decrypts artifact at 10:14:58 (local, no external call)
```

Every secret fetch maps to a VCS API call. Every VCS API call maps to a credential and timestamp. Auditors get third-party evidence without any Clef-reported data in the middle.

## Why This Architecture

### Alternatives considered and rejected

**isomorphic-git + memfs (original proposal).** Clones the full secrets repo into an in-memory filesystem at startup, decrypts via KMS/SOPS, discards the repo. Rejected because:

- **Git clones are slow.** Even shallow, ~300-500ms per startup. A 50-replica rolling deploy means 50 clones in seconds, risking VCS rate limits during the exact moment you need things to work.
- **memfs solves a non-problem.** The repo contains ciphertext, not secrets. Ciphertext without the KMS key is inert. Cloning encrypted files to a tmpdir is not a security event — the "no plaintext to disk" constraint is about decrypted values, which are already in-memory-only via the decrypt flow.
- **isomorphic-git is the wrong tool.** It exists for environments where you can't shell out (browsers). The runtime agent runs in Node.js containers. And with the VCS API approach, you don't need git at all — just HTTP.
- **Blast radius regression.** The full repo is in memory at startup, exposing ciphertext for all services and environments. Even if you scope-then-discard, there's a transient window where everything is in memory alongside KMS credentials.
- **Requires sops at runtime.** SOPS files need the sops binary (or a reimplemented envelope decrypt) to decrypt. This means either bundling a Go binary in every container or maintaining a custom SOPS format parser. Both are unnecessary complexity.

**Self-reported telemetry beacon.** The runtime agent POSTs a telemetry event to Clef Cloud after decrypting secrets. Rejected because:

- Self-reported evidence is inherently weaker than third-party logs for SOC 2 / compliance.
- Requires building and maintaining a telemetry endpoint, DynamoDB schema, and dashboard.
- If the POST fails, telemetry is silently lost.

**Pack artifacts to S3/GCS (current model without git commit).** CI packs and uploads to an external artifact store, agent polls for new revisions. Rejected because:

- Uploading to S3 is itself a deployment step — teams still need a pipeline run between secret rotation and runtime availability.
- Requires provisioning and managing an artifact store (S3 bucket, GCS bucket, access policies).
- Adds an external dependency that git already handles.

### What the chosen architecture achieves

**Single HTTP call at startup.** Not a git clone, not multiple file fetches. One GET request for one file. ~50ms including TLS handshake. Works within VCS API rate limits even at scale — a 50-replica deploy is 50 API calls, well within GitHub's 5,000 req/hr.

**No sops binary at runtime.** Pack runs in CI where sops is already available. The packed artifact is age-encrypted. The runtime agent only needs `age-encryption` — a pure JS npm package that's already a core dependency. No Go binaries, no platform detection, no `optionalDependencies`.

**Blast radius solved at CI time.** Pack scopes the artifact to the service identity's namespaces. At runtime, the agent only ever sees its own scoped, age-encrypted blob. Unscoped ciphertext is never fetched, never in memory, never on disk. This is a stronger guarantee than the isomorphic-git approach (which had the full repo in memory, even briefly).

**No redeploy for rotation.** Secret commit → CI packs and commits artifact → next startup fetches latest from git. No S3 upload, no artifact store webhook, no deployment pipeline for the application. The commit IS the delivery.

**Git is the artifact store.** Packed artifacts are versioned by git history. You get diffing, rollback, branch protection, and audit logs for free. No external artifact store to provision, secure, or pay for.

**Fully open source and auditable.** The pack step, the scoping logic, the artifact format, and the runtime decrypt are all in the open source codebase. Anyone can verify that the agent only fetches and decrypts what it's supposed to.

## What You Lose

**Startup depends on VCS availability.** If GitHub is down when your service restarts, secrets are unavailable. Mitigated by a local encrypted cache (see Mitigations below).

**CI must run before rotation takes effect.** Unlike direct VCS access where the commit IS the delivery, this model requires CI to re-pack after a secrets commit. In practice, this is a webhook trigger that runs in seconds — but it's a dependency.

**VCS credential at runtime.** The agent needs a token or deploy key to call the VCS API. That's one credential to provision per service. With pack-to-S3, you'd need S3 credentials instead — same trade-off, different provider.

**Packed artifacts in the repo.** Small files (~1-5KB each), but they're derived artifacts committed alongside source files. Some teams may find this unusual. Mitigated by `.clef/packed/` being a clearly separated directory with its own `.gitattributes`.

## Mitigations

**VCS availability:** A local encrypted cache (the last successfully fetched `.age` file written to disk) provides a fallback. On fetch failure, the agent decrypts from cache and logs a warning. The cache is scoped (it's a packed artifact, not the full repo) and encrypted (age, not plaintext). Stale secrets are better than no secrets for a restarting service.

**Cache staleness:** The agent can compare the fetched file's git SHA (returned in the VCS API response) against the cached file's SHA. If they match, no re-decrypt needed. If the fetch fails, the agent uses the cache but logs the staleness so operators know.

**Rate limiting:** VCS API rate limits are per-token. Each service identity should use its own token, distributing the limit. Even shared tokens handle typical scale — 5,000 req/hr (GitHub) accommodates frequent restarts. The cache further reduces API calls since healthy pods don't restart often.

**CI pack freshness:** The CI pipeline that runs `clef pack` should be triggered by any commit that modifies SOPS files or the manifest. Use path-based triggers (e.g., GitHub Actions `on.push.paths`) to avoid unnecessary pack runs on unrelated commits.

## Implementation

### Pack artifact format

The existing `clef pack` artifact format works as-is:

```json
{
  "version": 1,
  "identity": "api-gateway",
  "environment": "production",
  "packedAt": "2024-01-15T00:00:00.000Z",
  "revision": "1705276800000",
  "ciphertextHash": "sha256-hex",
  "ciphertext": "-----BEGIN AGE ENCRYPTED FILE-----...",
  "keys": ["DB_URL", "API_KEY", "STRIPE_KEY"]
}
```

Committed to `.clef/packed/{identity}/{environment}.age` in the secrets repo.

### Runtime agent (npm package: `@clef-sh/runtime`)

```
@clef-sh/runtime
├── vcs/
│   ├── provider.ts        — interface: fetchFile(repo, path, ref?) → Buffer
│   ├── github.ts          — GitHub contents API implementation
│   ├── gitlab.ts          — GitLab repository files API implementation
│   └── bitbucket.ts       — Bitbucket source API implementation
├── decrypt.ts             — age-encryption decrypt (already a core dependency)
├── cache.ts               — local encrypted cache (read/write .age file to disk)
├── agent.ts               — orchestrator: fetch → decrypt → inject
└── index.ts               — public API: init(config) → secrets
```

**Dependencies:**

- `age-encryption` — already a production dependency of `@clef-sh/core`
- No sops binary
- No isomorphic-git
- No memfs
- No cloud KMS SDKs

**Public API:**

```typescript
import { init } from "@clef-sh/runtime";

const secrets = await init({
  provider: "github",
  repo: "org/secrets",
  identity: "api-gateway",
  environment: "production",
  token: process.env.CLEF_VCS_TOKEN,
  ageKey: process.env.CLEF_AGE_KEY,
  cachePath: "/tmp/.clef-cache", // optional, enables fallback
});

// secrets.get("DB_URL") → "postgres://..."
// secrets.env() → { DB_URL: "postgres://...", API_KEY: "sk-..." }
```

### VCS credential options

- **Fine-grained PAT**: scoped to specific repos, read-only. GitHub, GitLab, Bitbucket all support this. Simplest to provision.
- **Deploy key** (SSH): scoped to a single repo, read-only. GitHub, GitLab, Bitbucket all support this. Provisioned once per service. Requires SSH-to-HTTPS translation for API calls.
- **GitHub App installation token**: short-lived, scoped to repo. More setup, but better security posture for organizations.

### CI pipeline (GitHub Actions example)

```yaml
name: Pack Secrets
on:
  push:
    paths:
      - "**/*.enc.yaml"
      - "**/*.enc.json"
      - "clef.yaml"

jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Clef
        run: npm install -g @clef-sh/cli

      - name: Pack all identities
        run: |
          for identity in $(clef service list --json | jq -r '.[].name'); do
            for env in $(clef service environments "$identity" --json | jq -r '.[]'); do
              clef pack "$identity" --environment "$env" \
                --output ".clef/packed/${identity}/${env}.age"
            done
          done

      - name: Commit packed artifacts
        run: |
          git config user.name "clef-ci"
          git config user.email "ci@clef.sh"
          git add .clef/packed/
          git diff --staged --quiet || git commit -m "chore(pack): update packed artifacts"
          git push
```

### Audit correlation (KMS Auditor)

No changes needed to the KMS Auditor. VCS access logs replace the telemetry endpoint:

- Ingest VCS API access logs (GitHub audit log API, GitLab audit events API)
- Match: VCS API GET at T from token T → age decrypt is local (no external call to correlate)
- For KMS-backed age keys: CloudTrail shows KMS usage at key provisioning time, not at runtime decrypt

The audit story is simpler than the original proposal because age decrypt is local — there's no KMS call at runtime to correlate. The VCS API log alone proves the service fetched secrets at time T with credential C.

## File layout

```
secrets-repo/
├── clef.yaml                                    # manifest
├── api/
│   ├── production.enc.yaml                      # SOPS-encrypted source files
│   ├── staging.enc.yaml
│   └── development.enc.yaml
├── database/
│   ├── production.enc.yaml
│   └── ...
└── .clef/
    └── packed/
        ├── api-gateway/
        │   ├── production.age                   # packed artifact (committed by CI)
        │   ├── staging.age
        │   └── development.age
        ├── payment-service/
        │   ├── production.age
        │   └── ...
        └── .gitattributes                       # mark as generated files
```

## Open Questions

1. **Branch strategy for packed artifacts.** Should CI commit packed artifacts to the same branch as the source SOPS files, or to a dedicated branch (e.g., `packed/main`)? Same branch is simpler. A dedicated branch avoids "noise" in the main branch history but adds complexity to the CI pipeline and the runtime fetch.

2. **Monorepo vs. dedicated secrets repo.** A dedicated repo keeps the packed artifacts and SOPS files together in a small, focused repo. A monorepo subdirectory means the VCS API call fetches from a larger repo (but the API call is the same — one file by path). Recommend starting with whatever the team already uses and documenting both patterns.

3. **Cache location in containerized environments.** `/tmp` works for most cases but is ephemeral in Lambda and some container runtimes. For Lambda, a `/tmp` cache survives across warm invocations (useful). For Kubernetes, a `emptyDir` volume shared across restarts could reduce VCS API calls. Document recommended cache paths per platform.

4. **Artifact signing.** Should the packed artifact include a signature that the runtime agent verifies? This would prove the artifact was produced by CI (not manually committed). The pack command could sign with a CI-specific age key, and the runtime agent could verify before decrypting. Not needed for v1 but worth designing for.
