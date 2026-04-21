# ClefSecret

Delivers a Clef-packed envelope to AWS Secrets Manager. Consumers read via
the native AWS SDK, ECS secret injection, or the Secrets Manager Lambda
Extension — no Clef agent, no app-code changes.

**KMS-envelope identities only.** Age identities are rejected at synth with
a pointer to the `clef.yaml` fix.

One construct instance = one ASM secret. Instantiate multiple times for
multiple secrets — the pack-helper is memoized per `(manifest, identity,
environment)`, so the synth overhead does not scale with construct count.

## Synopsis

```ts
import { ClefSecret } from "@clef-sh/cdk";

const secrets = new ClefSecret(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
});

secrets.grantRead(apiLambda);
```

## Props

| Prop          | Type                               | Required | Description                                                                                                                                        |
| ------------- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`    | `string`                           | yes      | Service identity name from `clef.yaml`. Must use KMS-envelope encryption.                                                                          |
| `environment` | `string`                           | yes      | Target environment (e.g. `"production"`).                                                                                                          |
| `manifest`    | `string`                           | no       | Absolute or cwd-relative path to `clef.yaml`. Default: walk-up discovery.                                                                          |
| `shape`       | `string \| Record<string, string>` | no       | Shape of the ASM secret value. See [Shape templates](#shape-templates) below. When omitted, the ASM secret stores the decrypted envelope JSON 1:1. |
| `secretName`  | `string`                           | no       | Explicit ASM secret name. Default: `clef/<identity>/<environment>`.                                                                                |

## Attributes

| Attribute      | Type      | Description                                     |
| -------------- | --------- | ----------------------------------------------- |
| `secret`       | `ISecret` | The managed ASM secret.                         |
| `envelopeKey`  | `IKey`    | Imported KMS key that wraps the envelope's DEK. |
| `manifestPath` | `string`  | Absolute path to the resolved `clef.yaml`.      |

## Methods

### `grantRead(grantable)`

Grants `secretsmanager:GetSecretValue` on `this.secret`. Does not grant
`kms:Decrypt` because the Lambda has already decrypted into ASM —
consumers just read the plaintext secret.

## Shape templates

The `shape` prop has three forms. Pick whichever matches what your
consumer already expects.

### 1. Passthrough — no shape

```ts
new ClefSecret(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
});
```

The ASM secret stores the decrypted envelope verbatim:

```json
{ "DATABASE_HOST": "db.internal", "DATABASE_USER": "app", "API_KEY": "…" }
```

### 2. String shape — single-value secret

```ts
new ClefSecret(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
});
```

The string is interpolated and written to `SecretString` verbatim — no
JSON wrapping. Consumers calling `GetSecretValue` see exactly the
interpolated string.

Use when:

- The consumer expects a scalar (connection string, opaque token, webhook
  URL).
- You want one ASM secret per logical concept.

### 3. Record shape — JSON secret with mapped fields

```ts
new ClefSecret(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
  shape: {
    dbHost: "${DATABASE_HOST}",
    dbPassword: "${DATABASE_PASSWORD}",
    apiKey: "${API_KEY}",
    region: "us-east-1", // literal — no ${...}
    connectionString: "postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:5432/app",
  },
});
```

Each value is a template: literals pass through, `${CLEF_KEY}` references
are substituted, and composition in a single field (see
`connectionString`) lets you build compound values from multiple Clef
keys.

Use when:

- The consumer expects JSON with specific field names.
- You want ECS field injection via
  `Secret.fromSecretsManager(secret, "FIELD")`.

### Synth-time validation

Both string and Record shape templates are validated at `cdk synth`
against the envelope's key list. Unknown references fail the synth with a
specific error — the offending field (or `<value>` for string shape), the
bad reference, a did-you-mean suggestion, and the full list of valid
keys. Example:

```
ClefSecret shape error:

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

## Declaring multiple secrets

Each `new ClefSecret(…)` call provisions one ASM secret, same as native
`secretsmanager.Secret`. To produce multiple secrets for one identity,
instantiate multiple times:

```ts
const dbUrl = new ClefSecret(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
});

const apiKey = new ClefSecret(this, "ApiKey", {
  identity: "api-gateway",
  environment: "production",
  shape: "${STRIPE_SECRET_KEY}",
});

const config = new ClefSecret(this, "Config", {
  identity: "api-gateway",
  environment: "production",
  shape: {
    region: "us-east-1",
    logLevel: "info",
    sentryDsn: "${SENTRY_DSN}",
  },
});

dbUrl.grantRead(dbLambda);
apiKey.grantRead(paymentsLambda);
config.grantRead(api);
```

The pack-helper runs once per `(manifest, identity, environment)` tuple
per synth, so three `ClefSecret` instances for `api-gateway/production`
all share a single pack invocation.

## Consumer patterns

### ECS — field injection (Record shape)

```ts
const task = new ecs.FargateTaskDefinition(this, "Task");
task.addContainer("Api", {
  image: ecs.ContainerImage.fromRegistry("my/app:latest"),
  secrets: {
    DATABASE_URL: ecs.Secret.fromSecretsManager(config.secret, "connectionString"),
    API_KEY: ecs.Secret.fromSecretsManager(config.secret, "apiKey"),
  },
});
config.grantRead(task.taskRole);
```

### ECS — whole-secret injection (string shape)

```ts
task.addContainer("Api", {
  image: ecs.ContainerImage.fromRegistry("my/app:latest"),
  secrets: {
    DATABASE_URL: ecs.Secret.fromSecretsManager(dbUrl.secret),
  },
});
dbUrl.grantRead(task.taskRole);
```

When the secret is a single-value string (no JSON), `fromSecretsManager`
without a field argument injects the raw string as the env var.

### Lambda — Secrets Manager Extension (cached reads)

```ts
const fn = new lambda.Function(this, "Api", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  environment: {
    CLEF_SECRET_ARN: config.secret.secretArn,
  },
  layers: [
    lambda.LayerVersion.fromLayerVersionArn(
      this,
      "SmExt",
      "arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11",
    ),
  ],
});
config.grantRead(fn);
```

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
  new grant ID as a replace — `RevokeGrant` runs on the old grant as soon
  as the new one is minted.
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

Rotation is **deploy-driven**. Clef's pack-helper regenerates the
envelope each synth with a new `revision` field, so every `cdk deploy`
with a fresh synth replaces the grant and invokes the unwrap Lambda. To
rotate secrets:

1. Update values in `clef.yaml` / SOPS files (via `clef set`).
2. Run `cdk deploy`.

No scheduled Lambda, no rotation state to manage.

## Known limits

- **CloudFormation template size.** The envelope is embedded in the
  Custom Resource properties (ciphertext, safe at rest). Typical envelopes
  are 2–5 KB; CFN's template limit is 1 MB. Very large identities (100+
  keys) can press this limit in stacks with many `ClefSecret` instances.
  Use `ClefArtifactBucket` + a Clef agent consumer if you hit it.
- **KMS-envelope only.** Age identities can't be used — the unwrap Lambda
  would need the age private key, which is a bootstrap-the-bootstrap
  problem. The construct rejects age at synth with the manifest fix
  pointer.
