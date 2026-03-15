# Service Identities

Service identities let serverless functions, containers, and other machine workloads consume Clef-managed secrets at runtime — without git, without the `sops` binary, and without storing private keys in build artifacts.

A service identity is a named, scoped set of per-environment age key pairs declared in `clef.yaml`. At build time, `clef bundle` generates a self-contained JS module that embeds an age-encrypted blob of the scoped secrets. At runtime, the module decrypts using the [age-encryption](https://www.npmjs.com/package/age-encryption) npm package (pure JavaScript, no native dependencies) and a private key fetched from your secret manager on demand.

## When to use service identities

Use a service identity when:

- Your workload runs in a serverless environment (Lambda, Cloud Functions, Cloud Run) with no access to `sops` or git
- You want to avoid bundling the `sops` binary in your deployment artifact
- You need namespace-scoped access control — the workload should only decrypt the namespaces it owns
- You want drift detection between the manifest and the actual recipients on encrypted files

If your workload has access to git and `sops`, you can continue using [`clef exec`](/cli/exec) or [`clef export`](/cli/export) instead.

## How it works

```
Developer machine                        Runtime (Lambda, container, etc.)
─────────────────                        ──────────────────────────────────

clef.yaml                                secrets.mjs (generated bundle)
  service_identities:                      ┌─────────────────────────────┐
    - name: api-gateway                    │ age-encrypted blob          │
      namespaces: [api]                    │ (all scoped secrets)        │
      environments:                        │                             │
        production:                        │ getSecret("DB_URL", keyFn)  │
          recipient: age1prod...           │   → age-decrypt → cache     │
                                           └─────────────────────────────┘

      clef bundle api-gateway prod               age-encryption (pure JS)
      ──────────────────────────>                 private key from Secrets
          decrypt SOPS files                      Manager / Vault / KMS
          age-encrypt to recipient
          generate JS module
```

1. **`clef service create`** generates an age key pair per environment, registers the public keys as SOPS recipients on scoped files, and prints the private keys once
2. The operator stores each private key in the environment's secret manager (e.g. AWS Secrets Manager for production, local file for dev)
3. **`clef bundle`** decrypts scoped SOPS files, age-encrypts all values as a single blob to the environment's public key, and writes a JS module
4. The generated module is deployed alongside application code (but never committed to git)
5. At runtime, the module calls `keyProvider()` once on first access, decrypts the blob, and caches all values in memory

## Manifest schema

```yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Pre-production
  - name: production
    description: Production
    protected: true

namespaces:
  - name: api
    description: API secrets
  - name: database
    description: Database credentials

sops:
  default_backend: age

file_pattern: "{namespace}/{environment}.enc.yaml"

service_identities:
  - name: api-gateway
    description: "API gateway service"
    namespaces: [api]
    environments:
      dev:
        recipient: age1dev...
      staging:
        recipient: age1stg...
      production:
        recipient: age1prd...
```

### Rules

- `service_identities` is optional — existing manifests without it continue to work unchanged
- Each identity must cover **all** declared environments
- Namespace scope must reference existing namespaces
- The `recipient` is an age public key — the private key's storage is the deployer's concern
- Identity names must be unique

## Creating a service identity

```bash
clef service create api-gateway \
  --namespaces api \
  --description "API gateway service"
```

This generates an age key pair per environment, updates `clef.yaml`, registers the public keys as SOPS recipients on the scoped files, and prints the private keys to stdout once:

```
✓  Service identity 'api-gateway' created.

  Namespaces: api
  Environments: dev, staging, production

⚠  Private keys are shown ONCE. Store them securely (e.g. AWS Secrets Manager, Vault).

  dev:
    AGE-SECRET-KEY-1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L...

  staging:
    AGE-SECRET-KEY-1X8GF2TVDW0S3JN54KHCE6MUA7LQPZRY9...

  production:
    AGE-SECRET-KEY-1GF2TVDW0S3JN54KHCE6MUA7LQPZRY9X8...

→  git add clef.yaml && git commit -m "feat: add service identity 'api-gateway'"
```

::: warning Store private keys immediately
Private keys are printed once and never stored by Clef. Copy each key to the appropriate secret manager before closing the terminal. If you lose a key, use `clef service rotate` to generate a replacement.
:::

Commit the updated manifest after creating the identity:

```bash
git add clef.yaml && git add -A && git commit -m "feat: add service identity 'api-gateway'"
```

### Multi-namespace identities

A service that needs secrets from multiple namespaces:

```bash
clef service create backend-api \
  --namespaces api,database \
  --description "Backend API server"
```

When a multi-namespace identity is bundled, keys are prefixed with the namespace to avoid collisions:

```javascript
await getSecret("api/STRIPE_KEY", keyProvider);
await getSecret("database/DB_HOST", keyProvider);
```

Single-namespace identities use bare keys:

```javascript
await getSecret("STRIPE_KEY", keyProvider);
```

## Managing service identities

### Listing identities

```bash
clef service list
```

```
Name          Namespaces    Environments
────────────  ────────────  ────────────────────────────────────
api-gateway   api           dev: age1…jn54khce, staging: age1…y9x8gf2t, production: age1…w0s3jn5
```

### Showing details

```bash
clef service show api-gateway
```

### Rotating keys

Generate new age keys for a service identity. The old keys are removed from SOPS recipients and new ones are added:

```bash
# Rotate all environments
clef service rotate api-gateway

# Rotate a specific environment
clef service rotate api-gateway --environment production
```

New private keys are printed to stdout — store them in your secret manager and update the runtime configuration. Re-generate bundles after rotation.

## Generating bundles

```bash
clef bundle api-gateway production \
  --output ./dist/secrets.mjs \
  --format esm
```

The `bundle` command:

1. Decrypts all SOPS files scoped to the identity's namespaces for the specified environment
2. Age-encrypts the merged values as a single blob to the identity's public key for that environment
3. Generates a JS module that embeds the ciphertext and exports `getSecret()`, `getAllSecrets()`, and `KEYS`

### Output formats

| Flag           | Extension | Use case                                                  |
| -------------- | --------- | --------------------------------------------------------- |
| `--format esm` | `.mjs`    | ES modules (default). Lambda with ESM, Vite, modern Node. |
| `--format cjs` | `.cjs`    | CommonJS. Older Node, webpack, require().                 |

::: warning Do not commit bundles
The generated file contains encrypted secrets. Add the output path to `.gitignore`. Generate bundles in CI and include them in the deployment artifact.
:::

## Generated module API

```typescript
// secrets.mjs (generated by clef bundle — do not edit)

// Introspect available keys without decryption
export const KEYS: readonly string[];

// Decrypt a single key. keyProvider is called once per cold start.
export async function getSecret(key: string, keyProvider: () => Promise<string>): Promise<string>;

// Decrypt all keys at once.
export async function getAllSecrets(
  keyProvider: () => Promise<string>,
): Promise<Record<string, string>>;
```

### Key provider

The `keyProvider` function is called **once** on the first `getSecret()` or `getAllSecrets()` call. It should return the age private key as a string. The runtime caches the decrypted values (not the private key) — subsequent calls are O(1) map lookups.

Concurrent cold-start calls are deduplicated: if multiple requests hit `getSecret()` before decryption completes, only one decrypt operation runs.

## AWS Lambda walkthrough

This is a complete, production-ready example of using Clef service identities with AWS Lambda.

### 1. Prerequisites

- A Clef repository with an `api` namespace and `production` environment
- An AWS account with Secrets Manager and Lambda access
- Node.js 22+ runtime for Lambda

### 2. Create the service identity

```bash
clef service create api-lambda \
  --namespaces api \
  --description "Production API Lambda"
```

Copy the `production` private key from the output.

### 3. Store the private key in AWS Secrets Manager

```bash
aws secretsmanager create-secret \
  --name clef/api-lambda/production \
  --secret-string "AGE-SECRET-KEY-1..." \
  --description "Clef service identity private key for api-lambda"
```

Grant your Lambda execution role permission to read this secret:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:clef/api-lambda/production-*"
    }
  ]
}
```

### 4. Generate the bundle in CI

Add a build step to your CI pipeline that generates the bundle and includes it in the deployment artifact:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Generate secrets bundle
        env:
          CLEF_AGE_KEY: ${{ secrets.CLEF_DEPLOY_KEY }}
        run: |
          npx @clef-sh/cli bundle api-lambda production \
            --output ./dist/secrets.mjs \
            --format esm

      - name: Deploy to Lambda
        run: |
          cd dist
          zip -r function.zip index.mjs secrets.mjs node_modules/
          aws lambda update-function-code \
            --function-name api-handler \
            --zip-file fileb://function.zip
```

