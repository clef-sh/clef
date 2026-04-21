# CDK Constructs

`@clef-sh/cdk` lets CDK-native teams deliver Clef-managed secrets directly
into AWS resources — no agent to run, no app-code changes. This guide
walks through an end-to-end setup from `clef.yaml` to a running Lambda
that reads its secrets from AWS Secrets Manager.

## Prerequisites

- An existing Clef repo (`clef init` if you don't have one).
- A KMS-envelope service identity defined in `clef.yaml` (see
  [Service Identities](/guide/service-identities)).
- An AWS account, CDK bootstrapped in the target region.

## 1. Define the service identity with KMS envelope

```yaml
# clef.yaml
version: 1

environments:
  - name: production
    description: Production
    protected: true

namespaces:
  - name: payments
    description: Payment secrets

sops:
  default_backend: age
  age:
    recipients:
      - age1abc… # your team's age recipient

file_pattern: "{namespace}/{environment}.enc.yaml"

service_identities:
  - name: api-gateway
    description: Production API gateway
    namespaces: [payments]
    environments:
      production:
        kms:
          provider: aws
          keyId: arn:aws:kms:us-east-1:111122223333:key/abc-123-def
          region: us-east-1
```

The `kms.keyId` is an existing KMS key in your AWS account. Clef will
call `kms:Encrypt` against it at synth time to wrap an ephemeral DEK.

## 2. Populate secrets

```bash
clef set payments/production DATABASE_HOST=db.internal
clef set payments/production DATABASE_USER=app
clef set payments/production DATABASE_PASSWORD=hunter2
clef set payments/production API_KEY=sk_live_…
```

## 3. Install the CDK library

In your CDK project (which may or may not be the same repo as `clef.yaml`):

```bash
npm install @clef-sh/cdk @aws-sdk/client-kms
```

## 4. Wire the construct

```ts
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ClefAwsSecretsManager } from "@clef-sh/cdk";

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const secrets = new ClefAwsSecretsManager(this, "ApiSecrets", {
      identity: "api-gateway",
      environment: "production",

      // Optional — reshape to match whatever JSON your Lambda already
      // expects. Omit and you'll get the decrypted envelope 1:1.
      shape: {
        dbHost: "${DATABASE_HOST}",
        dbUser: "${DATABASE_USER}",
        dbPassword: "${DATABASE_PASSWORD}",
        apiKey: "${API_KEY}",
        connectionString:
          "postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:5432/app",
      },
    });

    const api = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda"),
      environment: {
        CLEF_SECRET_ARN: secrets.secret.secretArn,
      },
    });

    secrets.grantRead(api);
  }
}
```

## 5. Deploy

```bash
# Credentials the synth needs:
export CLEF_AGE_KEY_FILE=~/.config/clef/age.key   # to decrypt source SOPS files
export AWS_PROFILE=my-profile                     # to wrap the DEK via KMS

cdk deploy
```

What happens:

1. **Synth**: CDK invokes the pack-helper, which decrypts the source
   SOPS files with your age key, encrypts the values under an ephemeral
   DEK, wraps the DEK via your KMS key, and emits the envelope JSON.
   Shape template references are validated — any typos fail here, before
   CloudFormation sees anything.
2. **Deploy — grant create**: a `kms:CreateGrant` authorises the unwrap
   Lambda's role to decrypt just this envelope's DEK, scoped with
   `kms:GrantOperations: [Decrypt]`.
3. **Deploy — unwrap**: the Lambda fetches the envelope from CFN resource
   properties, decrypts via the grant, applies the shape template, and
   calls `secretsmanager:PutSecretValue`.
4. **Deploy — grant revoke**: when the next deploy replaces this grant
   resource (every deploy, since the envelope revision is new each synth),
   CloudFormation calls `kms:RevokeGrant` on the previous grant.

Between deploys, the unwrap Lambda holds **no KMS authority**. If
someone pivots into it, the worst they can do is read ciphertext they
can't decrypt.

## 6. Read secrets from your app

The Lambda reads `CLEF_SECRET_ARN` and fetches from AWS Secrets Manager:

```ts
// lambda/index.ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
let cached: { dbHost: string; apiKey: string; connectionString: string };

export async function handler() {
  if (!cached) {
    const res = await client.send(
      new GetSecretValueCommand({
        SecretId: process.env.CLEF_SECRET_ARN,
      }),
    );
    cached = JSON.parse(res.SecretString!);
  }
  // … use cached.dbHost, cached.connectionString, etc.
}
```

If you're using ECS, field-level injection keeps even this boilerplate out
of your app — see the
[`Secret.fromSecretsManager`](/cdk/aws-secrets-manager#ecs-field-injection)
example.

## Rotating secrets

Rotation is just `clef set` + `cdk deploy`:

```bash
clef set payments/production DATABASE_PASSWORD=new-value
cdk deploy
```

The pack-helper regenerates the envelope with a new revision, CloudFormation
sees the Custom Resource input changed, the unwrap Lambda writes the new
value to ASM, and the previous grant is revoked.

## When to use `ClefArtifactBucket` instead

`ClefAwsSecretsManager` is ideal when you want AWS Secrets Manager as the
runtime surface. If instead you already run the Clef agent (sidecar,
Lambda extension, etc.), use
[`ClefArtifactBucket`](/cdk/artifact-bucket) — it just puts the envelope
in S3 and grants the agent read access. No unwrap Lambda involved.
