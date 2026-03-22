import { KmsProvider, KmsWrapResult } from "./types";

export class GcpKmsProvider implements KmsProvider {
  async wrap(_keyId: string, _plaintext: Buffer): Promise<KmsWrapResult> {
    throw new Error("GCP KMS is not yet implemented.");
  }

  async unwrap(_keyId: string, _wrappedKey: Buffer, _algorithm: string): Promise<Buffer> {
    throw new Error("GCP KMS is not yet implemented.");
  }
}
