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
 * Not a secret — appears in OAuth URLs. Defaults to the production
 * `clef-cloud` GitHub App. To point at a different App (e.g. `clef-bot-dev`
 * or your own fork's App for local development), set CLEF_GITHUB_CLIENT_ID.
 */
const GITHUB_CLIENT_ID = "Iv23liidcYDzL4QhFK0k"; // clef-cloud GitHub App

function resolveClientId(): string {
  return process.env.CLEF_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
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
