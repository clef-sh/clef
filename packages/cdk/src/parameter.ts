import * as path from "path";
import { Construct } from "constructs";
import {
  Annotations,
  CustomResource,
  Duration,
  Names,
  Stack,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_ssm as ssm,
  custom_resources as cr,
} from "aws-cdk-lib";
import type { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { IParameter } from "aws-cdk-lib/aws-ssm";
import { resolveManifestPath } from "./manifest-path";
import { invokePackHelper } from "./pack-invoker";
import { validateShape, type RefsMap } from "./shape-template";

/**
 * SSM parameter tier. Matches the CloudFormation string values accepted by
 * `PutParameter`. `Standard` (the default) is free and holds values up to
 * 4 KB. `Advanced` is chargeable and holds up to 8 KB plus policies.
 * `Intelligent-Tiering` lets AWS pick per parameter.
 */
export type ClefParameterTier = "Standard" | "Advanced" | "Intelligent-Tiering";

/** Props for {@link ClefParameter}. */
export interface ClefParameterProps {
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
   * Template for the parameter's single value. Placeholders use `{{name}}`
   * syntax; each name is resolved via {@link refs}.
   *
   *     shape: "postgres://{{user}}:{{pass}}@{{host}}:5432/app"
   *
   * Unknown placeholders or unresolvable refs fail loud at synth with the
   * same error format used by {@link ClefSecret}.
   */
  readonly shape: string;
  /**
   * Map of `{{placeholder}}` aliases to `(namespace, key)` references in the
   * Clef envelope. Required when `shape` contains any placeholders.
   */
  readonly refs?: RefsMap;
  /**
   * SSM parameter name. Defaults to
   * `/clef/<identity>/<environment>/<constructId>`.
   */
  readonly parameterName?: string;
  /**
   * SSM parameter type. `"SecureString"` (default) encrypts at rest with a
   * KMS key; `"String"` stores plaintext. SecureString matches Clef's
   * encryption-at-rest posture and is almost always the right choice.
   */
  readonly type?: "String" | "SecureString";
  /** SSM parameter tier. Default: `"Standard"`. */
  readonly tier?: ClefParameterTier;
  /**
   * Customer-managed KMS key used to encrypt the parameter **at rest** —
   * orthogonal to the envelope KMS key (which wraps the packed artifact's
   * DEK). Only relevant for `SecureString`. When omitted, SSM uses its
   * default `alias/aws/ssm`.
   */
  readonly parameterKmsKey?: IKey;
}

interface EnvelopeView {
  revision: string;
  envelope?: {
    provider?: string;
    keyId?: string;
  };
}

/**
 * Deliver a Clef-packed value into an AWS Systems Manager (SSM) Parameter
 * Store parameter. One construct instance = one parameter. Instantiate
 * multiple times for multiple parameters — the pack-helper is memoized per
 * `(manifest, identity, environment)`, so the synth overhead does not
 * scale with construct count.
 *
 * Shares the unwrap Lambda and per-deploy KMS grant lifecycle with
 * {@link ClefSecret}; see that construct's docs for the full security
 * posture explanation. The only structural differences:
 *
 *   - SSM parameters hold a **single value**, so `shape` is required and
 *     must be a string template (Record shapes would be meaningless here).
 *   - The Lambda owns the parameter lifecycle entirely (create / update /
 *     delete). CloudFormation does not manage the `AWS::SSM::Parameter`
 *     resource directly because CFN cannot create `SecureString`
 *     parameters — it has been a known limitation since SSM launched.
 *   - At-rest encryption uses a separate KMS key (SSM's default
 *     `alias/aws/ssm`, or a custom key via `parameterKmsKey`). This is
 *     independent of the envelope KMS key used during the pack step.
 */
export class ClefParameter extends Construct {
  /** The SSM parameter receiving the unwrapped value. */
  public readonly parameter: IParameter;
  /** KMS key that wraps the envelope's DEK (from `clef.yaml`). */
  public readonly envelopeKey: IKey;
  /** Absolute path to the resolved `clef.yaml`, for debugging. */
  public readonly manifestPath: string;
  /** Resolved SSM parameter name (derived or explicit). */
  public readonly parameterName: string;

  private readonly parameterType: "String" | "SecureString";
  private readonly atRestKey?: IKey;

  constructor(scope: Construct, id: string, props: ClefParameterProps) {
    super(scope, id);

    this.manifestPath = resolveManifestPath(props.manifest);

    const { envelopeJson, keysByNamespace } = invokePackHelper({
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

    // KMS-envelope is a hard requirement. Same rationale as ClefSecret —
    // the unwrap Lambda would need an age private key it cannot bootstrap
    // to itself.
    if (!envelope.envelope?.keyId) {
      throw new Error(
        `\nClefParameter requires a KMS-envelope service identity.\n` +
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

    const result = validateShape({
      shape: props.shape,
      refs: props.refs,
      availableKeys: keysByNamespace,
      identity: props.identity,
      environment: props.environment,
    });
    for (const w of result.warnings) {
      Annotations.of(this).addWarning(w);
    }

    this.envelopeKey = kms.Key.fromKeyArn(this, "EnvelopeKey", envelope.envelope.keyId);
    this.parameterType = props.type ?? "SecureString";
    this.atRestKey = props.parameterKmsKey;
    this.parameterName =
      props.parameterName ?? `/clef/${props.identity}/${props.environment}/${id}`;

    // Construct the parameter ARN from the resolved name so we can scope
    // IAM statements without having CFN create the parameter itself.
    const parameterArn = Stack.of(this).formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: this.parameterName.startsWith("/")
        ? this.parameterName.substring(1)
        : this.parameterName,
    });

    // Expose an IParameter reference so consumers can call grantRead /
    // grantWrite / etc. the same way they would with native SSM constructs.
    this.parameter = ssm.StringParameter.fromStringParameterAttributes(this, "ParameterRef", {
      parameterName: this.parameterName,
    });

    // ── Shared unwrap Lambda (singleton across ClefSecret + ClefParameter) ──

    const unwrapFn = new lambda.SingletonFunction(this, "UnwrapFn", {
      // Same UUID as ClefSecret — both constructs flow through the same
      // handler via the `Target` dispatch property.
      uuid: "b7e0f8a1-clef-unwrap-v1",
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "unwrap-lambda")),
      handler: "index.handler",
      timeout: Duration.minutes(2),
      description:
        "Clef CDK unwrap — decrypts KMS-envelope artifact, applies shape, and writes " +
        "to Secrets Manager or SSM Parameter Store. No baseline kms:Decrypt; authority " +
        "is granted per-deploy and revoked after.",
    });

    if (!unwrapFn.role) {
      throw new Error("ClefParameter: unwrap Lambda has no role (should be unreachable).");
    }

    // IAM: Put and Delete scoped to this specific parameter. Each
    // ClefParameter instance accumulates its own statements on the
    // singleton Lambda's role — attackers who pivot into the Lambda can
    // only touch parameters the stack explicitly manages.
    unwrapFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:PutParameter", "ssm:DeleteParameter"],
        resources: [parameterArn],
      }),
    );

    if (this.parameterType === "SecureString" && this.atRestKey) {
      // Custom CMK needs explicit Encrypt permission. The default
      // `alias/aws/ssm` key is AWS-managed and grants to the account via
      // its key policy — no IAM statement required.
      this.atRestKey.grantEncrypt(unwrapFn);
    }

    // ── Per-deploy KMS grant for envelope Decrypt ────────────────────────

    // Suffix with a construct-scoped unique token so two ClefParameter
    // constructs sharing identity/environment/revision (and the singleton
    // unwrap Lambda role) don't collide on KMS's identical-grant rule —
    // which would return the same GrantId to both AwsCustomResources and
    // cause the second revoke to 404 on stack delete/replace.
    const grantName = `clef-parameter-${props.identity}-${props.environment}-${envelope.revision}-${Names.uniqueResourceName(this, { maxLength: 32 })}`;

    const grantCreate = new cr.AwsCustomResource(this, "GrantCreate", {
      resourceType: "Custom::ClefParameterGrant",
      onCreate: {
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

    const provider = new cr.Provider(this, "UnwrapProvider", {
      onEventHandler: unwrapFn,
    });

    const unwrap = new CustomResource(this, "Unwrap", {
      resourceType: "Custom::ClefParameterUnwrap",
      serviceToken: provider.serviceToken,
      properties: {
        Target: "parameter",
        ParameterName: this.parameterName,
        ParameterType: this.parameterType,
        ...(props.tier ? { ParameterTier: props.tier } : {}),
        ...(this.atRestKey ? { ParameterKmsKeyId: this.atRestKey.keyArn } : {}),
        EnvelopeJson: envelopeJson,
        Revision: envelope.revision,
        GrantToken: grantCreate.getResponseField("GrantToken"),
        Shape: props.shape,
        ...(props.refs !== undefined ? { Refs: props.refs } : {}),
      },
    });

    unwrap.node.addDependency(grantCreate);
  }

  /**
   * Grant read access: `ssm:GetParameter*` on the parameter.
   *
   * For `SecureString` parameters backed by a **custom** `parameterKmsKey`,
   * this also grants `kms:Decrypt` on that key. The `alias/aws/ssm`
   * default is an AWS-managed key — CDK cannot attach grants to aliased
   * references, so consumers that need to decrypt an aws/ssm-backed
   * SecureString must already have `kms:Decrypt` via account-level policy
   * (which AWS SSM integrations typically grant automatically). This
   * matches the native `ssm.StringParameter.grantRead` behaviour.
   */
  public grantRead(grantable: IGrantable): Grant {
    const grant = this.parameter.grantRead(grantable);
    if (this.parameterType === "SecureString" && this.atRestKey) {
      this.atRestKey.grantDecrypt(grantable);
    }
    return grant as Grant;
  }
}

export type { IGrantable } from "aws-cdk-lib/aws-iam";
