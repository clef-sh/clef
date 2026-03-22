import { KmsProvider, KmsWrapResult } from "./types";

export class AzureKmsProvider implements KmsProvider {
  async wrap(_keyId: string, _plaintext: Buffer): Promise<KmsWrapResult> {
    throw new Error("Azure Key Vault is not yet implemented.");
  }

  async unwrap(_keyId: string, _wrappedKey: Buffer, _algorithm: string): Promise<Buffer> {
    throw new Error("Azure Key Vault is not yet implemented.");
  }
}
