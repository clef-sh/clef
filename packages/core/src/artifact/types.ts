/** KMS envelope metadata for artifacts using KMS envelope encryption. */
export interface ArtifactEnvelope {
  /** KMS provider that wrapped the DEK (e.g. "aws", "gcp", "azure"). */
  provider: string;
  /** KMS key ARN/ID used to wrap the AES-256 DEK. */
  keyId: string;
  /** Base64-encoded KMS-wrapped AES-256 data encryption key (DEK). */
  wrappedKey: string;
  /** KMS encryption algorithm (e.g. "SYMMETRIC_DEFAULT"). */
  algorithm: string;
  /** Base64-encoded 12-byte AES-GCM initialization vector. */
  iv: string;
  /** Base64-encoded 16-byte AES-GCM authentication tag. */
  authTag: string;
}

/** Supported artifact signature algorithms. */
export type SignatureAlgorithm = "Ed25519" | "ECDSA_SHA256";

/** JSON envelope for a packed artifact. Language-agnostic, forward-compatible. */
export interface PackedArtifact {
  version: 1;
  /** Service identity name. */
  identity: string;
  /** Target environment name. */
  environment: string;
  /** ISO-8601 timestamp of when the artifact was packed. */
  packedAt: string;
  /** Monotonic revision (unix epoch ms) for change detection. */
  revision: string;
  /** SHA-256 hex digest of the ciphertext for integrity verification. */
  ciphertextHash: string;
  /** Base64-encoded ciphertext. Age format for age-only artifacts; AES-256-GCM for KMS envelope artifacts. */
  ciphertext: string;
  /** Secret key names for introspection (not the values). */
  keys: string[];
  /** KMS envelope metadata. Present when the identity uses KMS envelope encryption. */
  envelope?: ArtifactEnvelope;
  /** ISO-8601 expiry timestamp. Artifact is rejected after this time. */
  expiresAt?: string;
  /** Base64-encoded cryptographic signature over the canonical artifact payload. */
  signature?: string;
  /** Algorithm used to produce the signature. */
  signatureAlgorithm?: SignatureAlgorithm;
}

/** Configuration for the `pack` command. */
export interface PackConfig {
  /** Service identity name from the manifest. */
  identity: string;
  /** Target environment name. */
  environment: string;
  /** Local file path to write the artifact JSON to. */
  outputPath: string;
  /** TTL in seconds — embeds an `expiresAt` timestamp in the artifact envelope. */
  ttl?: number;
  /** Ed25519 private key for artifact signing (base64-encoded DER PKCS8). */
  signingKey?: string;
  /** KMS asymmetric signing key ARN/ID (ECDSA_SHA_256). Mutually exclusive with signingKey. */
  signingKmsKeyId?: string;
}

/** Result of a pack operation. */
export interface PackResult {
  /** Path where the artifact was written. */
  outputPath: string;
  /** Number of namespaces included. */
  namespaceCount: number;
  /** Number of secret keys in the artifact. */
  keyCount: number;
  /** Size of the artifact file in bytes. */
  artifactSize: number;
  /** Monotonic revision string. */
  revision: string;
}
