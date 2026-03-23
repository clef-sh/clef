import { AwsKmsProvider } from "./aws";

// Mock @aws-sdk/client-kms
const mockSend = jest.fn();
jest.mock(
  "@aws-sdk/client-kms",
  () => ({
    KMSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    EncryptCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
    DecryptCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  }),
  { virtual: true },
);

describe("AwsKmsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("wrap", () => {
    it("should encrypt plaintext and return wrapped key", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      const ciphertextBlob = Buffer.from("wrapped-key-data");
      mockSend.mockResolvedValue({ CiphertextBlob: ciphertextBlob });

      const result = await provider.wrap(
        "arn:aws:kms:us-east-1:111:key/test-key",
        Buffer.from("AGE-SECRET-KEY-1TEST"),
      );

      expect(result.wrappedKey).toEqual(ciphertextBlob);
      expect(result.algorithm).toBe("SYMMETRIC_DEFAULT");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw when KMS returns no ciphertext", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      mockSend.mockResolvedValue({});

      await expect(
        provider.wrap("arn:aws:kms:us-east-1:111:key/test-key", Buffer.from("test")),
      ).rejects.toThrow("no ciphertext");
    });

    it("should propagate KMS errors", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      mockSend.mockRejectedValue(new Error("AccessDeniedException"));

      await expect(
        provider.wrap("arn:aws:kms:us-east-1:111:key/test-key", Buffer.from("test")),
      ).rejects.toThrow("AccessDeniedException");
    });
  });

  describe("unwrap", () => {
    it("should decrypt wrapped key and return plaintext", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      const plaintext = Buffer.from("AGE-SECRET-KEY-1TEST");
      mockSend.mockResolvedValue({ Plaintext: plaintext });

      const result = await provider.unwrap(
        "arn:aws:kms:us-east-1:111:key/test-key",
        Buffer.from("wrapped-key-data"),
        "SYMMETRIC_DEFAULT",
      );

      expect(result).toEqual(plaintext);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should throw when KMS returns no plaintext", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      mockSend.mockResolvedValue({});

      await expect(
        provider.unwrap(
          "arn:aws:kms:us-east-1:111:key/test-key",
          Buffer.from("wrapped"),
          "SYMMETRIC_DEFAULT",
        ),
      ).rejects.toThrow("no plaintext");
    });

    it("should propagate KMS errors", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      mockSend.mockRejectedValue(new Error("InvalidKeyIdException"));

      await expect(
        provider.unwrap(
          "arn:aws:kms:us-east-1:111:key/bad",
          Buffer.from("wrapped"),
          "SYMMETRIC_DEFAULT",
        ),
      ).rejects.toThrow("InvalidKeyIdException");
    });
  });
});
