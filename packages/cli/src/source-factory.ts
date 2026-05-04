/**
 * CLI helper that builds the composed `SecretSource` consumers should use
 * after the Phase 3+ migration. Wraps `createSopsClient` (which handles
 * age-credential resolution + HSM keyservice spawning) and layers in the
 * orthogonal `StorageBackend` + `EncryptionBackend` abstractions.
 *
 * The `cleanup` function returned here is the same `cleanup` from
 * `createSopsClient` — it tears down any spawned HSM keyservice. Always
 * call it in a finally block.
 */
import {
  composeSecretSource,
  createSopsEncryptionBackend,
  FilesystemStorageBackend,
  type ClefManifest,
  type SecretSource,
  type SubprocessRunner,
  type Bulk,
  type Lintable,
  type Rotatable,
} from "@clef-sh/core";
import { createSopsClient } from "./age-credential";

export interface SecretSourceHandle {
  source: SecretSource & Lintable & Rotatable & Bulk;
  cleanup: () => Promise<void>;
}

/**
 * Build the default `(filesystem, sops)` composition for the current
 * working tree.
 */
export async function createSecretSource(
  repoRoot: string,
  runner: SubprocessRunner,
  manifest: ClefManifest,
): Promise<SecretSourceHandle> {
  const { client, cleanup } = await createSopsClient(repoRoot, runner, manifest);
  const storage = new FilesystemStorageBackend(manifest, repoRoot);
  const encryption = createSopsEncryptionBackend(client);
  const source = composeSecretSource(storage, encryption, manifest);
  return { source, cleanup };
}
