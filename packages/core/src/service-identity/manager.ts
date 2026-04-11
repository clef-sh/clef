import * as path from "path";
import {
  ClefManifest,
  EncryptionBackend,
  KmsConfig,
  MatrixCell,
  ServiceIdentityDefinition,
  ServiceIdentityDriftIssue,
  ServiceIdentityEnvironmentConfig,
  isKmsEnvelope,
} from "../types";
import { generateAgeIdentity } from "../age/keygen";
import { MatrixManager } from "../matrix/manager";
import { CLEF_MANIFEST_FILENAME } from "../manifest/parser";
import { readManifestYaml, writeManifestYaml } from "../manifest/io";
import { TransactionManager } from "../tx";

/**
 * Manages service identities: creation, listing, key rotation, and drift validation.
 *
 * Mutating methods (create, delete, addNamespacesToScope, etc.) wrap their
 * work in a TransactionManager so a failure rolls back ALL of the cell-file
 * + manifest writes via `git reset --hard` rather than leaving the matrix in
 * a partial state.
 *
 * @example
 * ```ts
 * const tx = new TransactionManager(new GitIntegration(runner));
 * const manager = new ServiceIdentityManager(sopsClient, matrixManager, tx);
 * const result = await manager.create("api-gw", ["api"], "API gateway", manifest, repoRoot);
 * ```
 */
export class ServiceIdentityManager {
  constructor(
    private readonly encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
    private readonly tx: TransactionManager,
  ) {}

  /**
   * Compute repo-relative paths for a set of cells plus the manifest. Used
   * to seed TransactionManager.run's `paths` argument.
   */
  private txPaths(repoRoot: string, cells: MatrixCell[]): string[] {
    return [...cells.map((c) => path.relative(repoRoot, c.filePath)), CLEF_MANIFEST_FILENAME];
  }

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

    // Generate per-environment config (key generation is read-only — happens
    // outside the transaction so we can return private keys regardless of
    // git state).
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

