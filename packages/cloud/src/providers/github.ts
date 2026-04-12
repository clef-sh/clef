/**
 * GitHub auth provider.
 *
 * Implements the GitHub Device Flow (RFC 8628): request a device code from
 * GitHub, poll until the user authorizes, then exchange the GitHub access
 * token for a Clef session JWT.
 */
import type { AuthProvider, AuthProviderDeps, ClefCloudCredentials } from "../types";
import { runDeviceFlow } from "../device-flow";

/**
 * GitHub App client ID for the Device Flow.
 *
 * Not a secret — appears in OAuth URLs. Hardcoded per environment for v0.1.
 * Override via CLEF_GITHUB_CLIENT_ID env var.
 */
const GITHUB_CLIENT_ID_PROD = "";
const GITHUB_CLIENT_ID_DEV = "";

function resolveClientId(): string {
  if (process.env.CLEF_GITHUB_CLIENT_ID) return process.env.CLEF_GITHUB_CLIENT_ID;
  const id = process.env.CLEF_CLOUD_ENV === "dev" ? GITHUB_CLIENT_ID_DEV : GITHUB_CLIENT_ID_PROD;
  if (id) return id;
  throw new Error(
    "GitHub App client_id is not configured. Set CLEF_GITHUB_CLIENT_ID environment variable.",
  );
}

export const gitHubAuthProvider: AuthProvider = {
  id: "github",
  displayName: "GitHub",

  async login(baseUrl: string, deps: AuthProviderDeps): Promise<ClefCloudCredentials | null> {
    const clientId = resolveClientId();

    deps.formatter.print(`  Opening browser to authenticate with ${this.displayName}...\n`);

    const result = await runDeviceFlow(clientId, baseUrl, async (code) => {
      deps.formatter.print(`  If it doesn't open, go to: ${code.verificationUri}`);
      deps.formatter.print(`  Enter code: ${code.userCode}\n`);
      await deps.openBrowser(code.verificationUri);
    });

    if (result.status === "expired") {
      deps.formatter.error("Sign-in timed out. Try again.");
      return null;
    }
    if (result.status === "access_denied") {
      deps.formatter.error("Sign-in canceled.");
      return null;
    }

    if (!result.credentials) {
      deps.formatter.error("Authentication failed. Try again later.");
      return null;
    }

    return result.credentials;
  },
};
