import * as crypto from "crypto";
import * as path from "path";
import { Construct } from "constructs";
import {
  Arn,
  ArnFormat,
  CustomResource,
  Duration,
  Stack,
  aws_iam as iam,
  aws_lambda as lambda,
  custom_resources as cr,
} from "aws-cdk-lib";
import type { IKey } from "aws-cdk-lib/aws-kms";

/**
 * Stack-scoped singleton lookup of a KMS asymmetric key's public material via
 * `kms:GetPublicKey`, returned as base64 DER SPKI.
 *
 * Why a custom Lambda instead of `cr.AwsCustomResource`: the framework's
 * SDK-call wrapper flattens AWS SDK responses and, depending on the SDK v3
 * version it pulls in, serializes binary fields (the PublicKey Uint8Array)
 * inefficiently — pushing the CFN response past the 4 KB hard limit and
 * failing with "Response object is too long". Owning the Lambda lets us
 * base64-encode and emit a guaranteed-tiny `{ PublicKey: <string> }`.
 *
 * Why singleton-per-(stack, signing-key ARN): multiple Clef constructs in the
 * same stack may share a signing key (one pipeline, many `ClefArtifactBucket`
 * instances). One `CustomResource` per ARN keeps deploy round-trips and
 * IAM surface flat regardless of how many constructs reference the key. Two
 * different signing keys (same stack) get two separate resources but share
 * the same Lambda + Provider; the Lambda role accumulates per-key IAM
 * statements.
 *
 * The dedup key is a SHA-256 of the resolved `keyArn`. Resolving via
 * `Stack.of(scope).resolve(...)` collapses CFN tokens to a stable
 * representation — and since the construct-side guard rejects unresolved
 * tokens before reaching here, the resolved form is in practice the literal
 * ARN string.
 *
 * IAM scoping depends on whether the input is a key ARN or an alias ARN:
 *
 * - **Key ARN** (`...:key/<id>`): direct `Resource: <key-arn>` grant. The
 *   IAM resource matches the ARN that KMS evaluates against at runtime.
 *
 * - **Alias ARN** (`...:alias/<name>`): `Resource: <key-wildcard>` in the
 *   same account+region, narrowed by a `kms:RequestAlias` condition that
 *   matches the alias name. This is the only correct pattern — granting on
 *   an alias ARN directly *does not* authorize key operations because AWS
 *   evaluates IAM against the resolved key ARN, not the alias used in the
 *   request. The condition makes the grant follow alias re-targeting, so
 *   rotating the underlying key needs no stack changes.
 */
export function getOrCreateVerifyKeyResource(scope: Construct, signingKey: IKey): CustomResource {
  const stack = Stack.of(scope);
  const resolvedArn = stack.resolve(signingKey.keyArn) as unknown;
  const dedupHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(resolvedArn))
    .digest("hex")
    .slice(0, 16);
  const id = `ClefVerifyKeyLookup-${dedupHash}`;

  const existing = stack.node.tryFindChild(id);
  if (existing) return existing as CustomResource;

  const { provider, role } = getOrCreateVerifyKeyInfra(stack);

  // Add the per-key GetPublicKey grant to the singleton role. Different
  // signing keys in the same stack accumulate separate statements here.
  role.addToPrincipalPolicy(buildGetPublicKeyStatement(stack, signingKey.keyArn));

  return new CustomResource(stack, id, {
    resourceType: "Custom::ClefVerifyKeyLookup",
    serviceToken: provider.serviceToken,
    properties: {
      KeyId: signingKey.keyArn,
    },
  });
}

interface VerifyKeyInfra {
  provider: cr.Provider;
  role: iam.IRole;
}

/**
 * Stack-scoped singleton: one Lambda + one Provider, shared across all
 * verify-key custom resources in the stack. Multiple signing keys reuse
 * this infrastructure; only the per-key IAM statement and the
 * CustomResource itself are unique.
 */
function getOrCreateVerifyKeyInfra(stack: Stack): VerifyKeyInfra {
  const providerId = "ClefVerifyKeyProvider";
  const existingProvider = stack.node.tryFindChild(providerId);
  if (existingProvider) {
    const fn = stack.node.findChild("ClefVerifyKeyFn") as lambda.SingletonFunction;
    if (!fn.role) {
      throw new Error(
        "ClefVerifyKeyFn has no role (should be unreachable — SingletonFunction always has one).",
      );
    }
    return { provider: existingProvider as cr.Provider, role: fn.role };
  }

  const fn = new lambda.SingletonFunction(stack, "ClefVerifyKeyFn", {
    // Stable UUID — changing this is a breaking change for in-place stack
    // updates (CFN would replace the Lambda resource).
    uuid: "5e8c2c4a-clef-verify-key-v1",
    runtime: lambda.Runtime.NODEJS_20_X,
    code: lambda.Code.fromAsset(path.resolve(__dirname, "verify-key-lambda")),
    handler: "index.handler",
    timeout: Duration.seconds(30),
    description:
      "Clef CDK verify-key — fetches the public material of a KMS asymmetric " +
      "signing key and returns it as base64 DER SPKI for CLEF_AGENT_VERIFY_KEY.",
  });

  if (!fn.role) {
    throw new Error(
      "ClefVerifyKeyFn has no role (should be unreachable — SingletonFunction always has one).",
    );
  }

  const provider = new cr.Provider(stack, providerId, {
    onEventHandler: fn,
  });

  return { provider, role: fn.role };
}

/**
 * Build the IAM statement that grants `kms:GetPublicKey` on the signing key.
 * Switches between direct-resource and alias-condition forms based on
 * whether the input is a key ARN or an alias ARN.
 */
function buildGetPublicKeyStatement(stack: Stack, keyArn: string): iam.PolicyStatement {
  const components = Arn.split(keyArn, ArnFormat.SLASH_RESOURCE_NAME);
  if (components.resource === "alias") {
    // Resource scoped to keys in the same account+region, narrowed by
    // `kms:RequestAlias`. AWS evaluates IAM against the resolved key ARN
    // at runtime, so a `Resource: <alias-arn>` grant would never match;
    // the condition is what makes alias-scoped access work.
    const keyWildcard = Arn.format({ ...components, resource: "key", resourceName: "*" }, stack);
    return new iam.PolicyStatement({
      actions: ["kms:GetPublicKey"],
      resources: [keyWildcard],
      conditions: {
        StringEquals: {
          "kms:RequestAlias": `alias/${components.resourceName}`,
        },
      },
    });
  }
  return new iam.PolicyStatement({
    actions: ["kms:GetPublicKey"],
    resources: [keyArn],
  });
}

/**
 * Test-only hook. Strips the singleton verify-key resources from a stack so
 * each test starts fresh. Production synth runs in a short-lived process and
 * doesn't need this.
 *
 * Implemented as a free function to avoid a stateful module-level cache —
 * the singleton lives in the CDK construct tree, not in module state.
 */
export const VERIFY_KEY_LOOKUP_RESOURCE_TYPE = "Custom::ClefVerifyKeyLookup";
