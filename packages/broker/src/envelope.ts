import * as crypto from "crypto";
import type { KmsProvider } from "@clef-sh/runtime";
import type { PackedArtifact } from "@clef-sh/core";

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
 * 1. AES-256-GCM encrypt plaintext with a random DEK
 * 2. Wrap the DEK via KMS
 * 3. Return the complete JSON envelope string
 */
export async function packEnvelope(options: PackEnvelopeOptions): Promise<string> {
  const { identity, environment, data, ttl, kmsProvider, kmsProviderName, kmsKeyId } = options;

  const plaintext = JSON.stringify(data);

  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  let ciphertext: string;
  let authTag: Buffer;
  let wrapped: Awaited<ReturnType<KmsProvider["wrap"]>>;

  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
    const ciphertextBuf = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf-8")),
      cipher.final(),
    ]);
    authTag = cipher.getAuthTag();
    ciphertext = ciphertextBuf.toString("base64");

    // Wrap the DEK with KMS
    wrapped = await kmsProvider.wrap(kmsKeyId, dek);
  } finally {
    dek.fill(0);
  }

  const revision = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const ciphertextHash = crypto.createHash("sha256").update(ciphertext).digest("hex");
  const packedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const artifact: PackedArtifact = {
    version: 1,
    identity,
    environment,
    packedAt,
    revision,
    ciphertextHash,
    ciphertext,
    envelope: {
      provider: kmsProviderName,
      keyId: kmsKeyId,
      wrappedKey: wrapped.wrappedKey.toString("base64"),
      algorithm: wrapped.algorithm,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    },
    expiresAt,
  };

  return JSON.stringify(artifact, null, 2);
}