::: info Why does the CI runner need a deploy key?
The `clef bundle` command must decrypt SOPS files to re-encrypt them for the service identity. The CI runner needs a key that can decrypt the `api` namespace in the `production` environment — this is the same `CLEF_AGE_KEY` you would use for `clef exec`. The service identity's own private key is not used during bundle generation.
:::

### 5. Write the Lambda handler

```javascript
// index.mjs
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { getSecret, getAllSecrets } from "./secrets.mjs";

const smClient = new SecretsManagerClient({});

// Key provider — called once per cold start
async function keyProvider() {
  const cmd = new GetSecretValueCommand({
    SecretId: "clef/api-lambda/production",
  });
  const response = await smClient.send(cmd);
  return response.SecretString;
}

export async function handler(event) {
  // First call decrypts the bundle (~5-15ms for 50 keys)
  // Subsequent calls are cached O(1) lookups
  const dbUrl = await getSecret("DATABASE_URL", keyProvider);
  const apiKey = await getSecret("STRIPE_KEY", keyProvider);

  // Use the secrets...
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
}
```

### 6. Install the runtime dependency

The generated module dynamically imports `age-encryption` at runtime. Include it in your Lambda's `node_modules`:

```bash
npm install age-encryption
```

This is a pure JavaScript package with no native dependencies — it works on any Lambda runtime without layers or custom builds.

