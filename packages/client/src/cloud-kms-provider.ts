import { CloudKmsProviderOptions, ClefClientError } from "./types";
import { resolveToken } from "./auth";
import { request } from "./http";

/**
 * Clef Cloud KMS provider.
 *
 * Implements the KmsProvider interface (structurally — no import needed)
 * for use with @clef-sh/runtime's createKmsProvider factory.
 *
 * Only `unwrap()` is supported. Encryption (wrap) is handled by the
 * keyservice sidecar during `clef pack`.
 */
export class CloudKmsProvider {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(options: CloudKmsProviderOptions) {
    this.endpoint = options.endpoint;
    this.token = resolveToken(options.token);
  }

  async wrap(
    _keyId: string,
    _plaintext: Buffer,
  ): Promise<{ wrappedKey: Buffer; algorithm: string }> {
    throw new ClefClientError(
      "CloudKmsProvider.wrap() is not supported. Use the keyservice sidecar for encryption.",
    );
  }

  async unwrap(keyId: string, wrappedKey: Buffer, _algorithm: string): Promise<Buffer> {
    const result = await request<{ plaintext: string }>(this.endpoint, {
      method: "POST",
      path: "/api/v1/cloud/kms/decrypt",
      body: {
        keyArn: keyId,
        ciphertext: wrappedKey.toString("base64"),
      },
      token: this.token,
      fetchFn: globalThis.fetch,
    });

    return Buffer.from(result.plaintext, "base64");
  }
}
