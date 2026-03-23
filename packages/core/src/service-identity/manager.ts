import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as YAML from "yaml";
import {
  CLEF_KEYSTORE_NAMESPACE,
  CLEF_KEYSTORE_DESCRIPTION,
  ClefManifest,
  EncryptionBackend,
  KmsConfig,
  ServiceIdentityDefinition,
  ServiceIdentityDriftIssue,
  ServiceIdentityEnvironmentConfig,
  isKmsEnvelope,
} from "../types";
import { generateAgeIdentity } from "../age/keygen";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";

/**
 * Thrown when key rotation partially completes before a failure.
 * Contains the private keys for environments that were successfully rotated.
 */
export class PartialRotationError extends Error {
  constructor(
    message: string,
    public readonly rotatedKeys: Record<string, string>,
  ) {
    super(message);
    this.name = "PartialRotationError";
  }
}

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
   * Create a new service identity with per-environment age key pairs or KMS envelope config.
   * For age-only: generates keys, updates the manifest, and registers public keys as SOPS recipients.
   * For KMS: stores KMS config in manifest, no age keys generated.
   *
   * @param kmsEnvConfigs - Optional per-environment KMS config. When provided, those envs use
   *   KMS envelope encryption instead of generating age keys.
   * @returns The created identity definition and the per-environment private keys (empty for KMS envs).
   */
  async create(
    name: string,
    namespaces: string[],
    description: string,
    manifest: ClefManifest,
    repoRoot: string,
    kmsEnvConfigs?: Record<string, KmsConfig>,
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

    // Generate per-environment config
    const environments: Record<string, ServiceIdentityEnvironmentConfig> = {};
    const privateKeys: Record<string, string> = {};

    for (const env of manifest.environments) {
      const kmsConfig = kmsEnvConfigs?.[env.name];
      if (kmsConfig) {
        // KMS envelope path — no age keys generated
        environments[env.name] = { kms: kmsConfig };
      } else {
        // Age-only path
        const identity = await generateAgeIdentity();
        environments[env.name] = { recipient: identity.publicKey };
        privateKeys[env.name] = identity.privateKey;
      }
    }

    const definition: ServiceIdentityDefinition = {
      name,
      description,
      namespaces,
      environments,
    };

    // Register public keys as SOPS recipients on scoped files BEFORE writing
    // the manifest, so a registration failure doesn't leave orphaned state.
    // (Only for age-only environments — KMS envs have no recipient to register.)
    await this.registerRecipients(definition, manifest, repoRoot);

    // Store private keys in the _keystore namespace
    if (Object.keys(privateKeys).length > 0) {
      await this.storeKeys(name, privateKeys, manifest, repoRoot);
    }

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
    const tmpCreate = path.join(os.tmpdir(), `clef-manifest-${process.pid}-${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmpCreate, YAML.stringify(doc), "utf-8");
      fs.renameSync(tmpCreate, manifestPath);
    } finally {
      try {
        fs.unlinkSync(tmpCreate);
      } catch {
        // Already renamed or never written — ignore
      }
    }

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
   * Ensure the _keystore namespace exists in the manifest and on disk.
   * Creates the namespace entry and scaffolds empty encrypted files for each environment.
   */
  async ensureKeystoreNamespace(manifest: ClefManifest, repoRoot: string): Promise<void> {
    const exists = manifest.namespaces.some((ns) => ns.name === CLEF_KEYSTORE_NAMESPACE);
    if (exists) return;

    manifest.namespaces.push({
      name: CLEF_KEYSTORE_NAMESPACE,
      description: CLEF_KEYSTORE_DESCRIPTION,
    });

    const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const doc = YAML.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(doc.namespaces)) {
      doc.namespaces = [];
    }
    (doc.namespaces as unknown[]).push({
      name: CLEF_KEYSTORE_NAMESPACE,
      description: CLEF_KEYSTORE_DESCRIPTION,
    });
    const tmp = path.join(os.tmpdir(), `clef-manifest-${process.pid}-${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmp, YAML.stringify(doc), "utf-8");
      fs.renameSync(tmp, manifestPath);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Already renamed or never written — ignore
      }
    }

    const keystoreCells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.namespace === CLEF_KEYSTORE_NAMESPACE && !c.exists);
    for (const cell of keystoreCells) {
      await this.matrixManager.scaffoldCell(cell, this.encryption, manifest);
    }
  }

  /**
   * Store private keys in the _keystore namespace.
   * For each environment with a private key, decrypts the keystore file,
   * adds/updates the key, and re-encrypts.
   */
  async storeKeys(
    identityName: string,
    privateKeys: Record<string, string>,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<void> {
    await this.ensureKeystoreNamespace(manifest, repoRoot);

    for (const [envName, privateKey] of Object.entries(privateKeys)) {
      const relativePath = manifest.file_pattern
        .replace("{namespace}", CLEF_KEYSTORE_NAMESPACE)
        .replace("{environment}", envName);
      const filePath = path.join(repoRoot, relativePath);

      let existingValues: Record<string, string> = {};
      if (fs.existsSync(filePath)) {
        try {
          const decrypted = await this.encryption.decrypt(filePath);
          existingValues = decrypted.values;
        } catch {
          // File exists but cannot be decrypted — start fresh
        }
      }

      existingValues[identityName] = privateKey;
      await this.encryption.encrypt(filePath, existingValues, manifest, envName);
    }
  }

  /**
   * Retrieve a service identity's private key from the _keystore namespace.
   */
  async getKey(
    identityName: string,
    environment: string,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<string | undefined> {
    const keystoreNs = manifest.namespaces.find((ns) => ns.name === CLEF_KEYSTORE_NAMESPACE);
    if (!keystoreNs) return undefined;

    const relativePath = manifest.file_pattern
      .replace("{namespace}", CLEF_KEYSTORE_NAMESPACE)
      .replace("{environment}", environment);
    const filePath = path.join(repoRoot, relativePath);

    if (!fs.existsSync(filePath)) return undefined;

    try {
      const decrypted = await this.encryption.decrypt(filePath);
      return decrypted.values[identityName];
    } catch {
      return undefined;
    }
  }

  /**
   * Remove a service identity's private keys from the _keystore namespace.
   * Decrypts each keystore file, removes the identity's entry, and re-encrypts.
   */
  async deleteKeys(identityName: string, manifest: ClefManifest, repoRoot: string): Promise<void> {
    const keystoreNs = manifest.namespaces.find((ns) => ns.name === CLEF_KEYSTORE_NAMESPACE);
    if (!keystoreNs) return;

    for (const env of manifest.environments) {
      const relativePath = manifest.file_pattern
        .replace("{namespace}", CLEF_KEYSTORE_NAMESPACE)
        .replace("{environment}", env.name);
      const filePath = path.join(repoRoot, relativePath);

      if (!fs.existsSync(filePath)) continue;

      try {
        const decrypted = await this.encryption.decrypt(filePath);
        if (!(identityName in decrypted.values)) continue;

        delete decrypted.values[identityName];
        await this.encryption.encrypt(filePath, decrypted.values, manifest, env.name);
      } catch {
        // Cannot decrypt — skip this environment
      }
    }
  }

  /**
   * Check which environments have stored keys for a service identity.
   * Returns a map of environment name → boolean.
   */
  async hasStoredKeys(
    identityName: string,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    const keystoreNs = manifest.namespaces.find((ns) => ns.name === CLEF_KEYSTORE_NAMESPACE);

    for (const env of manifest.environments) {
      if (!keystoreNs) {
        result[env.name] = false;
        continue;
      }

      const relativePath = manifest.file_pattern
        .replace("{namespace}", CLEF_KEYSTORE_NAMESPACE)
        .replace("{environment}", env.name);
      const filePath = path.join(repoRoot, relativePath);

      if (!fs.existsSync(filePath)) {
        result[env.name] = false;
        continue;
      }

      try {
        const decrypted = await this.encryption.decrypt(filePath);
        result[env.name] = identityName in decrypted.values;
      } catch {
        result[env.name] = false;
      }
    }

    return result;
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

      // KMS-backed environments have no recipient to register
      if (isKmsEnvelope(envConfig)) continue;
      if (!envConfig.recipient) continue;

      try {
        await this.encryption.addRecipient(cell.filePath, envConfig.recipient);
      } catch (err) {
        // SOPS exits non-zero for duplicate recipients — safe to ignore.
        // Re-throw genuine I/O or corruption errors.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("already")) {
          throw err;
        }
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

    try {
      for (const envName of envsToRotate) {
        const envConfig = identity.environments[envName];
        if (!envConfig) {
          throw new Error(`Environment '${envName}' not found on identity '${name}'.`);
        }
        // KMS-backed environments don't have age keys to rotate
        if (isKmsEnvelope(envConfig)) continue;
        const oldRecipient = envConfig.recipient;
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
          try {
            await this.encryption.addRecipient(cell.filePath, newIdentity.publicKey);
          } catch (addErr) {
            // Attempt rollback: re-add old recipient
            try {
              await this.encryption.addRecipient(cell.filePath, oldRecipient);
            } catch {
              throw new Error(
                `Failed to add new recipient to ${cell.namespace}/${cell.environment} and rollback also failed. ` +
                  `File may be in an inconsistent state. ` +
                  `Old key: ${oldRecipient.slice(0, 12)}..., New key: ${newIdentity.publicKey.slice(0, 12)}...`,
              );
            }
            throw addErr;
          }
        }
      }
    } catch (err) {
      // Store any successfully rotated keys before throwing
      if (Object.keys(newPrivateKeys).length > 0) {
        try {
          await this.storeKeys(name, newPrivateKeys, manifest, repoRoot);
        } catch {
          // Best-effort — don't mask the original error
        }
        const partialErr = new PartialRotationError(
          `Rotation failed after rotating ${Object.keys(newPrivateKeys).join(", ")}: ${(err as Error).message}`,
          newPrivateKeys,
        );
        throw partialErr;
      }
      throw err;
    }

    // Store rotated keys in the _keystore namespace
    if (Object.keys(newPrivateKeys).length > 0) {
      await this.storeKeys(name, newPrivateKeys, manifest, repoRoot);
    }

    const tmpRotate = path.join(os.tmpdir(), `clef-manifest-${process.pid}-${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmpRotate, YAML.stringify(doc), "utf-8");
      fs.renameSync(tmpRotate, manifestPath);
    } finally {
      try {
        fs.unlinkSync(tmpRotate);
      } catch {
        // Already renamed or never written — ignore
      }
    }
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
            message: `Service identity '${si.name}' is missing environment '${envName}'. Manually add an age key pair for this environment in clef.yaml.`,
          });
        }
      }

      // Check recipient registration on scoped files
      // (KMS-backed environments skip recipient checks — no recipient to register)
      for (const cell of cells) {
        const envConfig = si.environments[cell.environment];
        if (!envConfig) continue;
        if (isKmsEnvelope(envConfig)) continue;
        if (!envConfig.recipient) continue;

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
                fixCommand: `clef recipients remove ${envConfig.recipient} -e ${cell.environment}`,
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
