/**
 * Creates a SopsClient that is cloud-aware: if any environment in the manifest
 * uses the cloud backend, spawns the keyservice sidecar and passes its address
 * to the SopsClient. Returns a cleanup function to kill the sidecar.
 */
import {
  ClefManifest,
  SopsClient,
  SubprocessRunner,
  readCloudCredentials,
  resolveKeyservicePath,
  spawnKeyservice,
} from "@clef-sh/core";
import { createSopsClient } from "./age-credential";

export interface CloudAwareSopsResult {
  client: SopsClient;
  cleanup: () => Promise<void>;
}

/**
 * Create a SopsClient with cloud backend support.
 *
 * If the manifest has any environment using the "cloud" backend (or
 * default_backend is "cloud"), spawns the keyservice sidecar and creates
 * a SopsClient with the keyservice address.
 *
 * Otherwise, returns a standard age-based SopsClient with a no-op cleanup.
 */
export async function createCloudAwareSopsClient(
  repoRoot: string,
  runner: SubprocessRunner,
  manifest: ClefManifest,
): Promise<CloudAwareSopsResult> {
  const usesCloud =
    manifest.sops.default_backend === "cloud" ||
    manifest.environments.some((e) => e.sops?.backend === "cloud");

  if (!usesCloud) {
    const client = await createSopsClient(repoRoot, runner);
    return { client, cleanup: async () => {} };
  }

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
