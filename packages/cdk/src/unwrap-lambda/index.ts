/**
 * CloudFormation Custom Resource handler for {@link ClefAwsSecretsManager}.
 *
 * Invoked once per deploy (Create or Update event) with:
 *   - EnvelopeJson:  the full PackedArtifact JSON, passed as a CR property
 *   - Shape:         optional `{ field: "${CLEF_KEY}" }` mapping
 *   - SecretArn:     ASM secret to write into
 *   - GrantToken:    short-lived grant token from the preceding grant-create CR
 *   - Revision:      envelope revision, threaded through for idempotency
 *
 * Security posture:
 *   - Lambda role has NO baseline `kms:Decrypt`. Authority is granted per-deploy
 *     via `kms:CreateGrant` (sibling CR), minted as a time-limited token, used
 *     once here, then revoked by a third sibling CR. Between deploys the
 *     Lambda is cold and powerless.
 *   - Plaintext DEK + plaintext values live only in this invocation's memory.
 *     DEK buffer is zeroed after use (best-effort; Node GC may retain copies).
 *   - Rejects age-envelope artifacts defensively (synth-time validation
 *     should have caught it, but defence-in-depth).
 */
import * as crypto from "crypto";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * ${IDENTIFIER} reference grammar. Duplicated from
 * `packages/cdk/src/shape-template.ts` — the Lambda asset is bundled in
 * isolation so it can't import sibling dist files. The two copies MUST stay
 * in sync; synth-time validation runs against the authoritative copy, this
 * is the runtime application.
 */
const REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(REF_PATTERN, (_, name: string) => {
    if (!(name in values)) {
      throw new Error(
        `Template reference \${${name}} has no matching value in the envelope. ` +
          `Synth-time validation should have caught this — the CDK package versions ` +
          `may be out of sync.`,
      );
    }
    return values[name];
  });
}

type ShapeTemplate = string | Record<string, string>;

function applyShape(
  shape: ShapeTemplate,
  values: Record<string, string>,
): string | Record<string, string> {
  if (typeof shape === "string") {
    return applyTemplate(shape, values);
  }
  const out: Record<string, string> = {};
  for (const [field, template] of Object.entries(shape)) {
    out[field] = applyTemplate(template, values);
  }
  return out;
}

interface KmsEnvelopeHeader {
  provider: string;
  keyId: string;
  wrappedKey: string;
  algorithm: string;
  iv: string;
  authTag: string;
}

interface PackedArtifact {
  version: 1;
  identity: string;
  environment: string;
  revision: string;
  ciphertext: string;
  envelope?: KmsEnvelopeHeader;
}

interface OnEventRequest {
  RequestType: "Create" | "Update" | "Delete";
  ResourceProperties: {
    SecretArn: string;
    EnvelopeJson: string;
    Revision: string;
    GrantToken: string;
    Shape?: ShapeTemplate;
  };
  PhysicalResourceId?: string;
}

interface OnEventResponse {
  PhysicalResourceId?: string;
  Data?: Record<string, string>;
}

const kms = new KMSClient({});
const sm = new SecretsManagerClient({});

export async function handler(event: OnEventRequest): Promise<OnEventResponse> {
  if (event.RequestType === "Delete") {
    // The ASM secret is a separate CFN-managed resource; CFN handles its
    // deletion on stack teardown. The grant-revoke sibling CR cleans up KMS
    // authorization. This handler has nothing to undo.
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  const { SecretArn, EnvelopeJson, Revision, GrantToken, Shape } = event.ResourceProperties;

  const envelope = JSON.parse(EnvelopeJson) as PackedArtifact;
  if (!envelope.envelope) {
    throw new Error(
      `ClefSecret requires a KMS-envelope artifact, but envelope for ` +
        `'${envelope.identity}/${envelope.environment}' has no envelope header. ` +
        `Age-only identities are not supported by this construct.`,
    );
  }

  // 1. KMS Decrypt the wrapped DEK. GrantToken short-circuits the grant
  //    propagation delay — the sibling grant-create CR minted it just now.
  const decryptResult = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.envelope.wrappedKey, "base64"),
      KeyId: envelope.envelope.keyId,
      GrantTokens: [GrantToken],
    }),
  );
  if (!decryptResult.Plaintext) {
    throw new Error("KMS Decrypt returned no plaintext");
  }
  const dek = Buffer.from(decryptResult.Plaintext);

  try {
    // 2. AES-256-GCM unwrap the envelope ciphertext using the DEK.
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const iv = Buffer.from(envelope.envelope.iv, "base64");
    const authTag = Buffer.from(envelope.envelope.authTag, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAuthTag(authTag);
    const plaintextBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const values = JSON.parse(plaintextBuf.toString("utf-8")) as Record<string, string>;

    // 3. Apply shape template if provided, else passthrough.
    //    - Shape is a string     → single-value SecretString (no JSON wrap)
    //    - Shape is an object    → JSON SecretString with mapped fields
    //    - Shape is undefined    → JSON SecretString with envelope's native keys
    const final = Shape !== undefined ? applyShape(Shape, values) : values;
    const secretString = typeof final === "string" ? final : JSON.stringify(final);

    // 4. Write to ASM. Replaces the secret's current value with a new version
    //    (keeps history if the user has ASM versioning enabled).
    await sm.send(
      new PutSecretValueCommand({
        SecretId: SecretArn,
        SecretString: secretString,
      }),
    );
  } finally {
    // Best-effort plaintext hygiene. Node can GC earlier copies we don't own,
    // but at least the buffer we hold is zeroed before return.
    dek.fill(0);
  }

  return {
    // PhysicalResourceId includes the revision so CFN detects a change when
    // the envelope is re-packed with new values.
    PhysicalResourceId: `${SecretArn}#${Revision}`,
    Data: { Revision },
  };
}
