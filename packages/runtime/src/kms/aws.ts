import { KmsProvider, KmsWrapResult } from "./types";

/**
 * AWS KMS provider for envelope encryption.
 * Dynamically loads `@aws-sdk/client-kms` — the SDK is an optional dependency.
 */
export class AwsKmsProvider implements KmsProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK client
  private client: any;
  private readonly region?: string;

  constructor(region?: string) {
    this.region = region;
  }

  private ensureClient(): void {
    if (this.client) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic optional dependency
      const { KMSClient } = require("@aws-sdk/client-kms");
      this.client = new KMSClient({ region: this.region });
    } catch {
      throw new Error(
        "AWS KMS requires @aws-sdk/client-kms. Install it with: npm install @aws-sdk/client-kms",
      );
    }
  }

  async wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult> {
    this.ensureClient();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic optional dependency
    const { EncryptCommand } = require("@aws-sdk/client-kms");
    const command = new EncryptCommand({
      KeyId: keyId,
      Plaintext: plaintext,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });

    const response = await this.client.send(command);
    if (!response.CiphertextBlob) {
      throw new Error("AWS KMS Encrypt returned no ciphertext.");
    }

    return {
      wrappedKey: Buffer.from(response.CiphertextBlob),
      algorithm: "SYMMETRIC_DEFAULT",
    };
  }

  async unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer> {
    this.ensureClient();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic optional dependency
    const { DecryptCommand } = require("@aws-sdk/client-kms");
    const command = new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: wrappedKey,
      EncryptionAlgorithm: algorithm,
    });

    const response = await this.client.send(command);
    if (!response.Plaintext) {
      throw new Error("AWS KMS Decrypt returned no plaintext.");
    }

    return Buffer.from(response.Plaintext);
  }
}
