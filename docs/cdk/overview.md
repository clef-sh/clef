# CDK Constructs

`@clef-sh/cdk` exposes AWS CDK L2 constructs that bridge Clef-managed secrets
into AWS-native resources. One construct call, one explicit IAM grant, no
agent to run.

```bash
npm install @clef-sh/cdk
```

Peer deps: `aws-cdk-lib ^2.100`, `constructs ^10`. Install
`@aws-sdk/client-kms` alongside for KMS-envelope service identities.

## What you get

| Construct                                    | When to use it                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ClefArtifactBucket`](/cdk/artifact-bucket) | You're already running the Clef agent (as a sidecar, Lambda extension, or in-process). You want a stable S3 location it can poll. Works with both age and KMS-envelope identities.       |
| [`ClefSecret`](/cdk/secret)                  | Your app already reads AWS Secrets Manager (via the SDK, ECS secret injection, or the Lambda Secrets Manager Extension). No agent, no app code changes. KMS-envelope identities only.    |
| [`ClefParameter`](/cdk/parameter)            | Your app reads AWS Systems Manager Parameter Store — via the SDK, ECS `Secret.fromSsmParameter`, or CFN dynamic references. One construct = one parameter. KMS-envelope identities only. |

## Shared behaviours

Both constructs share the same synth-time foundation:

- **Manifest walk-up discovery.** When the `manifest:` prop is omitted, the
  construct walks up from `process.cwd()` looking for a `clef.yaml`,
  stopping at the git root, the user's home directory, or the filesystem
  root. Pass an explicit path when CDK lives in a different repo from the
  manifest.

- **Pack-helper subprocess.** A small Node helper is spawned during synth
  to decrypt source SOPS files and produce the encrypted envelope. Same
  idiom AWS-native L2s use (`NodejsFunction` → esbuild,
  `DockerImageAsset` → docker build).

- **Credential resolution at synth.** The pack-helper reads `CLEF_AGE_KEY`
  or `CLEF_AGE_KEY_FILE` for age material, and uses the normal AWS SDK
  credential chain (env vars, `AWS_PROFILE`, instance role, IRSA) for
  KMS-envelope identities.

## Minimal example

```ts
import { Stack } from "aws-cdk-lib";
import { ClefSecret } from "@clef-sh/cdk";

export class ApiStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const secrets = new ClefSecret(this, "ApiSecrets", {
      identity: "api-gateway",
      environment: "production",
    });

    secrets.grantRead(apiLambda);
    // apiLambda now reads its secret JSON from AWS Secrets Manager
    // — no agent, no changes to the Lambda's runtime code.
  }
}
```

See the [CDK guide](/guide/cdk) for a full walkthrough including
`clef.yaml` setup, KMS key provisioning, and ECS field injection.
