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
      const keyArn = "arn:aws:kms:us-east-1:111:key/test-key";
      mockSend.mockResolvedValue({ CiphertextBlob: ciphertextBlob, KeyId: keyArn });

      const result = await provider.wrap(keyArn, Buffer.from("AGE-SECRET-KEY-1TEST"));

      expect(result.wrappedKey).toEqual(ciphertextBlob);
      expect(result.algorithm).toBe("SYMMETRIC_DEFAULT");
      expect(result.resolvedKeyId).toBe(keyArn);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should surface the resolved key ARN when the input was an alias", async () => {
      // KMS Encrypt accepts aliases and returns the resolved key ARN in
      // response.KeyId. Surfacing this lets the packer persist the canonical
      // ARN — required because kms:CreateGrant rejects alias ARNs.
      const provider = new AwsKmsProvider("us-east-1");
      const aliasArn = "arn:aws:kms:us-east-1:111:alias/clef-quick-start";
      const resolvedArn = "arn:aws:kms:us-east-1:111:key/abc-123";
      mockSend.mockResolvedValue({
        CiphertextBlob: Buffer.from("ct"),
        KeyId: resolvedArn,
      });

      const result = await provider.wrap(aliasArn, Buffer.from("dek"));

      expect(result.resolvedKeyId).toBe(resolvedArn);
    });

    it("should leave resolvedKeyId undefined when KMS omits KeyId", async () => {
      const provider = new AwsKmsProvider("us-east-1");
      mockSend.mockResolvedValue({ CiphertextBlob: Buffer.from("ct") });

      const result = await provider.wrap(
        "arn:aws:kms:us-east-1:111:key/test-key",
        Buffer.from("dek"),
      );

      expect(result.resolvedKeyId).toBeUndefined();
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
