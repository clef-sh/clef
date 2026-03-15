# clef bundle

Generate a runtime JS module with encrypted secrets for a service identity.

## Synopsis

```bash
clef bundle <identity> <environment> -o <path> [--format esm|cjs]
```

## Description

`clef bundle` creates a self-contained JavaScript module that your serverless function or container can use to access secrets at runtime — without git, without the `sops` binary, and without storing private keys in the deployment artifact.

The command decrypts scoped SOPS files, age-encrypts all values as a single blob to the service identity's per-environment public key, and writes a JS module that uses [age-encryption](https://www.npmjs.com/package/age-encryption) (pure JavaScript) to decrypt on demand.

See [Service Identities](/guide/service-identities) for the full guide, including an AWS Lambda walkthrough.

## Arguments

| Argument        | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `<identity>`    | Name of the service identity (must exist in `clef.yaml` under `service_identities`) |
| `<environment>` | Target environment (must be defined on the identity, e.g. `production`, `staging`)  |

## Flags

| Flag                  | Type   | Required | Default | Description                               |
| --------------------- | ------ | -------- | ------- | ----------------------------------------- |
| `-o, --output <path>` | string | Yes      | —       | Output file path for the generated module |
| `--format <format>`   | string | No       | `esm`   | Module format: `esm` or `cjs`             |
| `--dir <path>`        | string | No       | cwd     | Override repository root                  |

## Generated module API

The generated module exports three members:

```typescript
// Introspect available keys without decryption
export const KEYS: readonly string[];

// Decrypt a single key
export async function getSecret(key: string, keyProvider: () => Promise<string>): Promise<string>;

// Decrypt all keys at once
export async function getAllSecrets(
  keyProvider: () => Promise<string>,
): Promise<Record<string, string>>;

// Clear the decrypted secrets cache. Call after key rotation to force
// a fresh decrypt on the next getSecret()/getAllSecrets() call.
export function clearCache(): void;
```

### Key provider

The `keyProvider` function is called **once** per cold start. It should return the age private key as a string. The runtime caches decrypted values — subsequent calls are O(1) map lookups.

```javascript
// AWS Secrets Manager example
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

async function keyProvider() {
  const cmd = new GetSecretValueCommand({ SecretId: "clef/api-lambda/production" });
  const res = await sm.send(cmd);
  return res.SecretString;
}
```

### Namespace-prefixed keys

For multi-namespace service identities, keys are prefixed with the namespace:

```javascript
// Single namespace: bare keys
await getSecret("DATABASE_URL", keyProvider);

// Multi namespace: prefixed keys
await getSecret("api/STRIPE_KEY", keyProvider);
await getSecret("database/DATABASE_URL", keyProvider);
```

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | Bundle generated successfully                                |
| 1    | Generation failed (decryption error, missing identity, etc.) |
| 2    | Invalid input (bad format flag)                              |

## Examples

### Generate an ESM bundle

```bash
clef bundle api-gateway production \
  --output ./dist/secrets.mjs \
  --format esm
```

### Generate a CJS bundle

```bash
clef bundle api-gateway production \
  --output ./dist/secrets.cjs \
  --format cjs
```

### Generate in CI

```yaml
# GitHub Actions
- name: Generate secrets bundle
  env:
    CLEF_AGE_KEY: ${{ secrets.CLEF_DEPLOY_KEY }}
  run: |
    npx @clef-sh/cli bundle api-gateway production \
      --output ./dist/secrets.mjs
```

::: warning Do not commit bundles
The generated file contains encrypted secrets. Add the output path to `.gitignore`. Generate bundles in CI and include them in the deployment artifact only.
:::

::: info CI requires a deploy key
`clef bundle` decrypts SOPS files before re-encrypting for the service identity. The CI runner needs a key that can decrypt the scoped namespaces — the same `CLEF_AGE_KEY` used with `clef exec`. The service identity's own private key is not used during generation.
:::

## Related commands

- [`clef service`](service.md) — manage service identities
- [`clef exec`](exec.md) — run a command with secrets injected (alternative to bundles)
- [`clef export`](export.md) — print secrets as shell export statements
