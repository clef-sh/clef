import { Construct } from "constructs";
import {
  Token,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import { resolveManifestPath } from "./manifest-path";
import { invokePackHelper } from "./pack-invoker";
import { getOrCreateVerifyKeyResource } from "./verify-key";

/**
 * Props for {@link ClefArtifactBucket}.
 */
export interface ClefArtifactBucketProps {
  /** Service identity name from `clef.yaml`. */
  readonly identity: string;
  /** Target environment name (e.g. `"production"`). */
  readonly environment: string;
  /**
   * Path to `clef.yaml`. Resolved relative to `process.cwd()` at synth time.
   * When omitted, walks up from cwd looking for a `clef.yaml`, stopping at
   * the git root, the user's home directory, or the filesystem root.
   */
  readonly manifest?: string;
  /**
   * S3 bucket to deliver the envelope into. When omitted, a hardened
   * private bucket is provisioned (S3-managed encryption, block public
   * access, TLS-only).
   */
  readonly bucket?: IBucket;
  /**
   * KMS asymmetric key (ECDSA_SHA_256) used to sign the envelope at
   * `cdk synth` time. When set, the construct also provisions a deploy-time
   * `kms:GetPublicKey` lookup so consumers can wire `CLEF_VERIFY_KEY` via
   * {@link verifyKey} or {@link bindVerifyKey} without ever holding key
   * bytes themselves.
   *
   * The key must be a reference to an existing key (`Key.fromKeyArn(...)`),
   * not one provisioned in the same stack — signing happens at synth before
   * the stack is deployed.
   *
   * The principal running `cdk synth` (developer laptop or CI role) needs
   * `kms:Sign` on this key. The construct does not auto-grant.
   *
   * For Ed25519 signing, set `CLEF_SIGNING_KEY` in the synth environment
   * instead. There is no construct-level surface for the public verify key
   * in that mode — wire `CLEF_VERIFY_KEY` on the consumer manually.
   */
  readonly signingKey?: IKey;
}

interface EnvelopeShape {
  envelope?: {
    provider?: string;
    keyId?: string;
  };
}

/**
 * Deliver a Clef-packed artifact to an S3 bucket.
 *
 * At CDK synth time the construct packs a JSON envelope for the given
 * `identity` + `environment` (via a subprocess helper — the same idiom used
 * by `NodejsFunction` for esbuild bundling) and uploads it to the bucket
 * using `BucketDeployment`.
 *
 * IAM is explicit by design: {@link grantRead} binds S3 `GetObject` only.
 * When the identity uses KMS envelope encryption, callers must also call
 * `artifact.envelopeKey?.grantDecrypt(consumer)` so the binding appears in
 * the user's stack code where reviewers can see it.
 */
export class ClefArtifactBucket extends Construct {
  /** Bucket receiving the envelope (either `props.bucket` or one provisioned here). */
  public readonly bucket: IBucket;
  /** S3 object key under which the envelope is stored. */
  public readonly objectKey: string;
  /**
   * KMS key that wraps the envelope's DEK, imported from the manifest's
   * service-identity config. Undefined for age-only identities.
   */
  public readonly envelopeKey?: IKey;
  /**
   * Base64 DER SPKI public key for verifying the envelope's signature at
   * runtime. CFN token resolved at deploy time via `kms:GetPublicKey`.
   * Undefined when {@link ClefArtifactBucketProps.signingKey} is not set.
   *
   * Wire into a consumer Lambda via {@link bindVerifyKey} or directly:
   * `fn.addEnvironment("CLEF_VERIFY_KEY", artifact.verifyKey!)`.
   */
  public readonly verifyKey?: string;
  /** Absolute path to the resolved `clef.yaml`, for debugging. */
  public readonly manifestPath: string;

  constructor(scope: Construct, id: string, props: ClefArtifactBucketProps) {
    super(scope, id);

    this.manifestPath = resolveManifestPath(props.manifest);

    if (props.signingKey && Token.isUnresolved(props.signingKey.keyArn)) {
      throw new Error(
        "ClefArtifactBucket: signingKey must reference an existing KMS key " +
          "(use `Key.fromKeyArn(...)`). Signing happens at `cdk synth` time, " +
          "before the stack is deployed, so a key created in the same stack " +
          "hasn't been provisioned yet.",
      );
    }

    const { envelopeJson } = invokePackHelper({
      manifest: this.manifestPath,
      identity: props.identity,
      environment: props.environment,
      signingKmsKeyId: props.signingKey?.keyArn,
    });

    // JSON.parse is safe here — the helper produces canonical JSON via
    // JSON.stringify. Extraction is read-only; the envelope itself is
    // forwarded verbatim to the bucket.
    let parsed: EnvelopeShape;
    try {
      parsed = JSON.parse(envelopeJson) as EnvelopeShape;
    } catch (err) {
      throw new Error(
        `pack-helper returned non-JSON output for '${props.identity}/${props.environment}': ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.bucket =
      props.bucket ??
      new s3.Bucket(this, "Bucket", {
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
      });

    this.objectKey = `clef/${props.identity}/${props.environment}.json`;

    new s3deploy.BucketDeployment(this, "Deploy", {
      destinationBucket: this.bucket,
      sources: [s3deploy.Source.data(this.objectKey, envelopeJson)],
      // prune:false — deployment writes our one key and leaves unrelated
      // objects alone (critical when `props.bucket` is a shared bucket).
      prune: false,
      // extract:true is the default and correct here: Source.data() builds
      // a zip with one file at objectKey, which BucketDeployment extracts.
    });

    if (parsed.envelope?.keyId) {
      this.envelopeKey = kms.Key.fromKeyArn(this, "EnvelopeKey", parsed.envelope.keyId);
    }

    if (props.signingKey) {
      const lookup = getOrCreateVerifyKeyResource(this, props.signingKey);
      this.verifyKey = lookup.getResponseField("PublicKey");
    }
  }

  /**
   * Grant `s3:GetObject` on the envelope object only. Does NOT grant
   * `kms:Decrypt` — call {@link envelopeKey}.grantDecrypt(...) explicitly
   * so the binding is visible in the consumer's stack code.
   */
  public grantRead(grantable: IGrantable): Grant {
    return this.bucket.grantRead(grantable, this.objectKey) as unknown as Grant;
  }

  /**
   * Source URL in `s3://bucket/key` form, ready to feed directly into the
   * consumer's `CLEF_AGENT_SOURCE` environment variable. The agent resolves
   * region from `AWS_REGION`, which Lambda and ECS populate automatically.
   *
   * ```typescript
   * fn.addEnvironment('CLEF_AGENT_SOURCE', artifact.s3AgentSource);
   * ```
   */
  public get s3AgentSource(): string {
    return `s3://${this.bucket.bucketName}/${this.objectKey}`;
  }

  /**
   * Wire the signature verification public key into a consumer Lambda's
   * environment as `CLEF_VERIFY_KEY`. The runtime hard-rejects unsigned
   * artifacts when this env var is set, so do not call this for unsigned
   * artifacts unless you intend to enforce signing.
   *
   * Throws if {@link ClefArtifactBucketProps.signingKey} was not configured
   * — there is no public key to bind.
   */
  public bindVerifyKey(fn: lambda.Function): void {
    if (!this.verifyKey) {
      throw new Error(
        "ClefArtifactBucket: bindVerifyKey called but no signingKey was " +
          "configured. Pass `signingKey` to the construct, or set " +
          "`CLEF_VERIFY_KEY` on the consumer manually for Ed25519 deployments.",
      );
    }
    fn.addEnvironment("CLEF_VERIFY_KEY", this.verifyKey);
  }
}

export type { IGrantable } from "aws-cdk-lib/aws-iam";
