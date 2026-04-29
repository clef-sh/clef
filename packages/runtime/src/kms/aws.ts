import { KmsProvider, KmsWrapResult } from "./types";

/**
 * AWS KMS provider for envelope encryption.
 * Dynamically imports `@aws-sdk/client-kms` — the SDK is an optional dependency.
 */
export class AwsKmsProvider implements KmsProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK client
  private client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK module
  private sdk: any;
  private readonly region?: string;

  constructor(region?: string) {
    this.region = region;
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    try {
      this.sdk = await import("@aws-sdk/client-kms");
      this.client = new this.sdk.KMSClient({ region: this.region });
    } catch {
      throw new Error(
        "AWS KMS requires @aws-sdk/client-kms. Install it with: npm install @aws-sdk/client-kms",
      );
    }
  }

  async wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult> {
    await this.ensureClient();
    const command = new this.sdk.EncryptCommand({
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
      // Encrypt's response.KeyId is the resolved key ARN even when the
      // request used an alias. Surface it so the envelope persists the
      // canonical ARN, not the alias.
      resolvedKeyId: typeof response.KeyId === "string" ? response.KeyId : undefined,
    };
  }

  async unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer> {
    await this.ensureClient();
    const command = new this.sdk.DecryptCommand({
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

  async sign(keyId: string, digest: Buffer): Promise<Buffer> {
    await this.ensureClient();
    const command = new this.sdk.SignCommand({
      KeyId: keyId,
      Message: digest,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    });

    const response = await this.client.send(command);
    if (!response.Signature) {
      throw new Error("AWS KMS Sign returned no signature.");
    }

    return Buffer.from(response.Signature);
  }
}
