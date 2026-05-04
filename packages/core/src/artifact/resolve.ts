import {
  ClefManifest,
  FileEncryptionBackend,
  ServiceIdentityDefinition,
  ServiceIdentityEnvironmentConfig,
} from "../types";
import { MatrixManager } from "../matrix/manager";

/** Resolved identity secrets: namespace → key → value, plus metadata. */
export interface ResolvedSecrets {
  /**
   * Nested map keyed by namespace, then by key name. The on-the-wire ciphertext
   * payload uses this exact shape — namespace structure stays inside the
   * encrypted blob, never in clear metadata.
   */
  values: Record<string, Record<string, string>>;
  /** The matched service identity definition. */
  identity: ServiceIdentityDefinition;
  /** Age public key for the target environment (undefined for KMS identities). */
  recipient?: string;
  /** Full environment config (age-only or KMS). */
  envConfig: ServiceIdentityEnvironmentConfig;
}

/**
 * Decrypt and merge scoped SOPS files for a service identity + environment.
 *
 * Shared by `ArtifactPacker` (and any future consumers) to avoid duplicating
 * the decrypt-merge-collision-check logic.
 */
export async function resolveIdentitySecrets(
  identityName: string,
  environment: string,
  manifest: ClefManifest,
  repoRoot: string,
  encryption: FileEncryptionBackend,
  matrixManager: MatrixManager,
): Promise<ResolvedSecrets> {
  const identity = manifest.service_identities?.find((si) => si.name === identityName);
  if (!identity) {
    throw new Error(`Service identity '${identityName}' not found in manifest.`);
  }

  const envConfig = identity.environments[environment];
  if (!envConfig) {
    throw new Error(
      `Environment '${environment}' not found on service identity '${identityName}'.`,
    );
  }

  const allValues: Record<string, Record<string, string>> = {};
  const cells = matrixManager
    .resolveMatrix(manifest, repoRoot)
    .filter(
      (c) => c.exists && identity.namespaces.includes(c.namespace) && c.environment === environment,
    );

  for (const cell of cells) {
    const decrypted = await encryption.decrypt(cell.filePath);
    const bucket = (allValues[cell.namespace] ??= {});
    for (const [key, value] of Object.entries(decrypted.values)) {
      // Same-namespace key collisions can't happen via the matrix (each cell
      // is one namespace × one environment file), but a defensive check
      // catches future code paths that may merge multiple files per cell.
      if (key in bucket && bucket[key] !== value) {
        throw new Error(
          `Key collision in namespace '${cell.namespace}': '${key}' set to different values.`,
        );
      }
      bucket[key] = value;
    }
  }

  return {
    values: allValues,
    identity,
    recipient: envConfig.recipient,
    envConfig,
  };
}
