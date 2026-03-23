import { createKmsProvider } from "./index";
import { AwsKmsProvider } from "./aws";

// Mock @aws-sdk/client-kms so AwsKmsProvider can instantiate
jest.mock(
  "@aws-sdk/client-kms",
  () => ({
    KMSClient: jest.fn().mockImplementation(() => ({})),
    EncryptCommand: jest.fn(),
    DecryptCommand: jest.fn(),
  }),
  { virtual: true },
);

describe("createKmsProvider", () => {
  it("should create an AWS KMS provider", () => {
    const provider = createKmsProvider("aws", { region: "us-west-2" });
    expect(provider).toBeInstanceOf(AwsKmsProvider);
  });

  it("should throw for GCP (not yet implemented)", () => {
    expect(() => createKmsProvider("gcp")).toThrow("not yet implemented");
  });

  it("should throw for Azure (not yet implemented)", () => {
    expect(() => createKmsProvider("azure")).toThrow("not yet implemented");
  });

  it("should throw for unknown provider", () => {
    expect(() => createKmsProvider("unknown")).toThrow("Unknown KMS provider");
  });
});
