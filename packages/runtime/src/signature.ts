import * as crypto from "crypto";

/**
 * Minimal artifact shape for signature payload construction.
 * Mirrors the fields from ArtifactEnvelope that the signature covers.
 */
interface SignableArtifact {
  version: number;
  identity: string;
  environment: string;
  revision: string;
  packedAt: string;
  ciphertextHash: string;
  keys: string[];
  expiresAt?: string;
  envelope?: {
    provider: string;
    keyId: string;
    wrappedKey: string;
    algorithm: string;
    iv?: string;
    authTag?: string;
  };
}

/**
 * Build the canonical signing payload from an artifact.
 *
 * Must produce the same output as the core signer's buildSigningPayload
 * to enable cross-package sign/verify. The format is a deterministic
 * newline-separated string of all security-relevant fields.
 */
export function buildSigningPayload(artifact: SignableArtifact): Buffer {
  const fields = [
    "clef-sig-v2",
    String(artifact.version),
    artifact.identity,
    artifact.environment,
    artifact.revision,
    artifact.packedAt,
    artifact.ciphertextHash,
    [...artifact.keys].sort().join(","),
    artifact.expiresAt ?? "",
    artifact.envelope?.provider ?? "",
    artifact.envelope?.keyId ?? "",
    artifact.envelope?.wrappedKey ?? "",
    artifact.envelope?.algorithm ?? "",
    artifact.envelope?.iv ?? "",
    artifact.envelope?.authTag ?? "",
  ];
  return Buffer.from(fields.join("\n"), "utf-8");
}

/**
 * Verify a signature against a public key.
 *
 * The algorithm is derived from the key's type (Ed25519 or EC), not from
 * the artifact's claimed signatureAlgorithm field.
 *
 * @param payload - Canonical signing payload
 * @param signatureBase64 - Base64-encoded signature to verify
 * @param publicKeyBase64 - Base64-encoded DER SPKI public key
 * @returns true if the signature is valid
 */
export function verifySignature(
  payload: Buffer,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  const keyObj = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(signatureBase64, "base64");

  const keyType = keyObj.asymmetricKeyType;
  if (keyType === "ed25519") {
    return crypto.verify(null, payload, keyObj, signature);
  }
  if (keyType === "ec") {
    return crypto.verify("sha256", payload, keyObj, signature);
  }
  throw new Error(`Unsupported key type for signature verification: ${keyType}`);
}
