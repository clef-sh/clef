# @clef-sh/cdk

AWS CDK L2 constructs for delivering [Clef](https://clef.sh)-managed secrets
into AWS-native resources at deploy time. One construct call, one explicit
IAM grant, no agent to run, no app-code changes.

```bash
npm install @clef-sh/cdk
```

Peer deps: `aws-cdk-lib ^2.100`, `constructs ^10`. For KMS-envelope
identities (recommended), also install `@aws-sdk/client-kms`.

## What's included

| Construct            | Use case                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClefArtifactBucket` | Deliver the encrypted envelope to S3 for the Clef agent (or any VCS-compatible client) to fetch and decrypt at runtime.                                                   |
| `ClefSecret`         | Unwrap the envelope at deploy time and store the plaintext in AWS Secrets Manager. Consumers read via the native ASM SDK / ECS secret injection — no Clef agent required. |
| `ClefParameter`      | Unwrap the envelope at deploy time and store the plaintext in an SSM Parameter Store parameter. One construct = one parameter. Consumers read via `ssm:GetParameter`.     |

## Quick start

### S3 delivery (any identity type)

```ts
import { ClefArtifactBucket } from "@clef-sh/cdk";

const artifact = new ClefArtifactBucket(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
});

// Consumer wiring — explicit, reviewer-visible
artifact.grantRead(agentLambda); // s3:GetObject
artifact.envelopeKey?.grantDecrypt(agentLambda); // kms:Decrypt (KMS identities only)
```

### AWS Secrets Manager delivery (KMS-envelope identities)

```ts
import { ClefSecret } from "@clef-sh/cdk";

// Single-value secret — connection string, API token, webhook URL, etc.
const dbUrl = new ClefSecret(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
});

// JSON-shaped secret — multiple fields, mapping Clef keys to app-expected names
const config = new ClefSecret(this, "Config", {
  identity: "api-gateway",
  environment: "production",
  shape: {
    dbHost: "${DATABASE_HOST}",
    apiKey: "${API_KEY}",
    region: "us-east-1", // literal
  },
});

dbUrl.grantRead(apiLambda);
config.grantRead(apiLambda);
```

Each `new ClefSecret(…)` provisions one ASM secret, same as native
`secretsmanager.Secret`. The pack-helper is memoized per
`(manifest, identity, environment)`, so multiple instances for the same
identity share a single pack invocation at synth.

### SSM Parameter Store delivery (KMS-envelope identities)

```ts
import { ClefParameter } from "@clef-sh/cdk";

const dbUrl = new ClefParameter(this, "DbUrl", {
  identity: "api-gateway",
  environment: "production",
  shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
});

const stripe = new ClefParameter(this, "StripeKey", {
  identity: "api-gateway",
  environment: "production",
  shape: "${STRIPE_SECRET_KEY}",
});

dbUrl.grantRead(apiLambda);
stripe.grantRead(paymentsLambda);
```

`ClefParameter` is single-value only (SSM holds one value per parameter),
so `shape` is required and must be a string template. Defaults to
`SecureString` with the AWS-managed `alias/aws/ssm` at-rest key. Shares
the unwrap Lambda and per-deploy KMS grant lifecycle with `ClefSecret`.

Existing Lambdas using `SecretsManagerClient.GetSecretValue` or ECS
services using `Secret.fromSecretsManager(secret, "FIELD")` keep working
unchanged — the construct shapes ASM to match what your app already reads.

## How `ClefSecret` stays secure

Conventional "unwrap Lambda" designs leave a long-lived Lambda with
persistent `kms:Decrypt` in your account — an attractive target for anyone
who pivots into the runtime. `ClefSecret` uses **per-deploy KMS grants**
instead:

- The unwrap Lambda's role has **no baseline `kms:Decrypt`**.
- On each deploy, a sibling CloudFormation Custom Resource calls
  `kms:CreateGrant` scoped to `GranteePrincipal = unwrap-role` and
  `Operations = [Decrypt]`. Authority lasts for one invocation.
- When the envelope revision changes (every `cdk deploy`), CloudFormation
  replaces the grant resource — `RevokeGrant` runs on the previous grant
  before the new one takes over.

Between deploys the Lambda is cold and, on its own, cannot decrypt
anything. Ciphertext in stack resource properties is safe at rest (same
threat model Clef assumes everywhere else).

## Synth-time validation

Shape templates are validated **before** CloudFormation sees them. Typos
surface at `cdk synth` with the field name (or `<value>` for string
shape), the bad reference, a did-you-mean suggestion, and the full list of
valid Clef keys for that identity/environment. No broken deploys, no
rollback dances.

## Requirements at synth time

- **`sops` binary** on `PATH`, or bundled via the matching
  `@clef-sh/sops-*` platform package (installed automatically with
  `@clef-sh/cli`).
- **Age credentials** — `CLEF_AGE_KEY` or `CLEF_AGE_KEY_FILE` env var
  pointing at the user's age private key. Used to decrypt source SOPS
  files during the pack step.
- **AWS credentials** — required for KMS-envelope identities; the synth
  calls `kms:Encrypt` to wrap a fresh DEK into the envelope. Standard AWS
  SDK credential resolution (`AWS_PROFILE`, env vars, instance role, etc.).

## Full docs

- Construct reference & guide: [clef.sh/cdk](https://clef.sh/cdk/overview)
- Quickstart: [clef.sh/guide/cdk](https://clef.sh/guide/cdk)
- Source & issues: [github.com/clef-sh/clef](https://github.com/clef-sh/clef)

## License

MIT
