# Clef Cloud: Product Strategy & Architecture

**Status:** Draft for architect review
**Date:** 2026-03-17

---

## Executive Summary

Clef Cloud is a control plane for git-native secrets management. It governs the process of managing secrets without ever taking custody of key material or ciphertext. The core differentiator: **governance without custody**.

The market currently offers two extremes — full-trust platforms (Vault, cloud secret managers) where the provider holds plaintext, and full-DIY tools (raw SOPS, git-crypt) with no governance or visibility. Clef occupies the gap: enterprise-grade policy enforcement, compliance reporting, and rotation orchestration, with a zero-custody trust model.

---

## Go-to-Market: Developer-First Adoption Funnel

The cloud product is not a top-down sale to security teams. It's a bottom-up adoption play where the developer is both the top of the funnel and the internal champion.

### The Funnel

1. **Developer adopts the CLI** (MIT, zero friction) — solves their immediate problem of managing encrypted secrets in git. No account, no SaaS dependency.
2. **Developer hits the single-repo visibility ceiling** — they can't see drift across repos, can't show a PM or incident commander the current state without asking them to run CLI commands, can't answer "is staging missing a secret?" across 5 repos without cloning each one.
3. **That pain becomes the upsell trigger** — the developer either champions the cloud product internally ("we're already using Clef, they have a dashboard") or the security team discovers Clef is already adopted and wants the governance layer on top.

### Who Uses What

The cloud product serves **anyone who needs visibility beyond a single repo checkout**:

| Audience | Primary need | What they use |
|---|---|---|
| **Developer** (hands-on-keyboard) | Manage secrets, resolve drift | CLI + local UI |
| **Developer** (operational awareness) | Cross-repo status, troubleshooting, incident triage | Cloud dashboard |
| **Engineering manager / team lead** | "Which teams have secrets out of date?" | Cloud dashboard |
| **Security / platform engineer** | Governance, compliance posture, access maps | Cloud dashboard + policy engine |
| **Compliance auditor** | Evidence for SOC2/HIPAA/PCI-DSS | Exported reports (via security team) |

The key insight: the developer isn't just the adoption engine — they're the **internal advocate**. They've already internalized the mental model (namespaces, matrix, drift). When the security team asks "how do we get org-wide visibility?" the developer says "we already use Clef." The developer pain is the wedge; the security team signs the contract.

### Positioning Implication

Frame the cloud product as **"the view your developers already want but can't get from the CLI alone"** — not just "governance for security teams." Lead with the developer's unmet need (cross-repo visibility, stakeholder communication, incident troubleshooting), then layer on compliance and policy enforcement for the buyer.

---

## Product Tiers

### Tier 1: Clef OSS (MIT)

The CLI, core library, local UI, merge driver, git hooks. Everything a developer or small team needs to manage encrypted secrets in git. This is the adoption engine — ungated, no account required.

### Tier 2: Clef Teams (Paid SaaS)

- Always-on hosted UI with team authentication
- Shared rotation schedules
- Slack/Teams notifications
- Basic audit log and compliance dashboard

### Tier 3: Clef Enterprise (Paid SaaS)

- Cross-repo policy engine (enforce rotation cadence, key types, recipient sets)
- Compliance framework reporting (SOC2, HIPAA, PCI-DSS evidence generation)
- Rotation orchestration via customer CI (see architecture below)
- Centralized audit log across all repos in an org
- Org-wide secret inventory and drift detection
- Incident response tooling (blast radius analysis, emergency rotation)
- RBAC, SSO/SAML

---

## Architecture

### Core Principle: Push, Never Pull

The control plane never has read access to customer repositories. All data flows from the customer's environment to the control plane via a CI job — the same model as CodeQL and Dependabot.

```
Customer Environment                          Clef Cloud
====================                          ==========

  Git Repo
  ├── clef.yaml
  ├── .sops.yaml                  ┌───────────────────────┐
  └── ns/env.enc.yaml             │                       │
         │                        │   API Gateway         │
         ▼                        │       │               │
  ┌─────────────────┐   POST      │   Policy Engine (BSL) │
  │ CI Runner       │───metadata─▶│       │               │
  │                 │             │   Dashboard / UI      │
  │ clef report     │             │       │               │
  │ (MIT action)    │             │   Audit Store         │
  └─────────────────┘             │       │               │
         ▲                        │   Alerting            │
         │ triggers               │                       │
  ┌──────────────────┐            └───────────────────────┘
  │ GitHub App       │◀─webhooks──  (actions:write only,
  │ (minimal perms)  │             no contents:read)
  └──────────────────┘
```

### Data Flow

1. Developer pushes a change that touches encrypted files.
2. GitHub/GitLab sends a webhook to the Clef Cloud App.
3. The App triggers a CI workflow in the customer's repo (permissions: `actions:write` only).
4. The CI job runs the Clef CLI, which reads manifests and SOPS metadata blocks locally.
5. The CLI builds a structured metadata report — recipient fingerprints, rotation timestamps, policy evaluation results. No ciphertext, no secret values.
6. The report is POSTed to the Clef Cloud API with an org-scoped token.
7. The control plane evaluates policies, updates the dashboard, and fires alerts if needed.

