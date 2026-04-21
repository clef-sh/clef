# ClefAwsSecretsManager

Delivers a Clef-packed envelope to AWS Secrets Manager as a JSON secret.
Consumers read via the native AWS SDK, ECS secret injection, or the
Secrets Manager Lambda Extension — no Clef agent, no app-code changes.

**KMS-envelope identities only.** Age identities are rejected at synth
with a pointer to the `clef.yaml` fix.

## Synopsis

```ts
import { ClefAwsSecretsManager } from "@clef-sh/cdk";

const secrets = new ClefAwsSecretsManager(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
});

secrets.grantRead(apiLambda);
```

## Props

| Prop          | Type                     | Required | Description                                                                                                                                                                                         |
| ------------- | ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`    | `string`                 | yes      | Service identity name from `clef.yaml`. Must use KMS-envelope encryption.                                                                                                                           |
| `environment` | `string`                 | yes      | Target environment (e.g. `"production"`).                                                                                                                                                           |
| `manifest`    | `string`                 | no       | Absolute or cwd-relative path to `clef.yaml`. Default: walk-up discovery.                                                                                                                           |
| `shape`       | `Record<string, string>` | no       | Target JSON shape for the ASM secret. Keys are your app's field names; values are literal strings or `${CLEF_KEY}` references. When omitted, the ASM secret stores the decrypted envelope JSON 1:1. |
| `secretName`  | `string`                 | no       | Explicit ASM secret name. Default: `clef/<identity>/<environment>`.                                                                                                                                 |

## Attributes

| Attribute      | Type      | Description                                     |
| -------------- | --------- | ----------------------------------------------- |
| `secret`       | `ISecret` | The managed ASM secret.                         |
| `envelopeKey`  | `IKey`    | Imported KMS key that wraps the envelope's DEK. |
| `manifestPath` | `string`  | Absolute path to the resolved `clef.yaml`.      |

## Methods

### `grantRead(grantable)`

Grants `secretsmanager:GetSecretValue` on `this.secret`. Does not grant
`kms:Decrypt` because the Lambda has already decrypted into ASM — consumers
just read the plaintext secret.

## Shape templates

When no `shape` is provided, the ASM secret stores the decrypted envelope
verbatim:

```json
{
  "DATABASE_HOST": "db.internal",
  "DATABASE_USER": "app",
  "DATABASE_PASSWORD": "…",
  "API_KEY": "…"
}
```

When `shape` is provided, the construct remaps at deploy time. Three
operations are supported:

| Pattern                                | Result                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `"${CLEF_KEY}"`                        | Pure reference — the target field gets the decrypted Clef value.      |
| `"us-east-1"`                          | Literal — stored verbatim. Useful for mixing config with secrets.     |
| `"postgres://${USER}:${PASS}@${HOST}"` | Composition — substitutes `${…}` references inside a template string. |

Example: make the ASM secret match the shape your existing Lambda already
reads, so no app code needs to change:

```ts
new ClefAwsSecretsManager(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
  shape: {
    dbHost: "${DATABASE_HOST}",
    dbUser: "${DATABASE_USER}",
    dbPassword: "${DATABASE_PASSWORD}",
    apiKey: "${API_KEY}",
    region: "us-east-1",
    connectionString: "postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:5432/app",
  },
});
```

### Synth-time validation

Shape templates are validated at `cdk synth` against the envelope's key
list. Unknown references fail the synth with a specific error — the
offending field, the bad reference, a did-you-mean suggestion, and the
full list of valid keys. Example:

```
ClefAwsSecretsManager shape error:

  shape['dbHost'] references unknown Clef key: ${DATABSAE_HOST}
  identity:    api-gateway
  environment: production

  Did you mean ${DATABASE_HOST}?

  Valid keys (4) for this identity/environment:
    - API_KEY
    - DATABASE_HOST
    - DATABASE_PASSWORD
    - DATABASE_USER
