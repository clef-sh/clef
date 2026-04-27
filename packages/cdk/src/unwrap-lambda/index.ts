/**
 * CloudFormation Custom Resource handler shared by {@link ClefSecret} and
 * {@link ClefParameter}. Dispatches on the `Target` property:
 *
 *   - Target: "secret"    → decrypts and calls PutSecretValue on AWS
 *                           Secrets Manager (CFN owns the secret resource;
 *                           Lambda owns the value).
 *   - Target: "parameter" → decrypts and calls PutParameter / DeleteParameter
 *                           on SSM Parameter Store (Lambda owns the full
 *                           parameter lifecycle — SecureString cannot be
 *                           created via CloudFormation).
 *
 * Common ResourceProperties:
 *   - EnvelopeJson:  the full PackedArtifact JSON
 *   - Shape:         optional template — string for a scalar, record for JSON
 *   - GrantToken:    short-lived KMS grant token from the sibling grant CR
 *   - Revision:      envelope revision, used in PhysicalResourceId
 *
 * Security posture:
 *   - Lambda role has NO baseline `kms:Decrypt`. Authority is granted
 *     per-deploy via `kms:CreateGrant` (sibling CR), minted as a time-
 *     limited token, used here, then revoked by the grant CR's onDelete.
 *   - Plaintext DEK + plaintext values live only in this invocation's
 *     memory. DEK buffer is zeroed after use.
 *   - Rejects age-envelope artifacts defensively.
 */
import * as crypto from "crypto";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * `{{name}}` placeholder grammar with `\{\{` / `\}\}` escapes. Duplicated
 * from `packages/cdk/src/shape-template.ts` — the Lambda asset is bundled in
 * isolation so it can't import sibling dist files. The two copies MUST stay
 * in sync; synth-time validation runs against the authoritative copy, this
 * is the runtime application.
 */
const PATTERN = /\\\{\\\{|\\\}\\\}|\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

interface ClefRef {
  namespace: string;
  key: string;
}
type RefsMap = Record<string, ClefRef>;

function applyTemplate(
  template: string,
  refs: RefsMap | undefined,
  values: Record<string, Record<string, string>>,
): string {
  return template.replace(PATTERN, (match, name: string | undefined) => {
    if (match === "\\{\\{") return "{{";
    if (match === "\\}\\}") return "}}";
    if (name === undefined) {
      throw new Error(`Internal: shape regex matched '${match}' without a name capture.`);
    }
    const ref = refs?.[name];
    if (!ref) {
      throw new Error(
        `Template placeholder {{${name}}} has no matching refs entry. ` +
          `Synth-time validation should have caught this — the CDK package versions ` +
          `may be out of sync.`,
      );
    }
    const value = values[ref.namespace]?.[ref.key];
    if (value === undefined) {
      throw new Error(
        `Template placeholder {{${name}}} → ${ref.namespace}/${ref.key} not present in ` +
          `the decrypted envelope.`,
      );
    }
    return value;
  });
}

type ShapeTemplate = string | Record<string, string>;