### What the Control Plane Sees

- Namespace/environment structure (from `clef.yaml`)
- Declared encryption rules (from `.sops.yaml`)
- Per-file metadata: rotation timestamps, recipient fingerprints, key types, SOPS version
- Policy evaluation results: pass/fail per rule
- Git metadata: commit SHAs, timestamps, author identifiers

### What the Control Plane Never Sees

- Ciphertext
- Decrypted secret values
- Repository file contents (beyond what the CI job explicitly extracts)

### Why Not Pull via GitHub API?

GitHub's permission model is repo-level, not file-level. `contents:read` grants access to every file in the repo. Even if the App only reads manifests, the _permission_ to read encrypted files is a red flag for security teams. The push model eliminates this entirely — the App never needs `contents:read`.

---

## CI Action

A lightweight GitHub Action (and equivalents for GitLab CI, Bitbucket Pipelines):

```yaml
# .github/workflows/clef-report.yml
name: Clef Policy Report
on: [push]
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: clef-sh/report@v1
        with:
          api-token: ${{ secrets.CLEF_API_TOKEN }}
```

The action:

1. Installs the Clef CLI
2. Runs `clef report` which extracts metadata from manifests and encrypted file headers
3. POSTs the structured report to the Clef Cloud API

The action is MIT-licensed. Customers can read, fork, and audit exactly what leaves their environment.

---

## GitHub App Permissions

| Permission              | Scope | Purpose                                                     |
| ----------------------- | ----- | ----------------------------------------------------------- |
| `actions:write`         | Org   | Trigger remediation workflows (rotation, recipient updates) |
| `checks:write`          | Org   | Post policy violation results on pull requests              |
| Webhook: `push`         | Org   | Know when to expect a new report                            |
| Webhook: `pull_request` | Org   | Evaluate policy on PRs before merge                         |

**Explicitly excluded:** `contents:read`, `contents:write`. The App cannot read repository files.

---

## Policy Engine (BSL Licensed)

The policy evaluation library is licensed under BSL (Business Source License) with a 3-4 year conversion to open source. Source-available so customers can audit the logic, but not resellable by competitors.

The same library serves two contexts:

### Local (via CLI)

```bash
clef audit --framework soc2
```

Runs offline, evaluates policies against local files, prints a report. No SaaS required. Provides immediate value and serves as a trust mechanism — customers can verify that local evaluation matches what the dashboard reports.

### At Scale (via Control Plane)

The SaaS imports the same policy library. It adds what local evaluation cannot:

- Aggregation across hundreds of repos
- Historical compliance trends
- Alerting on drift and policy violations
- Audit evidence export for compliance auditors
- Correlation of rotation gaps with incident timelines

### Compliance Frameworks

The policy library encodes rules for:

- SOC2 trust service criteria
- HIPAA security rule requirements
- PCI-DSS key management controls
- Custom organizational policies

This compliance mapping is deep domain knowledge that compounds over time. It is the primary intellectual property protected by the BSL license.

---

## Rotation Orchestration

The control plane triggers rotation via the customer's CI, not by accessing secrets directly.

**Standard flow:**

1. Policy engine detects a secret overdue for rotation.
2. Control plane triggers a GitHub Actions workflow via the App (`actions:write`).
3. The workflow runs `clef rotate` on the customer's runner, using their existing key access (KMS permissions, age keys in CI secrets).
4. CLI commits the re-encrypted file and opens a PR.
5. CI job reports the updated metadata back to the control plane.

### Realistic Blast Radius

Organizations do not use a single master key across all repos. Keys are scoped to limit blast radius — by team, environment tier, or cloud account. This means rotation is always scoped, never truly org-wide.

| Scenario                   | Trigger                       | Typical scope                            | Urgency                           |
| -------------------------- | ----------------------------- | ---------------------------------------- | --------------------------------- |
| Compromised developer key  | Age/PGP private key exposed   | 10-50 repos (their recipient set)        | Emergency                         |
| Offboarding                | Team member leaves            | 10-50 repos (their access)               | Planned (hours/days)              |
| KMS key rotation           | Scheduled or compromised      | 20-80 repos (single KMS key scope)       | Scheduled or emergency            |
| Leaked credential          | Specific secret in logs       | 1-5 repos (where that credential exists) | Emergency                         |
| Compliance-driven rotation | Policy (e.g., 90-day max age) | Many repos, but staggered                | Scheduled (batch over days/weeks) |

The realistic emergency scope is **10-80 repos**, not hundreds. CI-based orchestration handles this comfortably — queuing 30-50 jobs takes minutes of runner time, well within acceptable incident response windows.

**Known limitations:**

- **Multi-repo transactions.** A shared credential across N repos requires N CI jobs to succeed. Partial rotation requires retry/rollback logic in the control plane.
- **CI cost pass-through.** Clef-triggered jobs consume the customer's CI minutes. At scale this is a procurement consideration.
- **Workflow integrity.** If the workflow file is deleted or modified in a repo, rotation jobs fail. Detectable via missing reports.

---

## Licensing Summary

