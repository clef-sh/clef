export type KmsProviderType = "aws" | "gcp" | "azure";

export interface KmsWrapResult {
  wrappedKey: Buffer;
  algorithm: string;
}

export interface KmsProvider {
  wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult>;
  unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer>;
}
