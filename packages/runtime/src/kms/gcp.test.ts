import { GcpKmsProvider } from "./gcp";

// Mock @google-cloud/kms
const mockEncrypt = jest.fn();
const mockDecrypt = jest.fn();
jest.mock(
  "@google-cloud/kms",
  () => ({
    KeyManagementServiceClient: jest.fn().mockImplementation(() => ({
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    })),
  }),
  { virtual: true },
);

describe("GcpKmsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("wrap", () => {
    it("should encrypt plaintext and return wrapped key", async () => {
      const provider = new GcpKmsProvider();
      const ciphertext = Buffer.from("gcp-wrapped-key");
      mockEncrypt.mockResolvedValue([{ ciphertext }]);

      const result = await provider.wrap(
        "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
        Buffer.from("AGE-SECRET-KEY-1TEST"),
      );

      expect(result.wrappedKey).toEqual(ciphertext);
      expect(result.algorithm).toBe("GOOGLE_SYMMETRIC_ENCRYPTION");
      expect(mockEncrypt).toHaveBeenCalledWith({
        name: "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
        plaintext: expect.any(Buffer),
      });
    });

    it("should throw when encrypt returns no ciphertext", async () => {
      const provider = new GcpKmsProvider();
      mockEncrypt.mockResolvedValue([{}]);

      await expect(
        provider.wrap(
          "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
          Buffer.from("test"),
        ),
      ).rejects.toThrow("no ciphertext");
    });

    it("should propagate GCP errors", async () => {
      const provider = new GcpKmsProvider();
      mockEncrypt.mockRejectedValue(new Error("PERMISSION_DENIED"));

      await expect(
        provider.wrap(
          "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
          Buffer.from("test"),
        ),
      ).rejects.toThrow("PERMISSION_DENIED");
    });
  });

  describe("unwrap", () => {
    it("should decrypt wrapped key and return plaintext", async () => {
      const provider = new GcpKmsProvider();
      const plaintext = Buffer.from("AGE-SECRET-KEY-1TEST");
      mockDecrypt.mockResolvedValue([{ plaintext }]);

      const result = await provider.unwrap(
        "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
        Buffer.from("gcp-wrapped-key"),
        "GOOGLE_SYMMETRIC_ENCRYPTION",
      );

      expect(result).toEqual(plaintext);
      expect(mockDecrypt).toHaveBeenCalledWith({
        name: "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
        ciphertext: expect.any(Buffer),
      });
    });

    it("should throw when decrypt returns no plaintext", async () => {
      const provider = new GcpKmsProvider();
      mockDecrypt.mockResolvedValue([{}]);

      await expect(
        provider.unwrap(
          "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key",
          Buffer.from("wrapped"),
          "GOOGLE_SYMMETRIC_ENCRYPTION",
        ),
      ).rejects.toThrow("no plaintext");
    });

    it("should propagate GCP errors", async () => {
      const provider = new GcpKmsProvider();
      mockDecrypt.mockRejectedValue(new Error("NOT_FOUND"));

      await expect(
        provider.unwrap(
          "projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/bad",
          Buffer.from("wrapped"),
          "GOOGLE_SYMMETRIC_ENCRYPTION",
        ),
      ).rejects.toThrow("NOT_FOUND");
    });
  });
});