function applyShape(
  shape: ShapeTemplate,
  refs: RefsMap | undefined,
  values: Record<string, Record<string, string>>,
): string | Record<string, string> {
  if (typeof shape === "string") {
    return applyTemplate(shape, refs, values);
  }
  const out: Record<string, string> = {};
  for (const [field, template] of Object.entries(shape)) {
    out[field] = applyTemplate(template, refs, values);
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

interface SecretResourceProperties {
  Target: "secret";
  SecretArn: string;
  EnvelopeJson: string;
  Revision: string;
  GrantToken: string;
  Shape?: ShapeTemplate;
  Refs?: RefsMap;
}

interface ParameterResourceProperties {
  Target: "parameter";
  ParameterName: string;
  ParameterType: "String" | "SecureString";
  ParameterTier?: "Standard" | "Advanced" | "Intelligent-Tiering";
  ParameterKmsKeyId?: string;
  EnvelopeJson: string;
  Revision: string;
  GrantToken: string;
  Shape?: ShapeTemplate;
  Refs?: RefsMap;
}

type ResourceProperties = SecretResourceProperties | ParameterResourceProperties;

interface OnEventRequest {
  RequestType: "Create" | "Update" | "Delete";
  ResourceProperties: ResourceProperties;
  OldResourceProperties?: ResourceProperties;
  PhysicalResourceId?: string;
}

interface OnEventResponse {
  PhysicalResourceId?: string;
  Data?: Record<string, string>;
}

const kms = new KMSClient({});
const sm = new SecretsManagerClient({});

export async function handler(event: OnEventRequest): Promise<OnEventResponse> {
  const target = event.ResourceProperties.Target;
  if (target === "parameter") {
    return handleParameter(event);
  }
  return handleSecret(event);
}

async function handleSecret(event: OnEventRequest): Promise<OnEventResponse> {
  const props = event.ResourceProperties as SecretResourceProperties;

  if (event.RequestType === "Delete") {
    // The ASM secret is a separate CFN-managed resource; CFN handles its
    // deletion on stack teardown. The grant-revoke sibling CR cleans up
    // KMS authorization. This handler has nothing to undo.
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  const { SecretArn, EnvelopeJson, Revision, GrantToken, Shape, Refs } = props;
  const secretString = await decryptAndShape(EnvelopeJson, GrantToken, Shape, Refs);

  await sm.send(
    new PutSecretValueCommand({
      SecretId: SecretArn,
      SecretString: secretString,
    }),
  );

  return {
    // PhysicalResourceId includes the revision so CFN detects a change
    // when the envelope is re-packed with new values.
    PhysicalResourceId: `${SecretArn}#${Revision}`,
    Data: { Revision },
  };
}

async function handleParameter(event: OnEventRequest): Promise<OnEventResponse> {
  // Lazy-import SSM client — stacks with only ClefSecret instances never
  // pay the cold-start cost of loading the SSM SDK.
  const { PutParameterCommand, DeleteParameterCommand, SSMClient } =
    await import("@aws-sdk/client-ssm");
  const ssm = new SSMClient({});

  if (event.RequestType === "Delete") {
    // PhysicalResourceId carries the parameter name we created. Delete it.
    // Missing parameter is ignored — CFN might call Delete on a previously
    // failed Create, where the parameter never actually existed.
    if (event.PhysicalResourceId && event.PhysicalResourceId.startsWith("param:")) {
      const parameterName = event.PhysicalResourceId.slice("param:".length);
      try {
        await ssm.send(new DeleteParameterCommand({ Name: parameterName }));
      } catch (err) {
        const code = (err as { name?: string }).name;
        if (code !== "ParameterNotFound") throw err;
      }
    }
    return { PhysicalResourceId: event.PhysicalResourceId };
  }

  const props = event.ResourceProperties as ParameterResourceProperties;
  const {
    ParameterName,
    ParameterType,
    ParameterTier,
    ParameterKmsKeyId,
    EnvelopeJson,
    Revision,
    GrantToken,
    Shape,
    Refs,
  } = props;

  // Shape is required for parameters (SSM holds one value per parameter),
  // but defensively allow undefined — in that case we'd stringify the full
  // envelope JSON, which is probably not what the user wants. Validate.
  if (Shape === undefined) {
    throw new Error(
      `ClefParameter requires a 'shape' template — SSM parameters hold a single value. ` +
        `Add shape: "{{name}}" (or a composition) to your construct props.`,
    );
  }
  if (typeof Shape !== "string") {
    throw new Error(
      `ClefParameter 'shape' must be a string (single-value template). ` +
        `Record shapes are for ClefSecret (JSON-shaped ASM secrets).`,
    );
  }

  const parameterValue = await decryptAndShape(EnvelopeJson, GrantToken, Shape, Refs);

  // If the parameter name changed between Update invocations, CFN sees the
  // PhysicalResourceId change and calls Create on the new one + Delete on
  // the old — this branch only handles the current Create/Update target.
  await ssm.send(
    new PutParameterCommand({
      Name: ParameterName,
      Value: parameterValue,
      Type: ParameterType,
      Tier: ParameterTier,
      Overwrite: event.RequestType === "Update",
      ...(ParameterKmsKeyId ? { KeyId: ParameterKmsKeyId } : {}),
    }),
  );

  return {
    // Prefix with "param:" so Delete can distinguish secret vs parameter
    // physical IDs (secrets use the ASM ARN directly).
    PhysicalResourceId: `param:${ParameterName}`,
    Data: { Revision },
  };
}

async function decryptAndShape(
  envelopeJson: string,
  grantToken: string,
  shape: ShapeTemplate | undefined,
  refs: RefsMap | undefined,
): Promise<string> {
  const envelope = JSON.parse(envelopeJson) as PackedArtifact;
  if (!envelope.envelope) {
    throw new Error(
      `Clef CDK constructs require KMS-envelope artifacts, but envelope for ` +
        `'${envelope.identity}/${envelope.environment}' has no envelope header. ` +
        `Age-only identities are not supported.`,
    );
  }

  // 1. KMS Decrypt the wrapped DEK. GrantToken short-circuits the grant
  //    propagation delay — the sibling grant-create CR minted it just now.
  const decryptResult = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.envelope.wrappedKey, "base64"),
      KeyId: envelope.envelope.keyId,
      GrantTokens: [grantToken],
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
    // Decrypted payload is nested by namespace: Record<namespace, Record<key, value>>.
    const values = JSON.parse(plaintextBuf.toString("utf-8")) as Record<
      string,
      Record<string, string>
    >;

    // 3. Apply shape if provided, else passthrough (JSON-stringified nested values).
    const final = shape !== undefined ? applyShape(shape, refs, values) : values;
    return typeof final === "string" ? final : JSON.stringify(final);
  } finally {
    // Best-effort plaintext hygiene. Node can GC earlier copies we don't
    // own, but at least the buffer we hold is zeroed before return.
    dek.fill(0);
  }
}
