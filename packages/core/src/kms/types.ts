export type KmsProviderType = "aws" | "gcp" | "azure";

export const VALID_KMS_PROVIDERS: readonly KmsProviderType[] = ["aws", "gcp", "azure"] as const;

export interface KmsWrapResult {
  wrappedKey: Buffer;
  algorithm: string;
}

export interface KmsProvider {
  wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult>;
  unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer>;
  /** Sign a SHA-256 digest with an asymmetric KMS key (ECDSA_SHA_256). Optional. */
  sign?(keyId: string, digest: Buffer): Promise<Buffer>;
}
