import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import {
  ClefManifest,
  EncryptionBackend,
  ServiceIdentityDefinition,
  ServiceIdentityDriftIssue,
} from "../types";
import { generateAgeIdentity } from "../age/keygen";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";

/**
 * Manages service identities: creation, listing, key rotation, and drift validation.
 *
 * @example
 * ```ts
 * const manager = new ServiceIdentityManager(sopsClient, matrixManager);
 * const result = await manager.create("api-gw", ["api"], "API gateway", manifest, repoRoot);
 * ```
 */
export class ServiceIdentityManager {
  constructor(
    private readonly encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
  ) {}

  /**
   * Create a new service identity with per-environment age key pairs.
   * Generates keys, updates the manifest, and registers public keys as SOPS recipients.
   *
   * @returns The created identity definition and the per-environment private keys (printed once).
   */
  async create(
    name: string,
    namespaces: string[],
    description: string,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<{
    identity: ServiceIdentityDefinition;
    privateKeys: Record<string, string>;
  }> {
    // Validate name uniqueness
    if (manifest.service_identities?.some((si) => si.name === name)) {
      throw new Error(`Service identity '${name}' already exists.`);
    }

    // Validate namespace references
    const validNamespaces = new Set(manifest.namespaces.map((ns) => ns.name));
    for (const ns of namespaces) {
      if (!validNamespaces.has(ns)) {
        throw new Error(`Namespace '${ns}' not found in manifest.`);
      }
    }

    // Generate per-environment key pairs
    const environments: Record<string, { recipient: string }> = {};
    const privateKeys: Record<string, string> = {};

    for (const env of manifest.environments) {
      const identity = await generateAgeIdentity();
      environments[env.name] = { recipient: identity.publicKey };
      privateKeys[env.name] = identity.privateKey;
    }

    const definition: ServiceIdentityDefinition = {
      name,
      description,
      namespaces,
      environments,
    };

    // Update manifest on disk
    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const doc = YAML.parse(raw) as Record<string, unknown>;

    if (!Array.isArray(doc.service_identities)) {
      doc.service_identities = [];
    }
    (doc.service_identities as unknown[]).push({
      name,
      description,
      namespaces,
      environments,
    });
    fs.writeFileSync(manifestPath, YAML.stringify(doc), "utf-8");

    // Register public keys as SOPS recipients on scoped files
    await this.registerRecipients(definition, manifest, repoRoot);

    return { identity: definition, privateKeys };
  }

  /**
   * List all service identities from the manifest.
   */
  list(manifest: ClefManifest): ServiceIdentityDefinition[] {
    return manifest.service_identities ?? [];
  }

  /**
   * Get a single service identity by name.
   */
  get(manifest: ClefManifest, name: string): ServiceIdentityDefinition | undefined {
    return manifest.service_identities?.find((si) => si.name === name);
  }

  /**
   * Register a service identity's public keys as SOPS recipients on scoped matrix files.
   */
  async registerRecipients(
    identity: ServiceIdentityDefinition,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    const cells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);

    for (const cell of cells) {
      if (!identity.namespaces.includes(cell.namespace)) continue;

      const envConfig = identity.environments[cell.environment];
      if (!envConfig) continue;

      try {
        await this.encryption.addRecipient(cell.filePath, envConfig.recipient);
      } catch {
        // File may already have this recipient — continue
      }
    }
  }

