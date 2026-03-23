import { AzureKmsProvider } from "./azure";

// Mock @azure/identity
const mockCredential = { getToken: jest.fn() };
jest.mock(
  "@azure/identity",
  () => ({
    DefaultAzureCredential: jest.fn().mockImplementation(() => mockCredential),
  }),
  { virtual: true },
);

// Mock @azure/keyvault-keys
const mockWrapKey = jest.fn();
const mockUnwrapKey = jest.fn();
jest.mock(
  "@azure/keyvault-keys",
  () => ({
    CryptographyClient: jest.fn().mockImplementation(() => ({
      wrapKey: mockWrapKey,
      unwrapKey: mockUnwrapKey,
    })),
  }),
  { virtual: true },
);

describe("AzureKmsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("wrap", () => {
    it("should wrap plaintext and return wrapped key with RSA-OAEP-256", async () => {
      const provider = new AzureKmsProvider();
      const wrappedData = Buffer.from("azure-wrapped-key");
      mockWrapKey.mockResolvedValue({ result: wrappedData });

      const result = await provider.wrap(
        "https://my-vault.vault.azure.net/keys/my-key/abc123",
        Buffer.from("AGE-SECRET-KEY-1TEST"),
      );

      expect(result.wrappedKey).toEqual(wrappedData);
      expect(result.algorithm).toBe("RSA-OAEP-256");
      expect(mockWrapKey).toHaveBeenCalledWith("RSA-OAEP-256", expect.any(Buffer));
    });

    it("should throw when wrapKey returns no result", async () => {
      const provider = new AzureKmsProvider();
      mockWrapKey.mockResolvedValue({});

      await expect(
        provider.wrap("https://my-vault.vault.azure.net/keys/my-key/abc123", Buffer.from("test")),
      ).rejects.toThrow("no result");
    });

    it("should propagate Azure errors", async () => {
      const provider = new AzureKmsProvider();
      mockWrapKey.mockRejectedValue(new Error("Forbidden"));

      await expect(
        provider.wrap("https://my-vault.vault.azure.net/keys/my-key/abc123", Buffer.from("test")),
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("unwrap", () => {
    it("should unwrap wrapped key and return plaintext", async () => {
      const provider = new AzureKmsProvider();
      const plaintext = Buffer.from("AGE-SECRET-KEY-1TEST");
      mockUnwrapKey.mockResolvedValue({ result: plaintext });

      const result = await provider.unwrap(
        "https://my-vault.vault.azure.net/keys/my-key/abc123",
        Buffer.from("azure-wrapped-key"),
        "RSA-OAEP-256",
      );

      expect(result).toEqual(plaintext);
      expect(mockUnwrapKey).toHaveBeenCalledWith("RSA-OAEP-256", expect.any(Buffer));
    });

    it("should throw when unwrapKey returns no result", async () => {
      const provider = new AzureKmsProvider();
      mockUnwrapKey.mockResolvedValue({});

      await expect(
        provider.unwrap(
          "https://my-vault.vault.azure.net/keys/my-key/abc123",
          Buffer.from("wrapped"),
          "RSA-OAEP-256",
        ),
      ).rejects.toThrow("no result");
    });

    it("should propagate Azure errors", async () => {
      const provider = new AzureKmsProvider();
      mockUnwrapKey.mockRejectedValue(new Error("KeyNotFound"));

      await expect(
        provider.unwrap(
          "https://my-vault.vault.azure.net/keys/bad",
          Buffer.from("wrapped"),
          "RSA-OAEP-256",
        ),
      ).rejects.toThrow("KeyNotFound");
    });
  });
});
