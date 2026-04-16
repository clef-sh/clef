---
title: The Tradeoff Every Secrets Manager Forces on You (And Why It's the Server's Fault)
published: false
description: Secrets managers make you choose between operating a cluster yourself or handing plaintext to a vendor. The thing forcing that choice is the central server. Here's an honest look at why, and what a git-native architecture changes.
tags: security, devops, secrets, architecture
cover_image:
---

Pick any secrets manager and you're picking one of two tradeoffs:

1. **Self-hosted (Vault, Infisical):** you keep custody of your plaintext, but you also operate a stateful cluster — HA storage, unseal keys, PostgreSQL, Redis, backups, upgrades.
2. **SaaS (Doppler, AWS Secrets Manager, 1Password):** someone else operates the cluster, but your plaintext sits in their system under their decryption keys.

Ops or custody. Pick one.

This post is about the thing that forces the choice: **the central server itself**. I work on [Clef](https://clef.sh), a git-native secrets tool, so I have a horse in this race. I'll try to be upfront about where the tradeoff actually moves and where it just changes shape.

## Why the server creates the dilemma

A central secrets server has to authenticate callers. That means something, somewhere, needs to hold a credential to talk to it — the classic "secret zero" problem. That credential ends up in one of three places: baked into container images, pasted into CI, or stored in _another_ secrets manager. Each is a custody problem in miniature.

Cloud secret managers and Vault both have good answers — OIDC federation, IAM auth, AppRole, Kubernetes auth. The answers work. But they exist because the server model demands them. Every answer is configuration you have to get right, and every piece of configuration is a surface the server can be compromised through.

And once a server is holding plaintext (or the keys to plaintext) for many tenants or many services, it becomes the highest-value target in your infrastructure. A breach is not one secret — it's all of them.

## What git-native changes

Clef's bet is that you don't need a server at all. The architecture has two pieces:

- **At rest:** SOPS-encrypted files in your git repo. Keys visible, values encrypted. Code review, diffs, and drift detection work on the encrypted files directly because the key names are plaintext.
- **At runtime:** a lightweight agent (or Lambda extension) pulls a signed, pre-encrypted artifact from S3 or your VCS and decrypts it in memory using the workload's IAM role.

No secrets server. No bootstrap token. The workload's existing IAM identity _is_ the authentication. KMS is the key management. Clef is just the envelope and the delivery path.

The [whitepaper](https://github.com/clef-sh/clef/blob/main/whitepaper.md) walks through this in detail, including the hardened topology (three separate KMS keys: one for source encryption, one for artifact wrapping, one for signing) and how just-in-time decryption lets IAM revocation become an instant kill switch.

## The tradeoffs I won't hand-wave

Moving off a server doesn't make tradeoffs disappear. It moves them:

- **Your repo becomes an access control layer.** Read access to the repo reveals namespace names, environment topology, and recipient fingerprints — a reconnaissance map, even without decryption keys. VCS providers weren't designed for that role. If that's unacceptable for your threat model, a private secrets repo with restricted access is the right call, and you lose some of the "secrets and code versioned together" benefit.
- **Git's limits are real.** Repo size grows. Branch-heavy workflows multiply encrypted variants. VCS outages affect CI even if they don't affect running agents (hosted-artifact mode keeps runtime on a separate availability plane).
- **Clef is not the right answer for everyone.** If you're a small team on a PaaS with five secrets, use Doppler. If you're deep in AWS and want managed rotation, AWS Secrets Manager is genuinely good. If you need Vault's dynamic credential engines today, use Vault. The whitepaper's Section 1.1 says this in more words.

## What we think we do get right

For teams that already live in git, want review workflows on secret changes, and want zero static credentials in production, removing the server is a real architectural win — not a marketing one. No cluster to operate. No vendor holding your plaintext. No bootstrap token hiding in CI. The custody-vs-ops dilemma doesn't get traded; it gets dissolved, because the thing creating it is gone.

We're not claiming magic. We're claiming the server was the problem, and a different architecture — one built on primitives every team already has (git, IAM, KMS) — doesn't need one.

If you want the long version with the full threat model, the artifact signing design, and the KMS-native envelope flow, the [whitepaper](https://github.com/clef-sh/clef/blob/main/whitepaper.md) is the honest read. It calls out the places Clef is weaker as clearly as the places it's stronger. That's the only way this kind of decision should get made.