  /**
   * Rotate the age key for a service identity (all envs or a specific env).
   * Returns the new private keys.
   */
  async rotateKey(
    name: string,
    manifest: ClefManifest,
    repoRoot: string,
    environment?: string,
  ): Promise<Record<string, string>> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }

    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const doc = YAML.parse(raw) as Record<string, unknown>;
    const identities = doc.service_identities as Record<string, unknown>[];
    const siDoc = identities.find((si) => (si as Record<string, unknown>).name === name) as Record<
      string,
      unknown
    >;
    const envs = siDoc.environments as Record<string, Record<string, string>>;

    const newPrivateKeys: Record<string, string> = {};
    const envsToRotate = environment ? [environment] : Object.keys(identity.environments);

    const cells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);

    for (const envName of envsToRotate) {
      const oldRecipient = identity.environments[envName]?.recipient;
      if (!oldRecipient) {
        throw new Error(`Environment '${envName}' not found on identity '${name}'.`);
      }

      const newIdentity = await generateAgeIdentity();
      newPrivateKeys[envName] = newIdentity.privateKey;

      // Update manifest
      envs[envName] = { recipient: newIdentity.publicKey };

      // Swap recipients on scoped files
      const scopedCells = cells.filter(
        (c) => identity.namespaces.includes(c.namespace) && c.environment === envName,
      );
      for (const cell of scopedCells) {
        try {
          await this.encryption.removeRecipient(cell.filePath, oldRecipient);
        } catch {
          // May not be a current recipient
        }
        await this.encryption.addRecipient(cell.filePath, newIdentity.publicKey);
      }
    }

    fs.writeFileSync(manifestPath, YAML.stringify(doc), "utf-8");
    return newPrivateKeys;
  }

  /**
   * Validate service identities and return drift issues.
   */
  async validate(manifest: ClefManifest, repoRoot: string): Promise<ServiceIdentityDriftIssue[]> {
    const issues: ServiceIdentityDriftIssue[] = [];
    const identities = manifest.service_identities ?? [];

    if (identities.length === 0) return issues;

    const declaredEnvNames = new Set(manifest.environments.map((e) => e.name));
    const declaredNsNames = new Set(manifest.namespaces.map((ns) => ns.name));
    const cells = this.matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);

    for (const si of identities) {
      // Check namespace references
      for (const ns of si.namespaces) {
        if (!declaredNsNames.has(ns)) {
          issues.push({
            identity: si.name,
            namespace: ns,
            type: "namespace_not_found",
            message: `Service identity '${si.name}' references non-existent namespace '${ns}'.`,
          });
        }
      }

      // Check environment coverage
      for (const envName of declaredEnvNames) {
        if (!(envName in si.environments)) {
          issues.push({
            identity: si.name,
            environment: envName,
            type: "missing_environment",
            message: `Service identity '${si.name}' is missing environment '${envName}'.`,
            fixCommand: `clef service rotate ${si.name} --environment ${envName}`,
          });
        }
      }

      // Check recipient registration on scoped files
      for (const cell of cells) {
        const envConfig = si.environments[cell.environment];
        if (!envConfig) continue;

        if (si.namespaces.includes(cell.namespace)) {
          // Should be registered
          try {
            const metadata = await this.encryption.getMetadata(cell.filePath);
            if (!metadata.recipients.includes(envConfig.recipient)) {
              issues.push({
                identity: si.name,
                environment: cell.environment,
                namespace: cell.namespace,
                type: "recipient_not_registered",
                message: `Service identity '${si.name}' recipient is not registered in ${cell.namespace}/${cell.environment}.`,
                fixCommand: `clef service create ${si.name} --namespaces ${si.namespaces.join(",")}`,
              });
            }
          } catch {
            // Cannot read metadata — skip
          }
        } else {
          // Should NOT be registered (scope mismatch)
          try {
            const metadata = await this.encryption.getMetadata(cell.filePath);
            if (metadata.recipients.includes(envConfig.recipient)) {
              issues.push({
                identity: si.name,
                environment: cell.environment,
                namespace: cell.namespace,
                type: "scope_mismatch",
                message: `Service identity '${si.name}' recipient found in ${cell.namespace}/${cell.environment} but namespace '${cell.namespace}' is not in scope.`,
              });
            }
          } catch {
            // Cannot read metadata — skip
          }
        }
      }
    }

    return issues;
  }
}
