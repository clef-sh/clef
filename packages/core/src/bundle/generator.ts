import * as fs from "fs";
import * as path from "path";
import { ClefManifest, EncryptionBackend, BundleConfig, BundleResult } from "../types";
import { MatrixManager } from "../matrix/manager";
import { generateRuntimeModule } from "./runtime";

/**
 * Generates runtime JS bundles for service identities.
 *
 * Decrypts scoped SOPS files, age-encrypts all values as a single blob
 * to the service identity's per-env public key, and generates a JS module
 * that uses `age-encryption` to decrypt at runtime.
 *
 * @example
 * ```ts
 * const generator = new BundleGenerator(sopsClient, matrixManager);
 * const result = await generator.generate(config, manifest, repoRoot);
 * ```
 */
export class BundleGenerator {
  constructor(
    private readonly encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
  ) {}

  /**
   * Generate a runtime bundle for a service identity + environment.
   *
   * @param config - Bundle configuration (identity, environment, output path, format).
   * @param manifest - Parsed manifest.
   * @param repoRoot - Absolute path to the repository root.
   */
  async generate(
    config: BundleConfig,
    manifest: ClefManifest,
    repoRoot: string,
  ): Promise<BundleResult> {
    const identity = manifest.service_identities?.find((si) => si.name === config.identity);
    if (!identity) {
      throw new Error(`Service identity '${config.identity}' not found in manifest.`);
    }

    const envConfig = identity.environments[config.environment];
    if (!envConfig) {
      throw new Error(
        `Environment '${config.environment}' not found on service identity '${config.identity}'.`,
      );
    }

    // Decrypt all scoped SOPS files and merge values
    const allValues: Record<string, string> = {};
    const cells = this.matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter(
        (c) =>
          c.exists &&
          identity.namespaces.includes(c.namespace) &&
          c.environment === config.environment,
      );

    const isMultiNamespace = identity.namespaces.length > 1;
    const collisions: string[] = [];

    for (const cell of cells) {
      const decrypted = await this.encryption.decrypt(cell.filePath);
      for (const [key, value] of Object.entries(decrypted.values)) {
        const qualifiedKey = isMultiNamespace ? `${cell.namespace}/${key}` : key;
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

    const keyCount = Object.keys(allValues).length;

    // age-encrypt the JSON blob to the service identity's recipient.
    // Note: age-encryption is a runtime dependency that must be installed by the consumer.
    // The generated bundle also dynamically imports age-encryption at runtime for decryption.
    let plaintext = JSON.stringify(allValues);

    let ciphertext: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
      const { Encrypter } = await import("age-encryption" as any);
      const e = new Encrypter();
      e.addRecipient(envConfig.recipient);
      ciphertext = await e.encrypt(plaintext);
    } catch {
      for (const k of Object.keys(allValues)) allValues[k] = "";
      plaintext = "";
      throw new Error("Failed to age-encrypt bundle. Check recipient key.");
    }

    // Best-effort cleanup — immutable strings cannot be reliably scrubbed in a GC runtime
    const keys = Object.keys(allValues);
    for (const k of keys) allValues[k] = "";
    plaintext = "";
    const source = generateRuntimeModule(ciphertext, keys, config.format);

    // Write to disk
    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(config.outputPath, source, "utf-8");

    return {
      outputPath: config.outputPath,
      namespaceCount: identity.namespaces.length,
      keyCount,
      bundleSize: Buffer.byteLength(source, "utf-8"),
    };
  }
}