    // Touched cells: every existing cell in (this SI's namespaces × all envs).
    // The manifest is also touched. We pre-compute paths so the transaction
    // can stage them and roll them back atomically on failure.
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && namespaces.includes(c.namespace));

    await this.tx.run(repoRoot, {
      description: `clef service create ${name}`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        // Register public keys as SOPS recipients on scoped files BEFORE
        // writing the manifest. (KMS envs have no recipient to register.)
        await this.registerRecipients(definition, manifest, repoRoot);

        const doc = readManifestYaml(repoRoot);
        if (!Array.isArray(doc.service_identities)) {
          doc.service_identities = [];
        }
        (doc.service_identities as unknown[]).push({
          name,
          description,
          namespaces,
          environments,
        });
        writeManifestYaml(repoRoot, doc);
      },
    });

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
   * Delete a service identity: remove its recipients from scoped SOPS files
   * and remove it from the manifest.
   */
  async delete(name: string, manifest: ClefManifest, repoRoot: string): Promise<void> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }

    const scopedCells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && identity.namespaces.includes(c.namespace));

    await this.tx.run(repoRoot, {
      description: `clef service delete ${name}`,
      paths: this.txPaths(repoRoot, scopedCells),
      mutate: async () => {
        for (const cell of scopedCells) {
          const envConfig = identity.environments[cell.environment];
          if (!envConfig?.recipient) continue;
          if (isKmsEnvelope(envConfig)) continue;

          try {
            await this.encryption.removeRecipient(cell.filePath, envConfig.recipient);
          } catch {
            // May not be a current recipient
          }
        }

        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        if (Array.isArray(identities)) {
          doc.service_identities = identities.filter(
            (si) => (si as Record<string, unknown>).name !== name,
          );
        }
        writeManifestYaml(repoRoot, doc);
      },
    });
  }

  /**
   * Update environment backends on an existing service identity.
   * Switches age → KMS (removes old recipient) or updates KMS config.
   * Returns new private keys for any environments switched from KMS → age.
   */
  async updateEnvironments(
    name: string,
    kmsEnvConfigs: Record<string, KmsConfig>,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<{ privateKeys: Record<string, string> }> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }

    // Validate every requested env exists on the identity before opening the
    // transaction — preflight failures should not commit anything.
    for (const envName of Object.keys(kmsEnvConfigs)) {
      if (!identity.environments[envName]) {
        throw new Error(`Environment '${envName}' not found on identity '${name}'.`);
      }
    }

    const targetEnvNames = new Set(Object.keys(kmsEnvConfigs));
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter(
        (c) =>
          c.exists &&
          identity.namespaces.includes(c.namespace) &&
          targetEnvNames.has(c.environment),
      );

    await this.tx.run(repoRoot, {
      description: `clef service update ${name}: switch ${[...targetEnvNames].join(",")} to KMS`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        const siDoc = identities.find(
          (si) => (si as Record<string, unknown>).name === name,
        ) as Record<string, unknown>;
        const envs = siDoc.environments as Record<string, Record<string, unknown>>;

        for (const [envName, kmsConfig] of Object.entries(kmsEnvConfigs)) {
          const oldConfig = identity.environments[envName];
          // If switching age → KMS, strip the old recipient from scoped files
          if (oldConfig?.recipient && !isKmsEnvelope(oldConfig)) {
            const scopedCells = cells.filter((c) => c.environment === envName);
            for (const cell of scopedCells) {
              try {
                await this.encryption.removeRecipient(cell.filePath, oldConfig.recipient);
              } catch {
                // May not be a current recipient
              }
            }
          }
          envs[envName] = { kms: kmsConfig };
          identity.environments[envName] = { kms: kmsConfig };
        }

        writeManifestYaml(repoRoot, doc);
      },
    });

    return { privateKeys: {} };
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
   * Expand a service identity's namespace scope. Registers the SI's existing
   * per-env recipient on every matrix cell in the new namespace × env
   * combinations. KMS-backed environments are skipped (no recipient to
   * register).
   *
   * Idempotent: namespaces already in scope are silently skipped. Refuses if
   * any requested namespace does not exist in the manifest.
   */
  async addNamespacesToScope(
    name: string,
    namespacesToAdd: string[],
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<{ added: string[]; affectedFiles: string[] }> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }

    // Validate every namespace exists in the manifest
    const manifestNamespaceNames = new Set(manifest.namespaces.map((n) => n.name));
    const unknown = namespacesToAdd.filter((n) => !manifestNamespaceNames.has(n));
    if (unknown.length > 0) {
      throw new Error(
        `Namespace(s) not found in manifest: ${unknown.join(", ")}. ` +
          `Available: ${manifest.namespaces.map((n) => n.name).join(", ")}`,
      );
    }

    // Filter out namespaces already in scope (idempotent no-op)
    const existingScope = new Set(identity.namespaces);
    const toAdd = namespacesToAdd.filter((n) => !existingScope.has(n));
    if (toAdd.length === 0) {
      return { added: [], affectedFiles: [] };
    }

    // Affected cells: every existing cell in (newly-scoped namespaces × all envs)
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && toAdd.includes(c.namespace));
    const affectedFiles: string[] = [];

    await this.tx.run(repoRoot, {
      description: `clef service update ${name}: add namespaces ${toAdd.join(",")}`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        for (const cell of cells) {
          const envConfig = identity.environments[cell.environment];
          if (!envConfig) continue;
          if (isKmsEnvelope(envConfig)) continue;
          if (!envConfig.recipient) continue;

          try {
            await this.encryption.addRecipient(cell.filePath, envConfig.recipient);
            affectedFiles.push(cell.filePath);
          } catch (err) {
            // SOPS may exit non-zero for duplicate recipients — safe to ignore
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes("already")) {
              throw err;
            }
          }
        }

        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        const siDoc = identities.find(
          (si) => (si as Record<string, unknown>).name === name,
        ) as Record<string, unknown>;
        siDoc.namespaces = [...identity.namespaces, ...toAdd];
        writeManifestYaml(repoRoot, doc);
      },
    });

    return { added: toAdd, affectedFiles };
  }

  /**
   * Shrink a service identity's namespace scope. De-registers the SI's
   * per-env recipient from every matrix cell in the removed namespace × env
   * combinations. KMS-backed environments are skipped (no recipient to remove).
   *
   * Refuses if removing would leave the SI with zero namespaces — point the
   * caller at `clef service delete` for that case. Refuses if any requested
   * namespace is not currently in the SI's scope.
   */
  async removeNamespacesFromScope(
    name: string,
    namespacesToRemove: string[],
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<{ removed: string[]; affectedFiles: string[] }> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }

    // Validate every namespace is currently in scope
    const currentScope = new Set(identity.namespaces);
    const notInScope = namespacesToRemove.filter((n) => !currentScope.has(n));
    if (notInScope.length > 0) {
      throw new Error(
        `Namespace(s) not in scope of '${name}': ${notInScope.join(", ")}. ` +
          `Current scope: ${identity.namespaces.join(", ")}`,
      );
    }

    // Refuse if it would leave zero namespaces
    const remaining = identity.namespaces.filter((n) => !namespacesToRemove.includes(n));
    if (remaining.length === 0) {
      throw new Error(
        `Cannot remove the last namespace from service identity '${name}'. ` +
          `Use \`clef service delete ${name}\` to delete the identity instead.`,
      );
    }

    // Affected cells: every existing cell in (removed namespaces × all envs)
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && namespacesToRemove.includes(c.namespace));
    const affectedFiles: string[] = [];

    await this.tx.run(repoRoot, {
      description: `clef service update ${name}: remove namespaces ${namespacesToRemove.join(",")}`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        for (const cell of cells) {
          const envConfig = identity.environments[cell.environment];
          if (!envConfig) continue;
          if (isKmsEnvelope(envConfig)) continue;
          if (!envConfig.recipient) continue;

          try {
            await this.encryption.removeRecipient(cell.filePath, envConfig.recipient);
            affectedFiles.push(cell.filePath);
          } catch {
            // May not be a current recipient — safe to skip
          }
        }

        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        const siDoc = identities.find(
          (si) => (si as Record<string, unknown>).name === name,
        ) as Record<string, unknown>;
        siDoc.namespaces = remaining;
        writeManifestYaml(repoRoot, doc);
      },
    });

    return { removed: namespacesToRemove, affectedFiles };
  }

  /**
   * Extend a service identity to cover an additional environment. Generates a
   * fresh age key for the new env (or uses the supplied KMS config), registers
   * the new recipient on every cell in the SI's scoped namespaces × this env,
   * and adds the env entry to the SI's `environments{}` map in the manifest.
   *
   * Used as the explicit follow-up to `clef env add`. The env-add command
   * deliberately doesn't cascade to existing SIs — `clef lint` reports the
   * gap as a `missing_environment` issue and the user runs this method (via
   * `clef service add-env <si> <env>`) once per SI to fill it in,
   * choosing the backend deliberately at that moment.
   *
   * Refuses if the SI doesn't exist, the env doesn't exist in the manifest,
   * or the env is already configured on the SI.
   *
   * @returns The new private key (for age) or `undefined` (for KMS), keyed
   *   by env name. The caller is responsible for storing it securely.
   */
  async addEnvironmentToScope(
    name: string,
    envName: string,
    manifest: ClefManifest,
    repoRoot: string,
    kmsConfig?: KmsConfig,
  ): Promise<{ privateKey: string | undefined }> {
    const identity = this.get(manifest, name);
    if (!identity) {
      throw new Error(`Service identity '${name}' not found.`);
    }
    if (!manifest.environments.some((e) => e.name === envName)) {
      throw new Error(
        `Environment '${envName}' not found in manifest. ` +
          `Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
      );
    }
    if (identity.environments[envName]) {
      throw new Error(
        `Service identity '${name}' already has a config for environment '${envName}'. ` +
          `Use 'clef service update --kms-env ${envName}=<provider>:<keyId>' to switch backends.`,
      );
    }

    // Generate the new env config outside the transaction so the caller gets
    // the private key back even if the git commit fails (the key is material
    // the user needs to install regardless).
    let envConfig: ServiceIdentityEnvironmentConfig;
    let privateKey: string | undefined;
    if (kmsConfig) {
      envConfig = { kms: kmsConfig };
    } else {
      const newIdentity = await generateAgeIdentity();
      envConfig = { recipient: newIdentity.publicKey };
      privateKey = newIdentity.privateKey;
    }

    // Affected cells: every existing cell in (SI's scoped namespaces × this env)
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter(
        (c) => c.exists && identity.namespaces.includes(c.namespace) && c.environment === envName,
      );

    await this.tx.run(repoRoot, {
      description: `clef service add-env ${name} ${envName}`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        // For age envs, register the new recipient on every scoped cell.
        // KMS envs have no recipient on the cells — the cells are encrypted
        // to the KMS-managed envelope key.
        if (!isKmsEnvelope(envConfig) && envConfig.recipient) {
          for (const cell of cells) {
            try {
              await this.encryption.addRecipient(cell.filePath, envConfig.recipient);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              if (!message.includes("already")) {
                throw err;
              }
            }
          }
        }

        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        const siDoc = identities.find(
          (si) => (si as Record<string, unknown>).name === name,
        ) as Record<string, unknown>;
        const envs = siDoc.environments as Record<string, unknown>;
        envs[envName] = envConfig;
        writeManifestYaml(repoRoot, doc);
      },
    });

    return { privateKey };
  }

  /**
   * Rotate the age key for a service identity (all envs or a specific env).
   * Returns the new private keys.
   *
   * The whole rotation runs inside a single transaction: any cell-write
   * failure rolls back ALL recipient swaps and the manifest update via
   * `git reset --hard` to the pre-rotation state. The previous in-method
   * `PartialRotationError` rollback dance is no longer needed.
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

    const envsToRotate = environment ? [environment] : Object.keys(identity.environments);

    // Validate envs exist on the identity before opening the transaction.
    for (const envName of envsToRotate) {
      const envConfig = identity.environments[envName];
      if (!envConfig) {
        throw new Error(`Environment '${envName}' not found on identity '${name}'.`);
      }
    }

    // Pre-generate all new keys outside the transaction so the caller gets
    // them even if the git commit step itself fails (the keys are already
    // material that the user will need to install regardless).
    const newPrivateKeys: Record<string, string> = {};
    const newPublicKeys: Record<string, string> = {};
    for (const envName of envsToRotate) {
      const envConfig = identity.environments[envName];
      if (isKmsEnvelope(envConfig)) continue;
      if (!envConfig.recipient) continue;
      const newIdentity = await generateAgeIdentity();
      newPrivateKeys[envName] = newIdentity.privateKey;
      newPublicKeys[envName] = newIdentity.publicKey;
    }

    const targetEnvNames = new Set(Object.keys(newPublicKeys));
    if (targetEnvNames.size === 0) {
      // Nothing to rotate (all targeted envs are KMS-backed or have no recipient).
      return newPrivateKeys;
    }

    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter(
        (c) =>
          c.exists &&
          identity.namespaces.includes(c.namespace) &&
          targetEnvNames.has(c.environment),
      );

    await this.tx.run(repoRoot, {
      description: `clef service rotate ${name}${environment ? `:${environment}` : ""}`,
      paths: this.txPaths(repoRoot, cells),
      mutate: async () => {
        const doc = readManifestYaml(repoRoot);
        const identities = doc.service_identities as Record<string, unknown>[];
        const siDoc = identities.find(
          (si) => (si as Record<string, unknown>).name === name,
        ) as Record<string, unknown>;
        const envs = siDoc.environments as Record<string, Record<string, string>>;

        for (const envName of targetEnvNames) {
          const oldRecipient = identity.environments[envName].recipient!;
          const newPublicKey = newPublicKeys[envName];

          envs[envName] = { recipient: newPublicKey };

          const scopedCells = cells.filter((c) => c.environment === envName);
          for (const cell of scopedCells) {
            try {
              await this.encryption.removeRecipient(cell.filePath, oldRecipient);
            } catch {
              // May not be a current recipient — safe to skip
            }
            // No try/catch around add: failure here triggers full transaction
            // rollback (git reset --hard), which is safer than the old manual
            // re-add dance.
            await this.encryption.addRecipient(cell.filePath, newPublicKey);
          }
        }

        writeManifestYaml(repoRoot, doc);
      },
    });

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
            message: `Service identity '${si.name}' has no config for environment '${envName}'.`,
            fixCommand: `clef service add-env ${si.name} ${envName}`,
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
