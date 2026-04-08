# HashiCorp Says Your Secrets Manager Needs 12 Things. Here's How We Stack Up. 🎹

HashiCorp recently published a whitepaper called [_"12 Things a Modern Secrets Management Solution Must Do."_](https://www.hashicorp.com/en/on-demand/12-things-a-modern-secrets-management-solution-must-do) It's a solid framework — genuinely useful for evaluating any secrets tool.

So we ran [Clef](https://clef.sh) through it. Honestly.

We're not going to pretend we check every box the same way Vault does. We're a git-native secrets manager built on SOPS — no servers, no tokens, no vendor custody. Different architecture, different tradeoffs. Here's where we're strong, where we're different, and where we'll tell you to use something else.

---

## The Scorecard 📋

### 1. Secure Secrets Storage 🔒

**Vault:** Centralized encrypted KV store. Secrets encrypted before hitting persistent storage. Dashboard + CLI.

**Clef:** Encrypted files in git. SOPS encrypts values using age or cloud KMS. Decrypted values exist only in memory — plaintext never touches disk. The repo _is_ the store.

✅ **Verdict:** Both nail this. Different storage model, same outcome — secrets encrypted at rest, protected from raw storage access.

---

### 2. Centralized Management 🏢

**Vault:** Enterprise dashboard. SecOps manages everything from one place without bugging developers.

**Clef:** The git repo is the single source of truth. `clef lint` validates the matrix. `clef report` publishes structured JSON for your observability stack.

🟡 **Verdict:** Clef is developer-first CLI today — no enterprise dashboard. If you need SecOps visibility without git fluency, that's not us _yet_. Clef Pro is coming for exactly this. Right now, we're focused on teams where the developers _are_ the security team.

---

### 3. Secret Scanning 🔍

**Vault:** HCP Vault Radar scans across your entire IT estate — code, wikis, Slack, ticketing, cloud storage.

**Clef:** `clef scan` does pattern matching + entropy analysis on the git repo. Pre-commit hooks and CI integration catch leaks before merge.

🟡 **Verdict:** Clef covers the most common leak vector (code), not the whole org. For everything else, pair with GitGuardian or Trufflehog. We're not going to pretend a git hook replaces organization-wide scanning.

---

### 4. Strong Encryption 🛡️

**Vault:** Encryption as a Service (EaaS). AES-256-GCM via transit engine. Encrypt arbitrary application data.

**Clef:** SOPS + age (X25519/ChaCha20-Poly1305) or cloud KMS (AES-256-GCM). All crypto delegated — zero custom cryptography.

✅ **Verdict:** Both strong. Clef encrypts secrets, not arbitrary payloads — we're not an EaaS. But the encryption itself? Rock solid, industry-standard, no homebrew.

---

### 5. Secrets Versioning 📜

**Vault:** KV v2 version history. UI shows who changed what. API rollback to previous versions.

**Clef:** Git _is_ the versioning. Full commit history, PR context, code review, blame, branching. Rollback = `git revert` → PR → merge → CI repacks.

✅ **Verdict:** This is Clef's home turf. Git versioning is arguably _stronger_ — you get author, reviewer, CI status, and the complete code context around the change. And every developer already knows how to use it.

---

### 6. Advanced Access Control 🚪

**Vault:** Identity-based policy engine. RBAC, MFA, fine-grained per-path permissions. Dozens of auth methods.

**Clef:** Cryptographic scoping at the namespace level. Service identities are SOPS recipients only on their namespaces — enforcement is at the encryption layer. Per-environment keys. Git branch protection + CODEOWNERS guard the manifest.

🟡 **Verdict:** Clef's access control is _cryptographic_ — a service literally cannot decrypt secrets outside its scope. That's powerful. But there's no RBAC, no MFA, no per-key permissions. If you model namespaces at the right granularity (one per dependency), it works. If you need per-secret policies or MFA-gated access, Vault is purpose-built for that.

---

### 7. Backup and Recovery 💾

**Vault:** Raft snapshots, cross-cluster replication, encrypted backups, OIDC integration for recovery.

**Clef:** Every `git clone` is a full backup. Break-glass age key in a physical safe decrypts everything if KMS goes sideways. AWS KMS enforces 7-30 day deletion waiting period.

✅ **Verdict:** Git's distributed nature means backup is inherent — no strategy to design, no snapshots to schedule. Your data is replicated across every developer's checkout.

---

### 8. Automated Secrets Rotation 🔄

**Vault:** Dynamic secrets with TTL leasing. Vault changes the actual credential at the source — database passwords, cloud IAM, certificates. Auto-revoke on expiry.

**Clef:** Two different things here. _Encryption key rotation_ — automatic, every `clef pack` generates fresh ephemeral keys. _Credential rotation_ (the actual password at the source) — manual via `clef set` → PR → merge → repack. Broker-backed dynamic credentials can automate this but require deploying a handler.

🟡 **Verdict:** We're being honest — Clef doesn't auto-rotate your database password out of the box. Encryption keys rotate automatically on every build, which is great. But if you need push-button credential rotation for 30 backends today, Vault's secrets engines are production-proven.

---

### 9. Dynamic Secrets ⚡

**Vault:** First-class. Dozens of production-hardened engines — AWS, databases, PKI, SSH, LDAP. Years of battle-testing.

**Clef:** Broker SDK + registry. Templates for STS, RDS IAM, OAuth, SQL users. The architecture supports it. The ecosystem is young.

🔴 **Verdict:** We'll say it plainly — _if you need dynamic credentials today with minimal engineering, use Vault._ Our broker architecture is extensible, but you're building, not consuming. Vault's breadth here is an order of magnitude larger.

---

### 10. Integrations, APIs, and Secrets Sync 🔌

**Vault:** RESTful API for everything. One-way KV sync to external destinations. Massive plugin ecosystem.

**Clef:** Agent HTTP API on `127.0.0.1:7779`. Any language that can `GET` can read secrets. No SDK, no vendor client library. No secrets sync — the packed artifact _is_ the distribution.

🟡 **Verdict:** Clef's interface is dead simple — one HTTP endpoint, universal. But Vault's pre-built integrations (K8s sidecar injector, native Lambda integration, etc.) mean less glue code. Simplicity vs. breadth. Pick your tradeoff.

---

### 11. Automated Key Management 🔑

**Vault:** Unified API to manage key lifecycles across AWS KMS, Azure Key Vault, GCP Cloud KMS. Create, rotate, disable, delete — one interface.

**Clef:** Delegated model. Clef _uses_ KMS keys but doesn't manage their lifecycle. Key creation, rotation, and deletion happen through your cloud provider's console or IaC (Terraform, Pulumi). Ephemeral key pairs per `clef pack` eliminate long-lived runtime keys.

🟡 **Verdict:** Clef doesn't provide a key management abstraction — your cloud provider does, and you manage it with IaC like everything else. For teams already running Terraform, this adds zero operational surface. If you want one API for keys across three clouds, Vault has that.

---

### 12. Robust Auditing 📊

**Vault:** Built-in audit device. One dashboard, one query: "who accessed what, when."

**Clef:** Distributed across existing infra — CloudTrail for KMS events, git log for authorship, CI logs for packing, OTLP telemetry for agent health. JIT mode maps every secret read to a distinct CloudTrail entry.

🟡 **Verdict:** All the audit data exists — it's just in four places, not one. Correlating across them is work. Clef Pro will unify this. Today, teams that already have observability tooling (Datadog, Grafana, etc.) can wire it up, but there's no single-pane view out of the box.

---

## The TL;DR 🎯

|                        | Clef ✅                                 | Even 🟡                                                                          | Vault ✅        |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | --------------- |
| **Strong**             | Storage, Encryption, Versioning, Backup |                                                                                  |                 |
| **Different tradeoff** |                                         | Management, Scanning, Access Control, Rotation, Integrations, Key Mgmt, Auditing |                 |
| **Vault wins today**   |                                         |                                                                                  | Dynamic Secrets |

---

## The Honest Pitch 🤝

Clef is built for teams that want secrets versioned alongside code, reviewed in PRs, and delivered without a central server to babysit.

If your team lives in git, manages infra through IaC, and values operational simplicity over integration breadth — Clef removes an entire category of infrastructure from your stack. No cluster. No unsealing. No token bootstrapping. No vendor custody.

If you need a policy engine, an enterprise dashboard, or turnkey dynamic credentials for dozens of backends _today_ — Vault is purpose-built for that, and we'd rather you know upfront than find out after adoption.

We think honesty builds more trust than a checkbox grid. 🎹

---

_[Clef](https://clef.sh) is open source. Star us on [GitHub](https://github.com/clef-sh/clef), read the [whitepaper](https://clef.sh/whitepaper), or just `npx clef init` and see for yourself._
