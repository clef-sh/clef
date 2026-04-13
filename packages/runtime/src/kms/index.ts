import { KmsProvider } from "./types";
import { AwsKmsProvider } from "./aws";
import { GcpKmsProvider } from "./gcp";
import { AzureKmsProvider } from "./azure";

export type { KmsProvider, KmsWrapResult, KmsProviderType } from "./types";
export { AwsKmsProvider } from "./aws";
export { GcpKmsProvider } from "./gcp";
export { AzureKmsProvider } from "./azure";

export interface KmsProviderOptions {
  region?: string;
}

/** Factory: create a KMS provider by name. */
export async function createKmsProvider(
  provider: string,
  options?: KmsProviderOptions,
): Promise<KmsProvider> {
  switch (provider) {
    case "aws":
      return new AwsKmsProvider(options?.region);
    case "gcp":
      return new GcpKmsProvider();
    case "azure":
      return new AzureKmsProvider();
    default:
      throw new Error(`Unknown KMS provider: ${provider}`);
  }
}
