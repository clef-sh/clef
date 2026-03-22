import { KmsProvider } from "./types";
import { AwsKmsProvider } from "./aws";

export type { KmsProvider, KmsWrapResult, KmsProviderType } from "./types";
export { AwsKmsProvider } from "./aws";
export { GcpKmsProvider } from "./gcp";
export { AzureKmsProvider } from "./azure";

/**
 * Factory: create a KMS provider by name.
 * AWS is fully implemented; GCP and Azure are stubs.
 */
export function createKmsProvider(provider: string, options?: { region?: string }): KmsProvider {
  switch (provider) {
    case "aws":
      return new AwsKmsProvider(options?.region);
    case "gcp":
      throw new Error("GCP KMS is not yet implemented.");
    case "azure":
      throw new Error("Azure Key Vault is not yet implemented.");
    default:
      throw new Error(`Unknown KMS provider: ${provider}`);
  }
}
