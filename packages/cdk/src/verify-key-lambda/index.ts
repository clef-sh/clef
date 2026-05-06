/**
 * CloudFormation Custom Resource handler for `Custom::ClefVerifyKeyLookup`.
 * Fetches a KMS asymmetric key's public material via `kms:GetPublicKey` and
 * returns it as a base64-encoded DER SPKI string for the Clef agent's
 * `CLEF_AGENT_VERIFY_KEY` env var.
 *
 * Why a custom Lambda instead of the framework's `AwsCustomResource`:
 * `AwsCustomResource` flattens the AWS SDK response for CFN, and certain
 * SDK v3 versions serialize binary fields (the PublicKey Uint8Array) as
 * numeric-keyed entries (`{"PublicKey.0": 48, "PublicKey.1": 89, ...}`),
 * which combined with CFN response wrapping pushes the response past CFN's
 * 4 KB hard limit ("Response object is too long"). Owning the Lambda lets
 * us emit a guaranteed-tiny `{ PublicKey: <base64-string> }` regardless of
 * which SDK version is bundled.
 *
 * ResourceProperties:
 *   - KeyId: the KMS key ARN (key or alias) to call GetPublicKey against
 *
 * Returns:
 *   - Data.PublicKey: base64-encoded DER SPKI public key
 *   - PhysicalResourceId: stable id derived from KeyId so updates that
 *     don't change the key don't trigger replace
 */
import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";

interface CfnEvent {
  RequestType: "Create" | "Update" | "Delete";
  PhysicalResourceId?: string;
  ResourceProperties: {
    ServiceToken?: string;
    KeyId?: string;
  };
}

interface CfnResponse {
  PhysicalResourceId: string;
  Data?: { PublicKey: string };
}

export async function handler(event: CfnEvent): Promise<CfnResponse> {
  if (event.RequestType === "Delete") {
    // Read-only resource — nothing to clean up. CFN requires a physical id
    // so it can match the delete against the create.
    return { PhysicalResourceId: event.PhysicalResourceId ?? "clef-verify-key-deleted" };
  }

  const keyId = event.ResourceProperties.KeyId;
  if (!keyId) {
    throw new Error("ClefVerifyKeyLookup: ResourceProperties.KeyId is required");
  }

  const kms = new KMSClient({});
  const response = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));

  if (!response.PublicKey) {
    throw new Error(
      `ClefVerifyKeyLookup: KMS returned no PublicKey for ${keyId}. ` +
        "The key must be asymmetric (KeyUsage SIGN_VERIFY) to expose a public key.",
    );
  }

  // Buffer.from on a Uint8Array shares memory; toString('base64') copies once.
  // Result is the canonical base64 DER SPKI form the Clef agent expects.
  const publicKeyB64 = Buffer.from(response.PublicKey).toString("base64");

  return {
    PhysicalResourceId: `clef-verify-key-${keyId}`,
    Data: { PublicKey: publicKeyB64 },
  };
}
