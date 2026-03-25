import * as crypto from "crypto";
import type { KmsProvider } from "@clef-sh/runtime";

/** KMS envelope metadata in the artifact. */
export interface ArtifactEnvelopeField {
  provider: string;
  keyId: string;
  wrappedKey: string;
  algorithm: string;
}

/** JSON envelope produced by the broker. Matches the runtime's expected artifact shape. */
export interface BrokerArtifact {
  version: 1;
  identity: string;
  environment: string;
  packedAt: string;
  revision: string;
  ciphertextHash: string;
  ciphertext: string;
  keys: string[];
  envelope: ArtifactEnvelopeField;
  expiresAt: string;
}

/** Options for packEnvelope(). */
export interface PackEnvelopeOptions {
  /** Service identity name. */
  identity: string;
  /** Target environment. */
  environment: string;
  /** Generated credentials as key-value pairs. */
  data: Record<string, string>;
  /** TTL in seconds — becomes the expiresAt timestamp. */
  ttl: number;
  /** KMS provider instance (from createKmsProvider()). */
  kmsProvider: KmsProvider;
  /** KMS provider name for the envelope field ("aws", "gcp", "azure"). */
  kmsProviderName: string;
  /** KMS key ID/ARN for wrapping. */
  kmsKeyId: string;
}

/**
 * Pack credentials into a Clef artifact envelope with KMS envelope encryption.
 *
 * 1. age-encrypt plaintext with an ephemeral key
 * 2. Wrap the ephemeral private key via KMS
 * 3. Return the complete JSON envelope string
 */
export async function packEnvelope(options: PackEnvelopeOptions): Promise<string> {
  const { identity, environment, data, ttl, kmsProvider, kmsProviderName, kmsKeyId } = options;

  const plaintext = JSON.stringify(data);

  // Generate ephemeral age key pair
  const { generateIdentity, identityToRecipient, Encrypter } = await import(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
    "age-encryption" as any
  );
  const ephemeralPrivateKey = (await generateIdentity()) as string;
  const ephemeralPublicKey = (await identityToRecipient(ephemeralPrivateKey)) as string;

  // age-encrypt plaintext to ephemeral public key
  const e = new Encrypter();
  e.addRecipient(ephemeralPublicKey);
  const encrypted = await e.encrypt(plaintext);
  const ciphertext = Buffer.from(encrypted as Uint8Array).toString("base64");

  // Wrap the ephemeral private key with KMS
  const wrapped = await kmsProvider.wrap(kmsKeyId, Buffer.from(ephemeralPrivateKey));

  const revision = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const ciphertextHash = crypto.createHash("sha256").update(ciphertext).digest("hex");
  const packedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const artifact: BrokerArtifact = {
    version: 1,
    identity,
    environment,
    packedAt,
    revision,
    ciphertextHash,
    ciphertext,
    keys: Object.keys(data),
    envelope: {
      provider: kmsProviderName,
      keyId: kmsKeyId,
      wrappedKey: wrapped.wrappedKey.toString("base64"),
      algorithm: wrapped.algorithm,
    },
    expiresAt,
  };

  return JSON.stringify(artifact, null, 2);
}
