import * as crypto from "crypto";
import type { PackedArtifact, SignatureAlgorithm } from "./types";
import type { KmsProvider } from "../kms";

/**
 * Build the canonical signing payload from an artifact.
 *
 * The payload is a deterministic newline-separated string of all
 * security-relevant fields. The signature covers everything the
 * runtime acts on — version, identity, environment, revision, timing,
 * integrity hash, key list, expiry, and envelope fields.
 *
 * `ciphertextHash` transitively covers the ciphertext content, so the
 * (potentially large) ciphertext itself is not included.
 *
 * Key names are intentionally excluded from the signing payload — they are
 * not present in the envelope and are derived from decrypted values at runtime.
 */
export function buildSigningPayload(artifact: PackedArtifact): Buffer {
  const fields = [
    "clef-sig-v3",
    String(artifact.version),
    artifact.identity,
    artifact.environment,
    artifact.revision,
    artifact.packedAt,
    artifact.ciphertextHash,
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
 * Generate an Ed25519 signing key pair.
 * Returns base64-encoded DER keys (SPKI for public, PKCS8 for private).
 */
export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: (pair.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    ),
    privateKey: (pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer).toString(
      "base64",
    ),
  };
}

/**
 * Sign an artifact payload with an Ed25519 private key.
 *
 * @param payload - Canonical signing payload from {@link buildSigningPayload}
 * @param privateKeyBase64 - Base64-encoded DER PKCS8 private key
 * @returns Base64-encoded Ed25519 signature
 */
export function signEd25519(payload: Buffer, privateKeyBase64: string): string {
  const keyObj = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto.sign(null, payload, keyObj);
  return signature.toString("base64");
}

/**
 * Sign an artifact payload with a KMS asymmetric signing key (ECDSA_SHA_256).
 *
 * The KMS `sign` method receives a SHA-256 digest (not the raw payload),
 * matching AWS KMS `MessageType: "DIGEST"` semantics.
 *
 * @param payload - Canonical signing payload from {@link buildSigningPayload}
 * @param kms - KMS provider with `sign` method
 * @param signingKeyId - ARN or ID of the KMS asymmetric signing key
 * @returns Base64-encoded ECDSA signature
 */
export async function signKms(
  payload: Buffer,
  kms: KmsProvider,
  signingKeyId: string,
): Promise<string> {
  if (!kms.sign) {
    throw new Error(
      "KMS provider does not support signing. Ensure the provider implements the sign() method.",
    );
  }
  const digest = crypto.createHash("sha256").update(payload).digest();
  const signature = await kms.sign(signingKeyId, digest);
  return signature.toString("base64");
}

/**
 * Verify a signature against a public key.
 *
 * The algorithm is derived from the key's type (Ed25519 or EC), not from
 * the artifact's claimed `signatureAlgorithm` field. This prevents an
 * attacker from downgrading the verification algorithm.
 *
 * @param payload - Canonical signing payload from {@link buildSigningPayload}
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

/**
 * Detect the signature algorithm from a DER SPKI public key.
 *
 * @param publicKeyBase64 - Base64-encoded DER SPKI public key
 * @returns The corresponding SignatureAlgorithm
 */
export function detectAlgorithm(publicKeyBase64: string): SignatureAlgorithm {
  const keyObj = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const keyType = keyObj.asymmetricKeyType;
  if (keyType === "ed25519") return "Ed25519";
  if (keyType === "ec") return "ECDSA_SHA256";
  throw new Error(`Unsupported key type: ${keyType}`);
}
