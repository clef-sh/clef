import { CloudKmsProvider } from "./cloud-kms-provider";
import { ClefClientError } from "./types";

function mockFetch(body: unknown, status = 200): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe("CloudKmsProvider", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  describe("unwrap", () => {
    it("decrypts via Cloud KMS API", async () => {
      const plaintext = Buffer.from("decrypted-dek").toString("base64");
      globalThis.fetch = mockFetch({
        data: { plaintext },
        success: true,
        message: "ok",
      });

      const provider = new CloudKmsProvider({
        endpoint: "https://api.clef.sh",
        token: "test-token",
      });

      const result = await provider.unwrap(
        "arn:aws:kms:us-east-1:123:key/abc",
        Buffer.from("encrypted-dek"),
        "SYMMETRIC_DEFAULT",
      );

      expect(result).toEqual(Buffer.from("decrypted-dek"));
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("https://api.clef.sh/api/v1/cloud/kms/decrypt");
      expect(JSON.parse(init.body)).toEqual({
        keyArn: "arn:aws:kms:us-east-1:123:key/abc",
        ciphertext: Buffer.from("encrypted-dek").toString("base64"),
      });
      expect(init.headers.Authorization).toBe("Bearer test-token");
    });

    it("throws on API error", async () => {
      globalThis.fetch = mockFetch({ success: false, message: "Access denied" });

      const provider = new CloudKmsProvider({
        endpoint: "https://api.clef.sh",
        token: "test-token",
      });

      await expect(
        provider.unwrap("arn:...", Buffer.from("data"), "SYMMETRIC_DEFAULT"),
      ).rejects.toThrow("Access denied");
    });

    it("throws on 401", async () => {
      globalThis.fetch = mockFetch({}, 401);

      const provider = new CloudKmsProvider({
        endpoint: "https://api.clef.sh",
        token: "bad-token",
      });

      await expect(
        provider.unwrap("arn:...", Buffer.from("data"), "SYMMETRIC_DEFAULT"),
      ).rejects.toThrow(ClefClientError);
    });
  });

  describe("wrap", () => {
    it("throws not supported", async () => {
      const provider = new CloudKmsProvider({
        endpoint: "https://api.clef.sh",
        token: "test-token",
      });

      await expect(provider.wrap("arn:...", Buffer.from("data"))).rejects.toThrow("not supported");
    });
  });

  describe("auth", () => {
    it("uses CLEF_SERVICE_TOKEN env var when no explicit token", () => {
      const origEnv = process.env.CLEF_SERVICE_TOKEN;
      process.env.CLEF_SERVICE_TOKEN = "env-token";

      const provider = new CloudKmsProvider({
        endpoint: "https://api.clef.sh",
      });

      // Provider should construct without error
      expect(provider).toBeDefined();

      process.env.CLEF_SERVICE_TOKEN = origEnv;
    });

    it("throws when no token available", () => {
      const origEnv = process.env.CLEF_SERVICE_TOKEN;
      delete process.env.CLEF_SERVICE_TOKEN;

      expect(() => new CloudKmsProvider({ endpoint: "https://api.clef.sh" })).toThrow(
        "No service token configured",
      );

      process.env.CLEF_SERVICE_TOKEN = origEnv;
    });
  });
});
