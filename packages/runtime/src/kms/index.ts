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
  /** Clef Cloud API endpoint (cloud provider only). */
  endpoint?: string;
  /** Service token for Clef Cloud auth (cloud provider only). */
  token?: string;
}

/**
 * Factory: create a KMS provider by name.
 * The "cloud" provider lazy-imports @clef-sh/client — install it to use Clef Cloud KMS.
 */
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
    case "cloud": {
      try {
        const { CloudKmsProvider } = await import("@clef-sh/client/kms");
        return new CloudKmsProvider({
          endpoint: options?.endpoint ?? "",
          token: options?.token,
        });
      } catch {
        throw new Error(
          "Clef Cloud KMS requires @clef-sh/client. Install it with: npm install @clef-sh/client",
        );
      }
    }
    default:
      throw new Error(`Unknown KMS provider: ${provider}`);
  }
}
