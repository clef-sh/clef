# ClefParameter

Delivers a Clef-packed value into an AWS Systems Manager (SSM) Parameter
Store parameter. Consumers read via `ssm:GetParameter`, ECS task-level
`Secret.fromSsmParameter` injection, or CloudFormation dynamic references
(<code v-pre>&#123;&#123;resolve:ssm:/path/name&#125;&#125;</code>) — all
without touching a Clef agent.

**KMS-envelope identities only.** Age identities are rejected at synth
with a pointer to the `clef.yaml` fix.

One construct instance = one SSM parameter. Instantiate multiple times
for multiple parameters — the pack-helper is memoized per `(manifest,
identity, environment)`, so the synth overhead does not scale with
construct count.

## Synopsis

```ts
import { ClefParameter } from "@clef-sh/cdk";

const dbUrl = new ClefParameter(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
});

dbUrl.grantRead(apiLambda);
```

## Props

| Prop              | Type                         | Required | Description                                                                                                                                        |
| ----------------- | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`        | `string`                     | yes      | Service identity name from `clef.yaml`. Must use KMS-envelope encryption.                                                                          |
| `environment`     | `string`                     | yes      | Target environment (e.g. `"production"`).                                                                                                          |
| `shape`           | `string`                     | yes      | Template for the single parameter value. `${CLEF_KEY}` references are interpolated at deploy time. Supports composition.                           |
| `manifest`        | `string`                     | no       | Absolute or cwd-relative path to `clef.yaml`. Default: walk-up discovery.                                                                          |
| `parameterName`   | `string`                     | no       | SSM parameter name. Default: `/clef/<identity>/<environment>/<constructId>`.                                                                       |
| `type`            | `"String" \| "SecureString"` | no       | Default `"SecureString"` — encrypts at rest.                                                                                                       |
| `tier`            | `ClefParameterTier`          | no       | `"Standard"` (default, free, 4 KB) · `"Advanced"` (chargeable, 8 KB + policies) · `"Intelligent-Tiering"`.                                         |
| `parameterKmsKey` | `IKey`                       | no       | Customer-managed KMS key for at-rest encryption of `SecureString`. Default: `alias/aws/ssm`. Orthogonal to the envelope KMS key from the manifest. |

## Attributes

| Attribute       | Type         | Description                                        |
| --------------- | ------------ | -------------------------------------------------- |
| `parameter`     | `IParameter` | The SSM parameter receiving the unwrapped value.   |
| `parameterName` | `string`     | The resolved parameter name (derived or explicit). |
| `envelopeKey`   | `IKey`       | Imported KMS key that wraps the envelope's DEK.    |
| `manifestPath`  | `string`     | Absolute path to the resolved `clef.yaml`.         |

## Methods

### `grantRead(grantable)`

Grants `ssm:DescribeParameters`, `ssm:GetParameter`, `ssm:GetParameters`,
`ssm:GetParameterHistory` on the parameter. For `SecureString` backed by
a **custom** `parameterKmsKey`, also grants `kms:Decrypt` on that key.

For the `alias/aws/ssm` default, `kms:Decrypt` is not added — AWS-managed
keys don't accept CDK grants, and the SSM integration on the account
handles decrypt automatically for consumers with `ssm:GetParameter`.
This matches native `ssm.StringParameter.grantRead` behaviour.

## Shape template

Unlike `ClefSecret`, `shape` is **required** and must be a **string**.
SSM parameters hold one value each, so there's no Record mode or
passthrough. For composite values, interpolate multiple Clef keys into
one template:

```ts
shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app";
shape: "${STRIPE_SECRET_KEY}"; // pure ref
shape: "us-east-1"; // literal (unusual — plaintext in SSM)
```

Validation runs at `cdk synth` against the envelope's key list — typos
fail with the same did-you-mean message used by `ClefSecret`.

## Declaring multiple parameters

```ts
const dbUrl = new ClefParameter(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}",
});

