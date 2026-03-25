# @clef-sh/runtime

Lightweight runtime secrets engine for [Clef](https://clef.sh). Fetches packed artifacts from VCS APIs, HTTP endpoints, or local files, decrypts with age (or KMS envelope encryption), and serves secrets from an in-memory cache.

Designed for production deployment with minimal dependencies. No SOPS binary, no git dependency, no plaintext on disk.

## Install

```bash
npm install @clef-sh/runtime
```

## Usage

```typescript
import { ClefRuntime } from "@clef-sh/runtime";

const runtime = new ClefRuntime({
  source: "https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json",
  // KMS envelope artifacts need no age key — the runtime calls kms:Decrypt
  // For age-only artifacts:
  // ageKey: "AGE-SECRET-KEY-1...",
});

await runtime.start();
runtime.startPolling();

// Read secrets
const dbUrl = runtime.get("DB_URL");
const all = runtime.getAll();
```

## Features

- **VCS providers**: GitHub, GitLab, Bitbucket — fetch artifacts directly from git repos
- **HTTP/file sources**: Fetch from S3, CDN, or local file paths
- **KMS envelope encryption**: AWS KMS, GCP Cloud KMS, Azure Key Vault — no static age key needed
- **Adaptive polling**: Refreshes at 80% of artifact TTL, content-hash short-circuit skips unnecessary decryption
- **Resilient caching**: In-memory primary cache with optional encrypted disk fallback
- **Revocation**: Detects `revokedAt` field and wipes cache immediately

## KMS Providers

KMS SDKs are optional dependencies — install only the one you need:

```bash
# AWS KMS
npm install @aws-sdk/client-kms

# GCP Cloud KMS
npm install @google-cloud/kms

# Azure Key Vault
npm install @azure/identity @azure/keyvault-keys
```

## Documentation

- [Runtime Agent guide](https://docs.clef.sh/guide/agent)
- [Dynamic Secrets guide](https://docs.clef.sh/guide/dynamic-secrets)
- [API reference](https://docs.clef.sh/api/)

## License

MIT
