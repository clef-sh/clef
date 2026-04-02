---
title: I Was Tired of Paying $0.40/Secret/Month, So I Open-Sourced My Way Out
published: true
description: AWS Secrets Manager costs more than my entire side project. So I built a free alternative that stores encrypted secrets in git.
tags: aws, security, opensource, devops
cover_image:
---

Last month I looked at my AWS bill for a side project — a static site on S3 and a Lambda function that maybe 3 people use, including me.

**The most expensive line item was secrets management.**

AWS Secrets Manager charges $0.40 per secret per month, plus $0.05 per 10,000 API calls. I had 12 secrets across two environments. That's $4.80/month just to _store_ a Stripe key and a database URL — for a project that costs $1.20/month in compute.

## The Alternatives All Suck

- **SSM Parameter Store** — free tier exists, but no encryption at rest for SecureString without KMS ($1/month/key), no rotation, no structure.
- **Hardcoded env vars** — works until you need to rotate something, or onboard a teammate, or remember what staging is actually pointing at.
- **`.env` files in a private repo** — congratulations, your secrets are now in plaintext in git history forever.
- **HashiCorp Vault** — I need a _server_ to store 12 key-value pairs?

## What I Actually Wanted

1. Secrets stored alongside my code (one source of truth)
2. Encrypted at rest (not plaintext in git)
3. History of every change (who changed what, when)
4. Works across environments (dev, staging, production)
5. **Free**

## So I Built Clef

[Clef](https://github.com/clef-sh/clef) is a CLI that manages encrypted secrets in your git repo using [Mozilla SOPS](https://github.com/getsops/sops) and [age encryption](https://age-encryption.org).

Setup takes about 2 minutes:

```bash
npm i -g @clef-sh/cli
clef init --namespaces api --non-interactive
```

This generates an age key (modern, simple encryption — no GPG), creates a `clef.yaml` manifest, and scaffolds encrypted files for each namespace × environment.

Setting a secret:

```bash
clef set api/production STRIPE_KEY sk_live_abc123
```

The value is encrypted immediately. The file in git looks like:

```yaml
STRIPE_KEY: ENC[AES256_GCM,data:7a3b9c...,type:str]
```

Key names visible (great for diffs and code review), values encrypted. Getting it back:

```bash
clef get api/production STRIPE_KEY
# sk_live_abc123
```

Injecting into a process:

```bash
clef exec api/production -- node server.js
# STRIPE_KEY is now in process.env
```

## What It Replaced

|                    | AWS Secrets Manager            | Clef                          |
| ------------------ | ------------------------------ | ----------------------------- |
| **Cost**           | $0.40/secret/month + API calls | Free                          |
| **Storage**        | AWS managed                    | Your git repo                 |
| **History**        | CloudTrail (extra cost)        | `git log`                     |
| **Access control** | IAM policies                   | Age keys                      |
| **Infrastructure** | AWS account required           | None                          |
| **Offline access** | No                             | Yes                           |
| **Vendor lock-in** | Yes                            | No (it's just encrypted YAML) |

## The Tradeoffs (Being Honest)

Clef isn't a Vault replacement. It's for a different use case:

- **No runtime secret injection** — you decrypt at build time or via `clef exec`. There's no API your app calls at runtime (though there is an [agent sidecar](https://github.com/clef-sh/clef/tree/main/packages/agent) if you want that).
- **No automatic rotation** — you rotate by running `clef set` with a new value and pushing. No Lambda rotation functions.
- **Trust model is simpler** — if someone has the age key, they can decrypt everything they're a recipient on. There's no per-secret ACL. For a solo dev or small team, this is fine. For a 200-person org, use KMS.

## Who This Is For

- Side projects where secrets management costs more than the project itself
- Small teams (2-5 people) tired of sharing `.env` files over Slack
- Anyone who wants secrets versioned in git with real encryption, not base64 encoding
- Developers who don't want to run infrastructure just to store 10 key-value pairs

## Who This Is Not For

- Large orgs that need centralized access control and audit
- Teams that need runtime secret rotation without redeployment
- Anyone already happy with their current setup (seriously, don't switch for the sake of it)

---

The repo is at [github.com/clef-sh/clef](https://github.com/clef-sh/clef). It's MIT licensed. Stars appreciated but not required.

If you've ever looked at your AWS bill and wondered why storing a database password costs more than running the database, give it a try.
