import { KmsProvider, KmsWrapResult } from "./types";

/**
 * Azure Key Vault provider for envelope encryption.
 * Dynamically imports `@azure/keyvault-keys` and `@azure/identity` — both are optional dependencies.
 *
 * The keyId is the full Azure Key Vault key URL:
 *   https://{vault-name}.vault.azure.net/keys/{key-name}/{version?}
 */
export class AzureKmsProvider implements KmsProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK credential
  private credential: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded SDK module
  private keysModule: any;

  private async ensureLoaded(): Promise<void> {
    if (this.credential) return;
    try {
      const identity = await import("@azure/identity");
      this.keysModule = await import("@azure/keyvault-keys");
      this.credential = new identity.DefaultAzureCredential();
    } catch {
      throw new Error(
        "Azure Key Vault requires @azure/identity and @azure/keyvault-keys. " +
          "Install them with: npm install @azure/identity @azure/keyvault-keys",
      );
    }
  }

  async wrap(keyId: string, plaintext: Buffer): Promise<KmsWrapResult> {
    await this.ensureLoaded();
    const client = new this.keysModule.CryptographyClient(keyId, this.credential);
    const result = await client.wrapKey("RSA-OAEP-256", plaintext);

    if (!result.result) {
      throw new Error("Azure Key Vault wrapKey returned no result.");
    }

    return {
      wrappedKey: Buffer.from(result.result),
      algorithm: "RSA-OAEP-256",
    };
  }

  async unwrap(keyId: string, wrappedKey: Buffer, algorithm: string): Promise<Buffer> {
    await this.ensureLoaded();
    const client = new this.keysModule.CryptographyClient(keyId, this.credential);
    const result = await client.unwrapKey(algorithm, wrappedKey);

    if (!result.result) {
      throw new Error("Azure Key Vault unwrapKey returned no result.");
    }

    return Buffer.from(result.result);
  }
}
