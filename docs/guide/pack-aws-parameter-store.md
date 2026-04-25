# AWS Parameter Store Backend

`@clef-sh/pack-aws-parameter-store` is the official Clef pack backend for [AWS SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html). It writes one `SecureString` parameter per Clef key under a prefix you choose, encrypted with the SSM-default KMS key (`alias/aws/ssm`) or a key you specify.

## Install

```bash
npm install --save-dev @clef-sh/pack-aws-parameter-store
```

The package brings its own `@aws-sdk/client-ssm` dependency. `@clef-sh/core` is a peer dependency — Clef's CLI provides it.

## Quick start

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-parameter-store \
    --backend-opt prefix=/myapp/production
```

Auth uses the standard AWS SDK [credential resolution chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html): environment variables, shared profile, IAM Roles for Service Accounts (IRSA), instance metadata, and SSO. There are no Clef-specific auth options.

## Options

All options are passed via repeatable `--backend-opt key=value` flags.

| Key          | Required | Default                           | Notes                                                                                                                                                  |
| ------------ | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prefix`     | yes      | —                                 | SSM hierarchy root, e.g. `/myapp/prod`. Must start with `/`. A trailing slash is normalized away.                                                      |
| `region`     | no       | AWS SDK default                   | Override the AWS region used for this invocation.                                                                                                      |
| `kms-key-id` | no       | account default (`alias/aws/ssm`) | KMS key id, alias, or ARN to wrap the SecureString DEK.                                                                                                |
| `prune`      | no       | `false`                           | When `true`, delete parameters under `prefix` that are not in the current cell. Off by default to avoid surprise deletes.                              |
| `tier`       | no       | `Standard`                        | `Standard` (4 KiB max) or `Advanced` (8 KiB, more parameters per account).                                                                             |
| `tag-prefix` | no       | `clef:`                           | Tag key namespace. Each parameter gets `<prefix>identity`, `<prefix>environment`, `<prefix>revision`. Override for orgs that disallow `:` in tag keys. |

## What gets written

For an identity/environment cell with keys `DB_PASSWORD` and `API_KEY` packed under `--backend-opt prefix=/myapp/prod`:

| Clef key      | SSM parameter name        | Type           |
| ------------- | ------------------------- | -------------- |
| `DB_PASSWORD` | `/myapp/prod/DB_PASSWORD` | `SecureString` |
| `API_KEY`     | `/myapp/prod/API_KEY`     | `SecureString` |

Each parameter is tagged with the configured tag prefix:

```
clef:identity      = api-gateway
clef:environment   = production
clef:revision      = <unix-epoch-ms>
```

Tags are applied via `AddTagsToResource` after `PutParameter`, because SSM rejects `Tags` when `Overwrite: true` is set on `PutParameter`.

Pruning (when enabled) deletes parameters present at the prefix but absent from the current cell, after writes succeed — a partial write failure cannot orphan-delete healthy parameters.

## IAM policy

A minimal IAM policy for the principal running `clef pack`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:PutParameter", "ssm:AddTagsToResource"],
      "Resource": "arn:aws:ssm:<region>:<account-id>:parameter/myapp/prod/*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath", "ssm:DeleteParameter"],
      "Resource": "arn:aws:ssm:<region>:<account-id>:parameter/myapp/prod/*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "<kms-key-arn>"
    }
  ]
}
```

`ssm:GetParametersByPath` and `ssm:DeleteParameter` are only required when `--backend-opt prune=true`.

## Limits and caveats

- **Standard tier limit is 4 KiB per value.** The backend rejects oversized values with an actionable error pointing at `--backend-opt tier=Advanced`. Advanced tier raises the limit to 8 KiB.
- **No native TTL.** SSM Parameter Store does not support TTLs natively. The backend ignores `--ttl`. Rotate secrets through a re-pack rather than relying on parameter expiry.
- **Last-writer-wins.** Concurrent packs against the same prefix overwrite each other. Coordinate writes through CI rather than relying on locking.
- **One parameter per key.** This preserves SSM's per-key IAM and per-key audit semantics. Bundling all keys into a single JSON parameter would defeat that.

## Example: full invocation with all options

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-parameter-store \
    --backend-opt prefix=/myapp/production \
    --backend-opt kms-key-id=alias/myapp-secrets \
    --backend-opt tier=Advanced \
    --backend-opt prune=true \
    --backend-opt tag-prefix=myco-
```

## Reading values back

This is a pack-only integration. Clef does not consume secrets from Parameter Store — your application reads the parameters directly via the AWS SDK or `aws ssm get-parameters-by-path`.

## See also

- [Pack Backend Plugins](./pack-plugins.md) — write your own backend.
- Source: [`packages/pack-aws-parameter-store`](https://github.com/clef-sh/clef/tree/main/packages/pack-aws-parameter-store)
