/**
 * Creates a SopsClient that is cloud-aware: if any environment in the manifest
 * uses the cloud backend, dynamically loads @clef-sh/cloud to spawn the
 * keyservice sidecar and passes its address to the SopsClient.
 */
import { ClefManifest, SopsClient, SubprocessRunner } from "@clef-sh/core";
import { createSopsClient } from "./age-credential";

export interface CloudAwareSopsResult {
  client: SopsClient;
  cleanup: () => Promise<void>;
}

/**
 * Create a SopsClient with cloud backend support.
 *
 * If the manifest has any environment using the "cloud" backend (or
 * default_backend is "cloud"), dynamically imports @clef-sh/cloud to spawn
 * the keyservice sidecar and creates a SopsClient with the keyservice address.
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

  let cloud;
  try {
    cloud = await import("@clef-sh/cloud");
  } catch {
    throw new Error(
      "This repository uses the Cloud backend but @clef-sh/cloud is not installed.\n" +
        "Install it with: npm install @clef-sh/cloud",
    );
  }

  return cloud.createCloudSopsClient(repoRoot, runner, createSopsClient);
}