```

No broken deploys — the error surfaces before CloudFormation ever runs.

## Consumer patterns

### ECS — field injection

```ts
const task = new ecs.FargateTaskDefinition(this, "Task");
const container = task.addContainer("Api", {
  image: ecs.ContainerImage.fromRegistry("my/app:latest"),
  secrets: {
    DATABASE_URL: ecs.Secret.fromSecretsManager(secrets.secret, "connectionString"),
    API_KEY: ecs.Secret.fromSecretsManager(secrets.secret, "apiKey"),
  },
});
secrets.grantRead(task.taskRole);
```

The container sees `DATABASE_URL` and `API_KEY` as normal env vars. App
code stays unchanged.

### Lambda — Secrets Manager Extension (cached reads)

```ts
const fn = new lambda.Function(this, "Api", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  environment: {
    CLEF_SECRET_ARN: secrets.secret.secretArn,
  },
  layers: [
    lambda.LayerVersion.fromLayerVersionArn(
      this,
      "SmExt",
      "arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11",
    ),
  ],
});
secrets.grantRead(fn);
```

Your handler fetches from `http://localhost:2773/secretsmanager/get?secretId=$CLEF_SECRET_ARN`
and parses the JSON once per cold start.

## Security posture

This construct is explicitly designed to avoid leaving a long-lived,
decrypt-capable Lambda sitting in your account.

- **No baseline `kms:Decrypt` on the unwrap Lambda role.** The Lambda is
  created without any KMS authority.
- **Per-deploy KMS grants.** Each `cdk deploy` creates a new
  `kms:CreateGrant` scoped to `GranteePrincipal = unwrap-role` and
  `Operations = [Decrypt]`. The grant token bypasses propagation delay so
  the first invocation succeeds immediately.
- **Automatic revoke on replace.** CloudFormation Custom Resources treat a
  new grant ID as a replace — `RevokeGrant` runs on the old grant as
  soon as the new one is minted.
- **Between deploys, the Lambda is cold and powerless.** If an attacker
  pivots into it, they get ciphertext from the stack properties and a
  role that can't decrypt anything.

The sibling `AwsCustomResource` that mints the grant holds
`kms:CreateGrant` in its policy, but with scoped conditions:

```
Condition:
  StringEquals:
    kms:GranteePrincipal: <unwrap-lambda-role-arn>
  ForAllValues:StringEquals:
    kms:GrantOperations: [Decrypt]
```

So even if that CR is compromised, it can't grant decrypt to anyone but
the unwrap Lambda.

### Threat model summary

| Adversary                   | Before deploy         | During deploy (minutes)                                         | Between deploys                            |
| --------------------------- | --------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Reads stack template        | Ciphertext only       | Ciphertext only                                                 | Ciphertext only                            |
| Compromises unwrap Lambda   | N/A (not yet created) | Can decrypt once via grant token                                | Cannot decrypt — role has no KMS authority |
| Compromises grant-create CR | N/A                   | Can mint a Decrypt grant — but only to the unwrap Lambda's role | N/A (CR is idle)                           |

## Rotation model

Rotation is **deploy-driven**. Clef's pack-helper regenerates the envelope
each synth with a new `revision` field, so every `cdk deploy` with a fresh
synth replaces the grant and invokes the unwrap Lambda. To rotate secrets:

1. Update values in `clef.yaml` / SOPS files (via `clef set`).
2. Run `cdk deploy`.

No scheduled Lambda, no rotation state to manage.

## Known limits

- **CloudFormation template size.** The envelope is embedded in the
  Custom Resource properties (ciphertext, safe at rest). Typical envelopes
  are 2–5 KB; CFN's template limit is 1 MB. Very large identities (100+
  keys) can press this limit in stacks with many `ClefAwsSecretsManager`
  instances. Use `ClefArtifactBucket` + a Clef agent consumer if you hit
  it.
- **KMS-envelope only.** Age identities can't be used — the unwrap Lambda
  would need the age private key, which is a bootstrap-the-bootstrap
  problem. The construct rejects age at synth with the manifest fix
  pointer.