const stripe = new ClefParameter(this, "StripeKey", {
  identity: "api-gateway",
  environment: "production",
  shape: "${STRIPE_SECRET_KEY}",
});

const sentry = new ClefParameter(this, "SentryDsn", {
  identity: "api-gateway",
  environment: "production",
  shape: "${SENTRY_DSN}",
});

dbUrl.grantRead(apiLambda);
stripe.grantRead(paymentsLambda);
sentry.grantRead(api);
```

Three parameters under `/clef/api-gateway/production/`, readable
independently. One `ClefSecret` or `ClefParameter` elsewhere in the same
stack that targets `api-gateway/production` shares the same pack
invocation — the pack-helper runs once per identity per synth.

## Consumer patterns

### CloudFormation dynamic reference

```ts
new lambda.Function(this, "Api", {
  environment: {
    DATABASE_URL: `{{resolve:ssm:${dbUrl.parameterName}}}`,
  },
  // ... other props
});
```

CFN resolves the parameter value at stack-operation time and substitutes
it into the env var. Works for `String` and `SecureString` (with
<code v-pre>&#123;&#123;resolve:ssm-secure:...&#125;&#125;</code>) — but
plaintext ends up in the CFN stack
template, so `SecureString` via dynamic reference defeats the
encryption-at-rest. Use ECS or Lambda Extension injection instead when
you care.

### ECS — field injection

```ts
task.addContainer("Api", {
  image: ecs.ContainerImage.fromRegistry("my/app:latest"),
  secrets: {
    DATABASE_URL: ecs.Secret.fromSsmParameter(dbUrl.parameter),
  },
});
dbUrl.grantRead(task.taskRole);
```

### Lambda — Secrets Manager & Parameters Lambda Extension

```ts
const fn = new lambda.Function(this, "Api", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  environment: {
    CLEF_DB_URL_PARAM: dbUrl.parameterName,
  },
  layers: [
    lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ParamExt",
      "arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11",
    ),
  ],
});
dbUrl.grantRead(fn);
```

Handler fetches from
`http://localhost:2773/systemsmanager/parameters/get?name=$CLEF_DB_URL_PARAM&withDecryption=true`
at cold start.

## Security posture

Identical to `ClefSecret` — same per-deploy KMS grant lifecycle on the
envelope key, same scoped `kms:CreateGrant` condition, same shared
singleton unwrap Lambda. See [ClefSecret → Security posture](/cdk/secret#security-posture)
for the full explanation.

Parameter-specific notes:

- **At-rest KMS is a separate key.** The envelope KMS key (from the
  manifest) wraps the packed DEK during synth. The at-rest KMS key
  (`alias/aws/ssm` or a user-provided CMK) encrypts the value SSM stores
  after the unwrap Lambda writes it. Different keys, different trust
  relationships.
- **Lambda owns the parameter lifecycle.** SSM `SecureString` parameters
  cannot be created via CloudFormation — a long-standing CFN limitation.
  Our unwrap Lambda creates, updates, and deletes the parameter via the
  SSM API, scoped by IAM to just this one parameter ARN.
- **Plaintext "initial" window.** Because the parameter is Lambda-owned,
  there's no pre-deploy stub value. The parameter exists only after the
  unwrap Lambda runs. Consumers that race a fresh stack deploy will see
  `ParameterNotFound` until the Custom Resource completes — wait for
  stack `CREATE_COMPLETE` / `UPDATE_COMPLETE` before reading.

## Rotation

Same as `ClefSecret` — deploy-driven. `clef set`, then `cdk deploy`.

## Known limits

- **SSM parameter value size.** Standard tier: 4 KB. Advanced: 8 KB.
  Individual parameters, not per stack.
- **KMS-envelope only.** Age identities are rejected at synth.
- **Default-key Decrypt is consumer's responsibility.** `grantRead` does
  not add `kms:Decrypt` for the `alias/aws/ssm` default — see the
  `grantRead` section above.
