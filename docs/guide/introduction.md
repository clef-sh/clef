# Introduction

Clef is a local-first, open source tool that brings structure, validation, and a UI on top of [Mozilla SOPS](https://github.com/getsops/sops). It makes it practical for teams to keep encrypted secrets **in the same repository as their code** — so a single commit hash represents your entire system: code, config, and credentials.

## Why this matters

When secrets live alongside code, CI checks out one ref and has the full picture — code and credentials together. Rollbacks are one operation, not a coordination problem across repos. Key drift between code and secrets is less likely because they can change in the same PR, and more visible when they do not. No external secrets service to query at runtime, no version matrix to manage across repos.

SOPS already gives you Secrets as Code — encrypted values you can commit to git. But at team scale, raw SOPS falls apart:

- **No structure.** There is no standard way to organise secrets across namespaces and environments. Every team invents its own folder layout, naming scheme, and promotion workflow.
- **No visibility.** You cannot tell at a glance whether a key exists in production but not staging, or whether a required database URL is missing from a new environment. Key drift between environments is invisible until something breaks at deploy time.
- **No validation.** SOPS does not know that `DB_PORT` should be an integer or that `DATABASE_URL` must start with `postgres://`. There is no schema layer.
- **No UI.** Every operation requires memorising SOPS flags and piping YAML through the terminal. There is no way to browse, compare, or edit secrets visually.
- **No guardrails.** Nothing stops a developer from committing a plaintext secrets file, or from accidentally overwriting production credentials without a confirmation step.

Clef solves all of these problems while keeping SOPS as the encryption engine and git as the source of truth.

## Design philosophy

Three principles guide every decision in Clef:

1. **Git is the source of truth.** There is no external database, no cloud sync, no server. Your secrets live in encrypted files in your git repository. Clef is an interface on top of that reality.
2. **SOPS is the encryption engine.** Clef never implements any cryptography. All encryption and decryption is delegated to the `sops` binary via subprocess calls. Decrypted values exist only in memory and are never written to disk.
3. **CLI and UI are equal citizens.** Every action available in the web UI has an equivalent `clef` CLI command. The UI even shows you the CLI command for common operations, so you can automate them in scripts and CI.

## Competitive landscape

|                      | Clef                              | Vault       | Doppler  | dotenv-vault | Raw SOPS |
| -------------------- | --------------------------------- | ----------- | -------- | ------------ | -------- |
| Git-native           | Yes                               | No          | No       | Yes          | Yes      |
| Local-first          | Yes                               | No          | No       | No           | Yes      |
| UI                   | Yes                               | Yes         | Yes      | Yes          | No       |
| Schema validation    | Yes                               | No          | No       | No           | No       |
| No infrastructure    | Yes                               | No          | No       | No           | Yes      |
| RBAC                 | Via KMS IAM                       | Built-in    | Built-in | Limited      | Manual   |
| Audit logs           | Via CloudTrail / Cloud Audit Logs | Built-in    | Built-in | No           | No       |
| Vendor holds secrets | No (OSS)                          | Self-hosted | Yes      | Yes          | No       |
| Key management       | age / KMS                         | Built-in    | SaaS     | SaaS         | Manual   |

Clef's unique position: **co-located secrets that actually scale to teams — with no intermediary between you and your data.** Unlike Vault or Doppler, no server holds your secrets. Unlike raw SOPS, you get structure, validation, and a workflow layer that makes co-location manageable as your team grows.

## Your KMS is your enterprise security layer

When security teams evaluate secrets management tools, three questions come up every time:

- **RBAC**: Who is allowed to access which secrets?
- **Audit logs**: What was decrypted, when, and by whom?
- **Short-lived credentials**: Does CI need a long-lived secret to decrypt?

With Clef and a cloud KMS backend, the answer to all three is already handled — by the infrastructure you already run.

**Access control via IAM.** When Clef uses AWS KMS or GCP KMS, access to a secret is an IAM policy. You grant and revoke access the same way you manage any other AWS or GCP permission. Your existing security team workflows, approval processes, and break-glass procedures apply directly. There is no RBAC system to learn, provision, or audit separately.

**Audit logs via CloudTrail and Cloud Audit Logs.** Every decryption is a KMS API call. AWS CloudTrail and GCP Cloud Audit Logs capture each one — envelope key ID, caller identity, timestamp, source IP. Those logs land in the same SIEM your security team already queries. No new tool to build a pipeline for.

**Zero-secret CI via OIDC.** GitHub Actions, GitLab CI, and CircleCI all support OIDC token exchange with AWS and GCP. Your pipeline assumes an IAM role with KMS decrypt permission — no long-lived credential needs to be stored anywhere. `clef exec` and `clef export` work with OIDC-authenticated AWS and GCP sessions.

Clef provides the workflow layer: the manifest, the matrix, the lint rules, the UI, the drift detection. Your KMS provides the security posture. You are not choosing between developer ergonomics and enterprise compliance — the architecture gives you both, from systems you already operate.

## What Clef provides

- A **manifest** (`clef.yaml`) that declares your namespaces, environments, and encryption settings in one place
- A **namespace-by-environment matrix** that maps every secret file to its logical location and detects missing cells
- **Schema validation** that enforces required keys, types, and patterns on every namespace
- A **CLI** with 17 commands covering the full secrets lifecycle: `init`, `get`, `set`, `delete`, `diff`, `lint`, `rotate`, `hooks`, `exec`, `export`, `import`, `doctor`, `update`, `scan`, `recipients`, `ui`, and `merge-driver`
- A **local web UI** served at `127.0.0.1` that visualises the matrix, provides inline editing with masked values, and highlights drift between environments
- A **pre-commit hook** that blocks accidental plaintext commits
- Support for all SOPS encryption backends: **age**, **AWS KMS**, **GCP KMS**, and **PGP**

## Next steps

Ready to get started? Install Clef and encrypt your first secret.

[Next: Installation](/guide/installation)