| Component                | License               | Rationale                                                          |
| ------------------------ | --------------------- | ------------------------------------------------------------------ |
| CLI + core library       | MIT                   | Adoption — must be zero friction                                   |
| CI action                | MIT                   | Trust — must be auditable                                          |
| Policy/compliance engine | BSL (3-yr conversion) | Core IP — prevents competitor resale while allowing customer audit |
| Control plane SaaS       | Proprietary           | Hosted service — standard SaaS model                               |

---

## Competitive Moat

The moat is a combination of three factors, none sufficient alone:

1. **Zero-custody positioning (brand moat).** Once Clef is known as "the secrets tool that never sees your secrets," every competitor offering a hosted vault plays a different game. This is a structural incentive alignment with security-conscious organizations.

2. **Policy engine depth (IP moat).** The compliance framework mappings — translating SOC2/HIPAA/PCI-DSS requirements into concrete secret management policies — represent compounding domain knowledge. A competitor can replicate the CLI in a weekend; replicating the compliance library takes years.

3. **Per-customer data gravity (switching cost moat).** Once an organization has 18+ months of audit history, policy configurations tuned to their structure, and CI integration across repos, migration cost is high. This is depth (per-customer lock-in), not breadth (network effects).

### Platform Risk Mitigation

The primary risk is a larger platform (GitHub, GitLab) building native secrets governance.

Mitigating factors:

- **Multi-forge support.** GitHub will never support GitLab. Enterprises rarely use a single forge.
- **SOPS ecosystem.** Clef builds on an existing trusted encryption standard. Platform vendors would build proprietary alternatives that security teams distrust.
- **Vendor incentive misalignment.** GitHub's incentive is to pull secrets into their platform (consolidation). Clef's incentive is to keep secrets in git under customer control. Security teams prefer the latter.

---

## UI Architecture

The local UI and the hosted UI serve fundamentally different purposes. The local UI is a **secrets management tool** — it decrypts values, validates schemas against plaintext, and supports inline editing. The hosted UI is a **governance dashboard** — it shows policy compliance, rotation status, and audit history using only the metadata received from CI reports. It never sees ciphertext or decrypted values.

### What's Shared

The shared surface between local and hosted is limited to presentational primitives:

- Matrix grid layout (namespace × environment)
- Environment switcher
- Navigation patterns and design system

These are extracted from `@clef-sh/ui` (MIT) as reusable components.

### What's Not Shared

Many of the local UI's core features require decryption access that the hosted UI will never have:

| Feature               | Local UI                                | Hosted UI                                                              |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| View decrypted values | Yes (via SOPS)                          | No — never has ciphertext                                              |
| Edit/set secrets      | Yes (direct CLI)                        | No — triggers CI workflows                                             |
| Schema validation     | Yes (validates plaintext)               | No — can only verify schema _exists_ via manifest                      |
| Plaintext diff view   | Yes (decrypts both sides)               | No — shows metadata diff only (recipients changed, rotation timestamp) |
| Recipient list        | Yes (reads `.sops.yaml` + file headers) | Yes (from CI report metadata)                                          |
| Rotation status       | Yes (reads file headers)                | Yes (from CI report metadata)                                          |
| Compliance posture    | No                                      | Yes (aggregated across repos)                                          |
| Audit history         | No                                      | Yes (stored in control plane)                                          |
| Org-wide inventory    | No (single repo)                        | Yes (all repos)                                                        |
| Policy configuration  | No                                      | Yes                                                                    |

### Hosted UI (Private, not published)

A separate private package that imports the shared grid/layout primitives from `@clef-sh/ui` and builds the governance-specific views:

- **Auth wrapper** — SSO/SAML, team RBAC
- **Cloud API adapter** — reads from Clef Cloud API (aggregated report metadata)
- **Org dashboard** — multi-repo compliance posture, drift alerts, rotation status
- **Audit log viewer** — historical record of changes, rotations, policy evaluations
- **Policy configuration UI** — rotation schedules, compliance framework selection, alerting rules

### Contribution Flow

Improvements to shared presentational components (grid layout, design system) flow back upstream into `@clef-sh/ui` and benefit OSS users. Governance-specific views never touch the open package. The local UI's decryption-dependent features (value display, schema validation, editing) remain local-only.

### Upgrade Path

The local UI familiarizes developers with the matrix model and Clef's mental model for organizing secrets. The hosted UI extends that mental model to org-wide governance. The interfaces share visual language but serve different audiences: the local UI serves the **developer managing secrets**, the hosted UI serves the **security team governing them**.

---

## Recommended Build Sequence

1. **`clef report` CLI command** — metadata extraction and structured output. This is the foundation everything else depends on.
2. **Clef Cloud API** — receives reports, stores metadata, evaluates policies.
3. **GitHub App (minimal)** — webhook receiver + `actions:write` for triggering CI.
4. **Dashboard** — org-wide compliance posture, per-repo status, drift alerts.
5. **`clef audit` local evaluation** — same policy engine running offline via CLI.
6. **Rotation orchestration** — triggered via App, executed in customer CI.
7. **Compliance framework library** — SOC2, HIPAA, PCI-DSS rule mappings.
