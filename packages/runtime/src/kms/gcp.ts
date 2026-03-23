import { KmsProvider, KmsWrapResult } from "./types";

/**
 * GCP Cloud KMS provider for envelope encryption.
 * Dynamically imports `@google-cloud/kms` — the SDK is an optional dependency.
 *
 * The keyId is the full GCP KMS resource name:
 *   projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{key}
 *
 * Uses Application Default Credentials for authentication.
 */
export class GcpKmsProvider implements KmsProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK client
  private client: any;

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    try {
      const kms = await import("@google-cloud/kms");
      this.client = new kms.KeyManagementServiceClient();
    } catch {
      throw new Error(
        "GCP KMS requires @google-cloud/kms. Install it with: npm install @google-cloud/kms",
      );
    }
  }

  async wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult> {
    await this.ensureClient();

    const [response] = await this.client.encrypt({
      name: keyId,
      plaintext,
    });

    if (!response.ciphertext) {
      throw new Error("GCP KMS encrypt returned no ciphertext.");
    }

    return {
      wrappedKey: Buffer.from(response.ciphertext),
      algorithm: "GOOGLE_SYMMETRIC_ENCRYPTION",
    };
  }

  async unwrap(keyId: string, wrappedKey: Buffer, _algorithm: string): Promise<Buffer> {
    await this.ensureClient();

    const [response] = await this.client.decrypt({
      name: keyId,
      ciphertext: wrappedKey,
    });

    if (!response.plaintext) {
      throw new Error("GCP KMS decrypt returned no plaintext.");
    }

    return Buffer.from(response.plaintext);
  }
}
