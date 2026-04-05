/**
 * Cloud-aware SopsClient factory.
 *
 * Spawns the keyservice sidecar and creates a SopsClient with the keyservice
 * address for cloud backend decrypt/encrypt operations.
 */
import { SopsClient, SubprocessRunner } from "@clef-sh/core";
import { readCloudCredentials, writeCloudCredentials } from "./credentials";
import { resolveKeyservicePath } from "./resolver";
import { spawnKeyservice } from "./keyservice";
import { refreshAccessToken } from "./token-refresh";

export interface CloudSopsResult {
  client: SopsClient;
  cleanup: () => Promise<void>;
}

export type CreateSopsClientFn = (
  repoRoot: string,
  runner: SubprocessRunner,
  keyserviceAddr?: string,
) => Promise<SopsClient>;

/**
 * Resolve a fresh Cognito access token.
 *
 * Priority:
 *   1. CLEF_CLOUD_REFRESH_TOKEN env var (CI)
 *   2. ~/.clef/credentials.yaml refreshToken (interactive)
 *
 * If a cached access token exists and hasn't expired, returns it.
 * Otherwise refreshes via the Cognito token endpoint.
 */
export async function resolveAccessToken(): Promise<{ accessToken: string; endpoint?: string }> {
  const creds = readCloudCredentials();
  const refreshToken = process.env.CLEF_CLOUD_REFRESH_TOKEN ?? creds?.refreshToken;

  if (!refreshToken) {
    throw new Error("Not authenticated. Run 'clef cloud login' to connect to Clef Cloud.");
  }

  if (!creds?.cognitoDomain || !creds?.clientId) {
    throw new Error("Missing Cognito configuration. Run 'clef cloud login' to re-authenticate.");
  }

  if (
    creds.accessToken &&
    creds.accessTokenExpiry &&
    Date.now() < creds.accessTokenExpiry - 60000
  ) {
    return { accessToken: creds.accessToken, endpoint: creds.endpoint };
  }

  const result = await refreshAccessToken({
    cognitoDomain: creds.cognitoDomain,
    clientId: creds.clientId,
    refreshToken,
  });

  writeCloudCredentials({
    ...creds,
    refreshToken,
    accessToken: result.accessToken,
    accessTokenExpiry: Date.now() + result.expiresIn * 1000,
  });

  return { accessToken: result.accessToken, endpoint: creds?.endpoint };
}

/**
 * Create a SopsClient backed by the cloud keyservice sidecar.
 *
 * @param repoRoot - Repository root directory.
 * @param runner - Subprocess runner for SOPS invocations.
 * @param createSopsClient - Factory function from the CLI to create a SopsClient
 *   (handles age credential resolution).
 */
export async function createCloudSopsClient(
  repoRoot: string,
  runner: SubprocessRunner,
  createSopsClient: CreateSopsClientFn,
): Promise<CloudSopsResult> {
  const { accessToken, endpoint } = await resolveAccessToken();

  const binaryPath = resolveKeyservicePath().path;
  const handle = await spawnKeyservice({
    binaryPath,
    token: accessToken,
    endpoint,
  });

  const client = await createSopsClient(repoRoot, runner, handle.addr);
  return {
    client,
    cleanup: () => handle.kill(),
  };
}
