import * as path from "path";
import { Construct } from "constructs";
import {
  CustomResource,
  Duration,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_secretsmanager as sm,
  custom_resources as cr,
} from "aws-cdk-lib";
import type { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { resolveManifestPath } from "./manifest-path";
import { invokePackHelper } from "./pack-invoker";
import { validateShape } from "./shape-template";

/**
 * Props for {@link ClefAwsSecretsManager}.
 */
export interface ClefAwsSecretsManagerProps {
  /** Service identity name from `clef.yaml`. Must use KMS-envelope encryption. */
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
   * Optional target JSON shape for the ASM secret. Keys are the field names
   * the consumer expects; values are literal strings or `${CLEF_KEY}` template
   * references to Clef keys. Supports composition
   * (`"postgres://${USER}:${PASS}@${HOST}"`).
   *
   * When omitted, the ASM secret stores the decrypted envelope JSON as-is
   * (1:1 with Clef key names).
   *
   * Unknown `${VAR}` references fail loud at synth with a message listing
   * valid keys and a "did you mean?" suggestion for close matches.
   */
  readonly shape?: Record<string, string>;
  /** Explicit secret name. Defaults to `clef/<identity>/<environment>`. */
  readonly secretName?: string;
}

interface EnvelopeView {
  revision: string;
  envelope?: {
    provider?: string;
    keyId?: string;
  };
}

/**
 * Deliver a Clef-packed artifact into AWS Secrets Manager as a JSON secret.
 *
 * Architecture — two Custom Resources orchestrate the unwrap:
 *
 *   1. **GrantCreate** — `kms:CreateGrant` authorises the unwrap Lambda to
 *      `Decrypt` the envelope's wrapped DEK, for this deploy only. The grant
 *      token short-circuits propagation delay. Grant is scoped to
 *      `GranteePrincipal = unwrap Lambda role` and `Operations = [Decrypt]`.
 *      On stack update that replaces the resource (new envelope revision =
 *      new physical id), CFN calls `RevokeGrant` on the old grant.
 *
 *   2. **Unwrap** — invokes a stack-wide singleton Lambda with the envelope
 *      JSON, shape template, secret ARN, and grant token. Lambda decrypts via
 *      KMS (using the just-minted grant), AES-GCM unwraps the ciphertext,
 *      applies the shape, and calls `secretsmanager:PutSecretValue`.
 *
 * Security posture (the whole point of this shape):
 *   - The unwrap Lambda has **no baseline `kms:Decrypt`**. Its only KMS
 *     authority is the short-lived grant, minted per deploy, revoked on the
 *     next deploy's replace.
 *   - The AwsCustomResource-provisioned auto Lambda has `kms:CreateGrant`
 *     and `kms:RevokeGrant` — but constrained via `kms:GranteePrincipal`
 *     and `kms:GrantOperations` conditions so it can *only* grant Decrypt to
 *     the unwrap Lambda's role.
 *   - The envelope JSON lives in CFN resource properties after deploy — it's
 *     ciphertext, safe anywhere (same threat model Clef already assumes).
 *
 * IAM is explicit by design: {@link grantRead} binds `secretsmanager:
 * GetSecretValue` only. Consumers who need ASM's decrypt (for custom KMS
 * CMK-encrypted secrets) wire that themselves.
 */
export class ClefAwsSecretsManager extends Construct {
  /** The ASM secret receiving the unwrapped value. */
  public readonly secret: ISecret;
  /** KMS key that wraps the envelope's DEK (from `clef.yaml` service-identity config). */
  public readonly envelopeKey: IKey;
  /** Absolute path to the resolved `clef.yaml`, for debugging. */
  public readonly manifestPath: string;

  constructor(scope: Construct, id: string, props: ClefAwsSecretsManagerProps) {
    super(scope, id);

    this.manifestPath = resolveManifestPath(props.manifest);

    const { envelopeJson, keys } = invokePackHelper({
      manifest: this.manifestPath,
      identity: props.identity,
      environment: props.environment,
    });

    let envelope: EnvelopeView;
    try {
      envelope = JSON.parse(envelopeJson) as EnvelopeView;
    } catch (err) {
      throw new Error(
        `pack-helper returned non-JSON output for '${props.identity}/${props.environment}': ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // KMS-envelope is a hard requirement. Age identities don't work here —
    // the unwrap Lambda would need the age private key, which is a
    // bootstrap-the-bootstrap problem.
    if (!envelope.envelope?.keyId) {
      throw new Error(
        `\nClefAwsSecretsManager requires a KMS-envelope service identity.\n` +
          `\n` +
          `  identity:    ${props.identity}\n` +
          `  environment: ${props.environment}\n` +
          `\n` +
          `  The manifest entry for this identity does not have a 'kms:' block,\n` +
          `  so Clef produced an age-encrypted envelope.\n` +
          `\n` +
          `Fix one of:\n` +
          `  - Add a 'kms:' block to this identity/environment in clef.yaml\n` +
          `    (see: clef.sh/guide/service-identities#kms-envelope)\n` +
          `  - Use ClefArtifactBucket instead — consumers decrypt with their\n` +
          `    own age private key, no Lambda required.\n`,
      );
    }

    // Validate shape template references BEFORE touching CFN. Typos surface
    // at `cdk synth`, not at deploy, with a message listing valid keys.
    if (props.shape) {
      validateShape({
        shape: props.shape,
        availableKeys: keys,
        identity: props.identity,
        environment: props.environment,
      });
    }

    this.envelopeKey = kms.Key.fromKeyArn(this, "EnvelopeKey", envelope.envelope.keyId);

    this.secret = new sm.Secret(this, "Secret", {
      secretName: props.secretName ?? `clef/${props.identity}/${props.environment}`,
      description: `Clef-managed secret for ${props.identity}/${props.environment}`,
    });

    // ── Unwrap Lambda — singleton per stack ──────────────────────────────
    //
    // Multiple ClefAwsSecretsManager instances share this Lambda. The role
    // accumulates secretsmanager:PutSecretValue statements (one per secret)
    // but has NO baseline kms:Decrypt. All KMS authority is grant-mediated.

    const unwrapFn = new lambda.SingletonFunction(this, "UnwrapFn", {
      // Stable UUID — any construct instance with the same UUID reuses the
      // same underlying Lambda resource in the stack.
      uuid: "b7e0f8a1-clef-asm-unwrap-v1",
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "unwrap-lambda")),
      handler: "index.handler",
      timeout: Duration.minutes(2),
      description:
        "Clef ASM unwrap — decrypts KMS-envelope artifact and writes to Secrets Manager. " +
        "No baseline kms:Decrypt; authority is granted per-deploy and revoked after.",
    });

    this.secret.grantWrite(unwrapFn);

    if (!unwrapFn.role) {
      throw new Error("ClefAwsSecretsManager: unwrap Lambda has no role (should be unreachable).");
    }

    // ── GrantCreate + Revoke on replace ──────────────────────────────────

    const grantName = `clef-asm-${props.identity}-${props.environment}-${envelope.revision}`;

    const grantCreate = new cr.AwsCustomResource(this, "GrantCreate", {
      resourceType: "Custom::ClefAsmGrant",
      onCreate: {
        service: "KMS",
        action: "createGrant",
        parameters: {
          KeyId: this.envelopeKey.keyArn,
          GranteePrincipal: unwrapFn.role.roleArn,
          Operations: ["Decrypt"],
          Name: grantName,
        },
        // physicalResourceId = GrantId. When the envelope revision changes
        // between deploys, grantName changes, CFN sees new inputs → Replace
        // (Create new grant with new id → any depending resources update →
        // Delete old grant).
        physicalResourceId: cr.PhysicalResourceId.fromResponse("GrantId"),
      },
      onUpdate: {
        service: "KMS",
        action: "createGrant",
        parameters: {
          KeyId: this.envelopeKey.keyArn,
          GranteePrincipal: unwrapFn.role.roleArn,
          Operations: ["Decrypt"],
          Name: grantName,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse("GrantId"),
      },
      onDelete: {
        service: "KMS",
        action: "revokeGrant",
        parameters: {
          KeyId: this.envelopeKey.keyArn,
          GrantId: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        // CreateGrant scoped: can only grant Decrypt to the unwrap Lambda
        // role. An attacker who compromised the AwsCustomResource auto
        // Lambda cannot grant themselves Decrypt — the condition narrows
        // the grantee.
        new iam.PolicyStatement({
          actions: ["kms:CreateGrant"],
          resources: [this.envelopeKey.keyArn],
          conditions: {
            StringEquals: {
              "kms:GranteePrincipal": unwrapFn.role.roleArn,
            },
            "ForAllValues:StringEquals": {
              "kms:GrantOperations": ["Decrypt"],
            },
          },
        }),
        new iam.PolicyStatement({
          actions: ["kms:RevokeGrant"],
          resources: [this.envelopeKey.keyArn],
        }),
      ]),
    });

    // ── Unwrap invocation ────────────────────────────────────────────────
    //
    // Provider wraps the unwrap Lambda with the CFN Custom Resource
    // lifecycle framework. One Provider per construct — the Lambda behind
    // it is the singleton.

    const provider = new cr.Provider(this, "UnwrapProvider", {
      onEventHandler: unwrapFn,
    });

    const unwrap = new CustomResource(this, "Unwrap", {
      resourceType: "Custom::ClefAsmUnwrap",
      serviceToken: provider.serviceToken,
      properties: {
        SecretArn: this.secret.secretArn,
        EnvelopeJson: envelopeJson,
        Revision: envelope.revision,
        GrantToken: grantCreate.getResponseField("GrantToken"),
        ...(props.shape ? { Shape: props.shape } : {}),
      },
    });

    unwrap.node.addDependency(grantCreate);
  }

  /**
   * Grant `secretsmanager:GetSecretValue` on the wrapped secret. Consumers
   * that need per-JSON-field injection should use
   * `ecs.Secret.fromSecretsManager(secret.secret, "FIELD_NAME")` directly —
   * that is the idiomatic ASM pattern for JSON-shaped secrets and requires
   * the same grant.
   */
  public grantRead(grantable: IGrantable): Grant {
    return this.secret.grantRead(grantable) as Grant;
  }
}

export type { IGrantable } from "aws-cdk-lib/aws-iam";
