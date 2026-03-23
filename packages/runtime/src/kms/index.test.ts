import { createKmsProvider } from "./index";
import { AwsKmsProvider } from "./aws";
import { GcpKmsProvider } from "./gcp";
import { AzureKmsProvider } from "./azure";

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

// Mock @azure/identity and @azure/keyvault-keys so AzureKmsProvider can instantiate
jest.mock(
  "@azure/identity",
  () => ({
    DefaultAzureCredential: jest.fn().mockImplementation(() => ({})),
  }),
  { virtual: true },
);
jest.mock(
  "@azure/keyvault-keys",
  () => ({
    CryptographyClient: jest.fn().mockImplementation(() => ({})),
  }),
  { virtual: true },
);

// Mock @google-cloud/kms so GcpKmsProvider can instantiate
jest.mock(
  "@google-cloud/kms",
  () => ({
    KeyManagementServiceClient: jest.fn().mockImplementation(() => ({})),
  }),
  { virtual: true },
);

describe("createKmsProvider", () => {
  it("should create an AWS KMS provider", () => {
    const provider = createKmsProvider("aws", { region: "us-west-2" });
    expect(provider).toBeInstanceOf(AwsKmsProvider);
  });

  it("should create a GCP KMS provider", () => {
    const provider = createKmsProvider("gcp");
    expect(provider).toBeInstanceOf(GcpKmsProvider);
  });

  it("should create an Azure Key Vault provider", () => {
    const provider = createKmsProvider("azure");
    expect(provider).toBeInstanceOf(AzureKmsProvider);
  });

  it("should throw for unknown provider", () => {
    expect(() => createKmsProvider("unknown")).toThrow("Unknown KMS provider");
  });
});