### Performance characteristics

| Metric                  | Value                                 |
| ----------------------- | ------------------------------------- |
| First call (cold start) | ~5-15ms for 50 keys (one age decrypt) |
| Subsequent calls        | <0.01ms (in-memory map lookup)        |
| Bundle size overhead    | ~200 bytes per key + age envelope     |
| Runtime dependency      | `age-encryption` only (~50 KB)        |

The entire secrets blob is decrypted on first access and cached for the lifetime of the Lambda execution context. There is no per-key decrypt overhead after initialization.

## Key providers for other platforms

### Google Cloud — Secret Manager

```javascript
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

async function keyProvider() {
  const [version] = await client.accessSecretVersion({
    name: "projects/my-project/secrets/clef-api-lambda-production/versions/latest",
  });
  return version.payload.data.toString("utf8");
}
```

### Azure — Key Vault

```javascript
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

const client = new SecretClient("https://my-vault.vault.azure.net", new DefaultAzureCredential());

async function keyProvider() {
  const secret = await client.getSecret("clef-api-lambda-production");
  return secret.value;
}
```

### Local development — file or env var

```javascript
import { readFile } from "node:fs/promises";

async function keyProvider() {
  // From environment variable
  if (process.env.CLEF_SERVICE_KEY) {
    return process.env.CLEF_SERVICE_KEY;
  }
  // From a local key file (gitignored)
  return readFile(".clef/service-keys/api-lambda-dev.key", "utf8");
}
```

## Drift detection

`clef lint` automatically checks service identity configurations when `service_identities` is present in the manifest:

| Rule                       | Severity | Trigger                                                         |
| -------------------------- | -------- | --------------------------------------------------------------- |
| `missing_environment`      | error    | Identity does not cover all declared environments               |
| `namespace_not_found`      | error    | Identity references a non-existent namespace                    |
| `recipient_not_registered` | warning  | Identity's public key is not in a scoped SOPS file's recipients |
| `scope_mismatch`           | warning  | Identity's key found as recipient outside its namespace scope   |

These rules help catch configuration drift after manifest changes, team member rotations, or manual edits to encrypted files.

## Security model

### What the bundle contains

The generated JS module contains:

- **Age-encrypted ciphertext** — the secrets blob encrypted to the service identity's public key. Cannot be decrypted without the corresponding private key.
- **Key names in plaintext** — the `KEYS` array lists available secret names for introspection. Key names are not considered secret data.
- **No private keys** — the private key is never embedded in the bundle. It is fetched at runtime from the secret manager.

### Trust boundaries

| Component              | Contains secrets?                              | Needs git? | Needs sops? |
| ---------------------- | ---------------------------------------------- | ---------- | ----------- |
| Developer machine      | Plaintext (in memory via sops)                 | Yes        | Yes         |
| CI runner              | Plaintext (in memory during bundle generation) | Yes        | Yes         |
| Generated bundle       | Ciphertext only                                | No         | No          |
| Runtime (Lambda, etc.) | Plaintext (in memory after decrypt)            | No         | No          |
| Secret manager         | Private key only                               | No         | No          |

### No custom crypto

The runtime decryption uses [age-encryption](https://www.npmjs.com/package/age-encryption), a JavaScript implementation of the [age specification](https://age-encryption.org). Clef does not implement any cryptographic primitives — all encryption and decryption is delegated to established libraries.

## See also

- [`clef service`](/cli/service) — CLI reference for service identity commands
- [`clef bundle`](/cli/bundle) — CLI reference for the bundle command
- [Team Setup](/guide/team-setup) — adding human recipients
- [CI/CD Integration](/guide/ci-cd) — using `clef exec` in CI pipelines
- [Manifest Reference](/guide/manifest) — full manifest field reference
