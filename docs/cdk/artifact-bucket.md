# ClefArtifactBucket

Delivers a Clef-packed envelope to an S3 bucket. Consumers (typically the
Clef agent running as a sidecar or Lambda extension) fetch the envelope,
verify it, and decrypt in memory.

Works with both age and KMS-envelope identities.

## Synopsis

```ts
import { ClefArtifactBucket } from "@clef-sh/cdk";

const artifact = new ClefArtifactBucket(this, "ApiSecrets", {
  identity: "api-gateway",
  environment: "production",
});

artifact.grantRead(agentLambda); // s3:GetObject
artifact.envelopeKey?.grantDecrypt(agentLambda); // kms:Decrypt, KMS identities only
```

## Props

| Prop          | Type      | Required | Description                                                                                                                             |
| ------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`    | `string`  | yes      | Service identity name from `clef.yaml`.                                                                                                 |
| `environment` | `string`  | yes      | Target environment (e.g. `"production"`).                                                                                               |
| `manifest`    | `string`  | no       | Absolute or cwd-relative path to `clef.yaml`. When omitted, the construct walks up from `process.cwd()` looking for one.                |
| `bucket`      | `IBucket` | no       | Existing bucket to deliver into. When omitted, a hardened bucket is provisioned (SSE-S3, block public access, `enforceSSL`, versioned). |

## Attributes

| Attribute      | Type                | Description                                                                        |
| -------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `bucket`       | `IBucket`           | The receiving bucket — either `props.bucket` or the one provisioned here.          |
| `objectKey`    | `string`            | S3 key where the envelope is stored: `clef/<identity>/<environment>.json`.         |
| `envelopeKey`  | `IKey \| undefined` | Imported KMS key that wraps the envelope's DEK. Undefined for age-only identities. |
| `manifestPath` | `string`            | Absolute path to the resolved `clef.yaml`, for debugging.                          |

## Methods

### `grantRead(grantable)`

Grants `s3:GetObject` on the envelope object only. Does **not** grant
`kms:Decrypt` — for KMS-envelope identities, call
`artifact.envelopeKey.grantDecrypt(consumer)` explicitly. The two-step
wiring is intentional: the IAM binding shows up in your stack code where
reviewers can see it.

## Usage patterns

### Provision a fresh hardened bucket

```ts
const artifact = new ClefArtifactBucket(this, "Secrets", {
  identity: "api-gateway",
  environment: "production",
});
// Bucket has: SSE-S3, block public access, TLS-only, versioning on.
```

### Deliver to an existing bucket

```ts
const shared = s3.Bucket.fromBucketName(this, "Shared", "my-org-config");
const artifact = new ClefArtifactBucket(this, "Secrets", {
  identity: "api-gateway",
  environment: "production",
  bucket: shared,
});
```

`BucketDeployment` runs with `prune: false`, so it only writes the single
envelope object and leaves unrelated keys alone.

### Wire a Lambda as the consumer (KMS-envelope identity)

```ts
const artifact = new ClefArtifactBucket(this, "Secrets", {
  identity: "api-gateway",
  environment: "production",
});

const consumer = new lambda.Function(this, "Api", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  environment: {
    CLEF_ARTIFACT_URL: `s3://${artifact.bucket.bucketName}/${artifact.objectKey}`,
  },
});

artifact.grantRead(consumer);
artifact.envelopeKey?.grantDecrypt(consumer);
```

The Lambda then uses [`@clef-sh/runtime`](/api/) to fetch, verify, and
decrypt the envelope at cold start.

## Architecture

At synth time:

1. Walk up to find `clef.yaml` (unless `manifest:` is explicit).
2. Spawn the pack-helper subprocess — decrypts source SOPS files, produces
   the encrypted envelope JSON in memory.
3. Emit CloudFormation for the bucket (or wrap the provided one) plus a
   `BucketDeployment` that ships the envelope bytes via `Source.data()`.

At deploy time:

1. CloudFormation `BucketDeployment` uploads the envelope to the target
   bucket under `clef/<identity>/<environment>.json`.

The envelope ciphertext is all that reaches S3 — plaintext never leaves
the synth-time process memory.

## Credential requirements at synth

- `sops` binary on `PATH`, or via bundled `@clef-sh/sops-*` packages.
- `CLEF_AGE_KEY` or `CLEF_AGE_KEY_FILE` env var for the user's age private
  key (used to decrypt source files).
- For KMS-envelope identities: AWS credentials via the normal SDK chain.
  The pack-helper calls `kms:Encrypt` to wrap the DEK.
