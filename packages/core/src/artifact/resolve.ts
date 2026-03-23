import {
  ClefManifest,
  EncryptionBackend,
  ServiceIdentityDefinition,
  ServiceIdentityEnvironmentConfig,
} from "../types";
import { MatrixManager } from "../matrix/manager";

/** Resolved identity secrets: merged key/value map plus metadata. */
export interface ResolvedSecrets {
  /** Flat key/value map (namespace-prefixed if multi-namespace). */
  values: Record<string, string>;
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
  encryption: EncryptionBackend,
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

  const allValues: Record<string, string> = {};
  const cells = matrixManager
    .resolveMatrix(manifest, repoRoot)
    .filter(
      (c) => c.exists && identity.namespaces.includes(c.namespace) && c.environment === environment,
    );

  const isMultiNamespace = identity.namespaces.length > 1;
  const collisions: string[] = [];

  for (const cell of cells) {
    const decrypted = await encryption.decrypt(cell.filePath);
    for (const [key, value] of Object.entries(decrypted.values)) {
      const qualifiedKey = isMultiNamespace ? `${cell.namespace}__${key}` : key;
      if (qualifiedKey in allValues && allValues[qualifiedKey] !== value) {
        collisions.push(qualifiedKey);
      }
      allValues[qualifiedKey] = value;
    }
  }

  if (collisions.length > 0) {
    throw new Error(
      `Key collision detected in bundle: ${collisions.join(", ")}. ` +
        "Keys with the same name but different values exist across namespaces.",
    );
  }

  return {
    values: allValues,
    identity,
    recipient: envConfig.recipient,
    envConfig,
  };
}
