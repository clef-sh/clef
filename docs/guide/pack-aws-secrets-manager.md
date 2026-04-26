# AWS Secrets Manager Backend

`@clef-sh/pack-aws-secrets-manager` is the official Clef pack backend for [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html). It writes the keys for a `(service identity, environment)` cell to ASM in either of two shapes:

- **JSON bundle (default)** — every key for the cell goes into a single ASM secret as a sorted JSON object. The canonical ASM idiom; cheaper at scale ($0.40/secret/month: N keys = 1 secret) and the shape RDS Proxy, the Lambda Secrets Manager extension, and most app SDKs expect.
- **Single mode** — one ASM secret per Clef key. Use this when you need per-key IAM, per-key audit, or a shape your existing consumers expect.

## Install

```bash
npm install --save-dev @clef-sh/pack-aws-secrets-manager
```

`@clef-sh/core` is a peer dependency — Clef's CLI provides it.

## Quick start

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-secrets-manager \
    --backend-opt prefix=myapp/production
```

That's the JSON-mode invocation: one secret named `myapp/production` with all keys serialized as a JSON object.

Auth uses the standard AWS SDK [credential resolution chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html): environment variables, shared profile, IAM Roles for Service Accounts (IRSA), instance metadata, and SSO. There are no Clef-specific auth options.

## Options

All options are passed via repeatable `--backend-opt key=value` flags.

| Key             | Required | Default                                | Notes                                                                                                                                                              |
| --------------- | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prefix`        | yes      | —                                      | JSON mode: full secret name. Single mode: name root, suffixed with `/<key>` per key. Must match `[A-Za-z0-9/_+=.@!-]+`.                                            |
| `mode`          | no       | `json`                                 | `json` or `single`.                                                                                                                                                |
| `region`        | no       | AWS SDK default                        | Override the AWS region used for this invocation.                                                                                                                  |
| `kms-key-id`    | no       | account default (`aws/secretsmanager`) | KMS key id, alias, or ARN. **Applied on `CreateSecret` only** — see Limits.                                                                                        |
| `prune`         | no       | `false`                                | Single-mode only. When `true`, soft-delete secrets under `prefix` that aren't in the current cell. JSON mode rejects `prune=true` (one secret can't have orphans). |
| `recovery-days` | no       | `30`                                   | Integer 7–30. Soft-delete recovery window passed to `DeleteSecret` when pruning.                                                                                   |
| `tag-prefix`    | no       | `clef:`                                | Each secret is tagged `<prefix>identity`, `<prefix>environment`, `<prefix>revision`. Override for orgs that disallow `:` in tag keys.                              |

## What gets written

### JSON mode

For an identity/environment cell with keys `DB_PASSWORD`, `API_KEY`, `STRIPE_SECRET` packed under `--backend-opt prefix=myapp/production`:

```
SecretId: myapp/production
SecretString:
{
  "API_KEY": "sk_live_...",
  "DB_PASSWORD": "...",
  "STRIPE_SECRET": "sk_live_..."
}
```

Keys are sorted alphabetically before serialization so ASM's secret history shows minimal, stable diffs across packs.

### Single mode

The same cell with `--backend-opt mode=single --backend-opt prefix=myapp/production`:

| Clef key        | ASM secret name                  |
| --------------- | -------------------------------- |
| `DB_PASSWORD`   | `myapp/production/DB_PASSWORD`   |
| `API_KEY`       | `myapp/production/API_KEY`       |
| `STRIPE_SECRET` | `myapp/production/STRIPE_SECRET` |

Each secret holds its own value as a plain `SecretString`.

### Tags (both modes)

```
clef:identity      = api-gateway
clef:environment   = production
clef:revision      = <unix-epoch-ms>
```

Tags are inlined on `CreateSecret` for first-time writes (one API call) and refreshed via `TagResource` on subsequent updates (since `PutSecretValue` doesn't accept `Tags`). This is the same split the SSM Parameter Store backend uses — `revision` ticks every pack so you can see when a secret was last touched.

### Pruning (single mode only)

With `--backend-opt prune=true`, after writes succeed the backend lists secrets matching `prefix/` via `ListSecretsCommand` and soft-deletes any that aren't in the current cell. The default 30-day recovery window matches ASM's default — restorable via `aws secretsmanager restore-secret`. Pruning runs **after** all writes complete, so a partial write failure can't orphan-delete healthy secrets.

## IAM policy

A minimal IAM policy for the principal running `clef pack`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:TagResource"
      ],
      "Resource": "arn:aws:secretsmanager:<region>:<account-id>:secret:myapp/production*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:ListSecrets", "secretsmanager:DeleteSecret"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "<kms-key-arn>"
    }
  ]
}
```

`secretsmanager:ListSecrets` requires `Resource: "*"` (it's an account-wide list operation). `DeleteSecret` is only required when `--backend-opt prune=true`.

## Limits and caveats

- **64 KiB per secret value.** ASM caps both `SecretString` and `SecretBinary` at 65,536 bytes. JSON mode validates the serialized payload; single mode validates each value. Oversized inputs reject with an actionable hint pointing at the alternative mode or namespace splitting.
- **No CMK rotation on existing secrets.** `kms-key-id` only takes effect on `CreateSecret`. To re-key an existing secret, delete and recreate it deliberately — Clef won't auto-`UpdateSecret` to swap CMKs, since that's a destructive operation that should be intentional.
- **No cross-region replication in v0.1.0.** A future release will expose `--backend-opt replicate-to=us-west-2,eu-west-1`. For now, replicate manually via the AWS console or CLI after first pack.
- **No native TTL.** ASM doesn't support TTLs; `--ttl` is ignored.
- **JSON-mode + `prune=true` is rejected.** A JSON-bundle cell is a single secret with no orphans to delete; the option only makes sense in single mode.
- **Last-writer-wins.** Concurrent packs against the same prefix overwrite each other. Coordinate writes through CI rather than relying on locking.

## Example: full invocation with all options

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-secrets-manager \
    --backend-opt prefix=myapp/production \
    --backend-opt mode=single \
    --backend-opt kms-key-id=alias/myapp-secrets \
    --backend-opt prune=true \
    --backend-opt recovery-days=14 \
    --backend-opt tag-prefix=myco-
```

## Reading values back

This is a pack-only integration. Clef does not consume secrets from ASM — your application reads them directly via the AWS SDK or CLI:

```bash
# JSON mode
aws secretsmanager get-secret-value --secret-id myapp/production \
  | jq -r '.SecretString | fromjson | .DB_PASSWORD'

# Single mode
aws secretsmanager get-secret-value --secret-id myapp/production/DB_PASSWORD \
  | jq -r '.SecretString'
```

## See also

- [Pack Backend Plugins](./pack-plugins.md) — write your own backend.
- [AWS Parameter Store Backend](./pack-aws-parameter-store.md) — sister plugin for SSM.
- Source: [`packages/pack/aws-secrets-manager`](https://github.com/clef-sh/clef/tree/main/packages/pack/aws-secrets-manager)
