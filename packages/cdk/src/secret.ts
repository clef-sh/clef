import * as path from "path";
import { Construct } from "constructs";
import {
  Annotations,
  CustomResource,
  Duration,
  Names,
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
import { validateShape, type RefsMap } from "./shape-template";

/**
 * Target shape for a {@link ClefSecret}. The value determines what lives in
 * `SecretString`:
 *
 *   - **Undefined** — passthrough. The decrypted envelope JSON is written
 *     to ASM 1:1 (nested by namespace). Best for consumers that already
 *     expect the envelope's native shape.
 *
 *   - **`string`** — single-value secret. The string is run through
 *     `{{name}}` interpolation and written to `SecretString` verbatim (no
 *     JSON wrapping). Best for connection strings, single API tokens,
 *     opaque credentials.
 *
 *   - **`Record<string, string>`** — JSON secret. Each value is a template
 *     (literal or `{{name}}`-interpolated); the construct writes a JSON
 *     object with the mapped fields. Best for ECS
 *     `Secret.fromSecretsManager(…, "FIELD")`, Lambda fetch-and-parse, etc.
 */
export type ClefSecretShape = string | Record<string, string>;

/** Props for {@link ClefSecret}. */
export interface ClefSecretProps {
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
   * Shape of the ASM secret value. See {@link ClefSecretShape}.
   *
   * Placeholders use `{{name}}` syntax; each name is resolved via {@link refs}.
   * Unknown placeholders or unresolvable refs fail loud at synth with a
   * message listing valid aliases / namespaces / keys and a "did you mean?"
   * suggestion for close matches.
   */
  readonly shape?: ClefSecretShape;
  /**
   * Map of `{{placeholder}}` aliases to `(namespace, key)` references in the
   * Clef envelope. Required when `shape` contains any placeholders.
   *
   *     refs: {
   *       user: { namespace: 'database', key: 'DB_USER' },
   *       pass: { namespace: 'database', key: 'DB_PASSWORD' },
   *     }
   */
  readonly refs?: RefsMap;
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
 * Deliver a Clef-packed artifact into an AWS Secrets Manager secret. One
 * construct instance = one ASM secret. Instantiate multiple times for
 * multiple secrets (pack-helper is memoized per identity/env, so the synth
 * overhead does not scale with construct count).
 *
 * Architecture — two Custom Resources orchestrate the unwrap:
 *
 *   1. **GrantCreate** — `kms:CreateGrant` authorises the unwrap Lambda to
 *      `Decrypt` the envelope's wrapped DEK, for this deploy only. The
 *      grant token short-circuits propagation delay. Grant is scoped to
 *      `GranteePrincipal = unwrap Lambda role` and `Operations = [Decrypt]`.
 *      On stack update that replaces the resource (new envelope revision
 *      = new physical id), CFN calls `RevokeGrant` on the old grant.
 *
 *   2. **Unwrap** — invokes a stack-wide singleton Lambda with the envelope
 *      JSON, shape template, secret ARN, and grant token. Lambda decrypts
 *      via KMS (using the just-minted grant), AES-GCM unwraps the
 *      ciphertext, applies the shape, and calls
 *      `secretsmanager:PutSecretValue`.
 *
 * Security posture:
 *   - The unwrap Lambda has **no baseline `kms:Decrypt`**. Its only KMS
 *     authority is the short-lived grant, minted per deploy, revoked on
 *     the next deploy's replace.
 *   - The `AwsCustomResource` auto Lambda has `kms:CreateGrant` and
 *     `kms:RevokeGrant` — but constrained via `kms:GranteePrincipal` and
 *     `kms:GrantOperations` conditions so it can *only* grant Decrypt to
 *     the unwrap Lambda's role.
 *   - The envelope JSON lives in CFN resource properties after deploy —
 *     it's ciphertext, safe anywhere (same threat model Clef already
 *     assumes).
 *
 * IAM is explicit by design: {@link grantRead} binds `secretsmanager:
 * GetSecretValue` only.
 */
export class ClefSecret extends Construct {
  /** The ASM secret receiving the unwrapped value. */
  public readonly secret: ISecret;
  /** KMS key that wraps the envelope's DEK (from `clef.yaml` service-identity config). */
  public readonly envelopeKey: IKey;
  /** Absolute path to the resolved `clef.yaml`, for debugging. */
  public readonly manifestPath: string;

  constructor(scope: Construct, id: string, props: ClefSecretProps) {
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

    // KMS-envelope is a hard requirement. Age identities don't work here —
    // the unwrap Lambda would need the age private key, which is a
    // bootstrap-the-bootstrap problem.
    if (!envelope.envelope?.keyId) {
      throw new Error(
        `\nClefSecret requires a KMS-envelope service identity.\n` +
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
    if (props.shape !== undefined) {
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
    }

    this.envelopeKey = kms.Key.fromKeyArn(this, "EnvelopeKey", envelope.envelope.keyId);

    this.secret = new sm.Secret(this, "Secret", {
      secretName: props.secretName ?? `clef/${props.identity}/${props.environment}`,
      description: `Clef-managed secret for ${props.identity}/${props.environment}`,
    });

    // ── Unwrap Lambda — singleton per stack ──────────────────────────────
    //
    // Multiple ClefSecret instances share this Lambda. The role accumulates
    // secretsmanager:PutSecretValue statements (one per secret) but has NO
    // baseline kms:Decrypt. All KMS authority is grant-mediated.

    const unwrapFn = new lambda.SingletonFunction(this, "UnwrapFn", {
      // Stable UUID shared with ClefParameter — both constructs dispatch
      // through the same handler, so they use the same singleton Lambda
      // within a stack. Changing the UUID is a breaking change for
      // in-place stack updates (CFN would replace the resource).
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

    this.secret.grantWrite(unwrapFn);

    if (!unwrapFn.role) {
      throw new Error("ClefSecret: unwrap Lambda has no role (should be unreachable).");
    }

    // ── GrantCreate + Revoke on replace ──────────────────────────────────

    // Suffix with a construct-scoped unique token so two ClefSecret
    // constructs sharing identity/environment/revision (and the singleton
    // unwrap Lambda role) don't collide on KMS's identical-grant rule —
    // which would return the same GrantId to both AwsCustomResources and
    // cause the second revoke to 404 on stack delete/replace.
    const grantName = `clef-secret-${props.identity}-${props.environment}-${envelope.revision}-${Names.uniqueResourceName(this, { maxLength: 32 })}`;

    const grantCreate = new cr.AwsCustomResource(this, "GrantCreate", {
      resourceType: "Custom::ClefSecretGrant",
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
      resourceType: "Custom::ClefSecretUnwrap",
      serviceToken: provider.serviceToken,
      properties: {
        Target: "secret",
        SecretArn: this.secret.secretArn,
        EnvelopeJson: envelopeJson,
        Revision: envelope.revision,
        GrantToken: grantCreate.getResponseField("GrantToken"),
        ...(props.shape !== undefined ? { Shape: props.shape } : {}),
        ...(props.refs !== undefined ? { Refs: props.refs } : {}),
      },
    });

    unwrap.node.addDependency(grantCreate);
  }

  /**
   * Grant `secretsmanager:GetSecretValue` on the wrapped secret. For JSON
   * shapes, ECS consumers can pull individual fields via
   * `ecs.Secret.fromSecretsManager(clefSecret.secret, "FIELD_NAME")` —
   * same grant, no extra IAM surface.
   */
  public grantRead(grantable: IGrantable): Grant {
    return this.secret.grantRead(grantable) as Grant;
  }
}

export type { IGrantable } from "aws-cdk-lib/aws-iam";
