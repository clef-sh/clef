import * as crypto from "crypto";
import { Construct } from "constructs";
import { Stack, aws_iam as iam, custom_resources as cr } from "aws-cdk-lib";
import type { IKey } from "aws-cdk-lib/aws-kms";

/**
 * Stack-scoped singleton lookup of a KMS asymmetric key's public material via
 * `kms:GetPublicKey`, returned as base64 DER SPKI.
 *
 * Why singleton-per-(stack, signing-key ARN): multiple Clef constructs in the
 * same stack may share a signing key (one pipeline, many `ClefArtifactBucket`
 * instances). One `AwsCustomResource` per ARN keeps deploy round-trips and
 * IAM surface flat regardless of how many constructs reference the key. Two
 * different signing keys (same stack) get two separate resources.
 *
 * The dedup key is a SHA-256 of the resolved `keyArn`. Resolving via
 * `Stack.of(scope).resolve(...)` collapses CFN tokens to a stable
 * representation — and since the construct-side guard rejects unresolved
 * tokens before reaching here, the resolved form is in practice the literal
 * ARN string.
 *
 * IAM is scoped to `kms:GetPublicKey` on the specific key ARN. The auto-
 * provisioned `AwsCustomResource` Lambda has no other KMS authority.
 *
 * `outputPaths: ["PublicKey"]` narrows the response surface so other fields
 * (KeyUsage, KeySpec, etc.) don't leak into the CFN template. The framework
 * base64-encodes binary fields when building the response object, so
 * `getResponseField("PublicKey")` resolves to base64 DER SPKI at deploy time
 * — exactly what `verifySignature` expects in `CLEF_VERIFY_KEY`.
 */
export function getOrCreateVerifyKeyResource(
  scope: Construct,
  signingKey: IKey,
): cr.AwsCustomResource {
  const stack = Stack.of(scope);
  const resolvedArn = stack.resolve(signingKey.keyArn) as unknown;
  const dedupHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(resolvedArn))
    .digest("hex")
    .slice(0, 16);
  const id = `ClefVerifyKeyLookup-${dedupHash}`;

  const existing = stack.node.tryFindChild(id);
  if (existing) return existing as cr.AwsCustomResource;

  return new cr.AwsCustomResource(stack, id, {
    resourceType: "Custom::ClefVerifyKeyLookup",
    onCreate: {
      service: "KMS",
      action: "getPublicKey",
      parameters: { KeyId: signingKey.keyArn },
      // Static physical id — the public key is bound to the key ARN, which
      // is the dedup key. CFN won't replace this resource on stack updates
      // unless the key ARN itself changes (which forces a new logical id).
      physicalResourceId: cr.PhysicalResourceId.of(`clef-verify-key-${dedupHash}`),
      outputPaths: ["PublicKey"],
    },
    onUpdate: {
      service: "KMS",
      action: "getPublicKey",
      parameters: { KeyId: signingKey.keyArn },
      physicalResourceId: cr.PhysicalResourceId.of(`clef-verify-key-${dedupHash}`),
      outputPaths: ["PublicKey"],
    },
    policy: cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: ["kms:GetPublicKey"],
        resources: [signingKey.keyArn],
      }),
    ]),
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
