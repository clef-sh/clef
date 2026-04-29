export type KmsProviderType = "aws" | "gcp" | "azure";

export const VALID_KMS_PROVIDERS: readonly KmsProviderType[] = ["aws", "gcp", "azure"] as const;

export interface KmsWrapResult {
  wrappedKey: Buffer;
  algorithm: string;
  /**
   * Canonical key ARN as returned by the KMS provider after resolving any
   * indirection (e.g. AWS aliases). When the input keyId was a key ARN this
   * equals the input. Persisted into `envelope.keyId` so downstream
   * consumers (CreateGrant, IAM scoping, audit) always see a real key ARN —
   * `kms:CreateGrant` rejects alias ARNs, so storing the alias would break
   * deploy-time grant minting.
   */
  resolvedKeyId?: string;
}

export interface KmsProvider {
  wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult>;
  unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer>;
  /** Sign a SHA-256 digest with an asymmetric KMS key (ECDSA_SHA_256). Optional. */
  sign?(keyId: string, digest: Buffer): Promise<Buffer>;
}
