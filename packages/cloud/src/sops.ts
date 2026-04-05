/**
 * Cloud-aware SopsClient factory.
 *
 * Spawns the keyservice sidecar and creates a SopsClient with the keyservice
 * address for cloud backend decrypt/encrypt operations.
 */
import { SopsClient, SubprocessRunner } from "@clef-sh/core";
import { readCloudCredentials } from "./credentials";
import { resolveKeyservicePath } from "./resolver";
import { spawnKeyservice } from "./keyservice";

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
  const creds = readCloudCredentials();
  const token = process.env.CLEF_CLOUD_TOKEN ?? creds?.token;
  if (!token) {
    throw new Error("Cloud token required. Set CLEF_CLOUD_TOKEN or run 'clef cloud login'.");
  }

  const binaryPath = resolveKeyservicePath().path;
  const handle = await spawnKeyservice({
    binaryPath,
    token,
    endpoint: creds?.endpoint,
  });

  const client = await createSopsClient(repoRoot, runner, handle.addr);
  return {
    client,
    cleanup: () => handle.kill(),
  };
}
