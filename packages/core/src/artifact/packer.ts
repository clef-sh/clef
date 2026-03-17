import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ClefManifest, EncryptionBackend } from "../types";
import { MatrixManager } from "../matrix/manager";
import { PackConfig, PackResult, PackedArtifact } from "./types";
import { resolveIdentitySecrets } from "./resolve";

/**
 * Packs an encrypted artifact for a service identity + environment.
 *
 * The artifact is a JSON envelope containing age-encrypted secrets that can
 * be fetched by the runtime agent via HTTP or local file.
 */
export class ArtifactPacker {
  constructor(
    private readonly encryption: EncryptionBackend,
    private readonly matrixManager: MatrixManager,
  ) {}

  /**
   * Pack an artifact: decrypt scoped SOPS files, age-encrypt the merged
   * values to the service identity's recipient, and write a JSON envelope.
   */
  async pack(config: PackConfig, manifest: ClefManifest, repoRoot: string): Promise<PackResult> {
    const resolved = await resolveIdentitySecrets(
      config.identity,
      config.environment,
      manifest,
      repoRoot,
      this.encryption,
      this.matrixManager,
    );

    const plaintext = JSON.stringify(resolved.values);

    let ciphertext: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
      const { Encrypter } = await import("age-encryption" as any);
      const e = new Encrypter();
      e.addRecipient(resolved.recipient);
      ciphertext = await e.encrypt(plaintext);
    } catch {
      throw new Error("Failed to age-encrypt artifact. Check recipient key.");
    }

    const revision = Date.now().toString();
    const ciphertextHash = crypto.createHash("sha256").update(ciphertext).digest("hex");

    const artifact: PackedArtifact = {
      version: 1,
      identity: config.identity,
      environment: config.environment,
      packedAt: new Date().toISOString(),
      revision,
      ciphertextHash,
      ciphertext,
      keys: Object.keys(resolved.values),
    };

    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const json = JSON.stringify(artifact, null, 2);
    fs.writeFileSync(config.outputPath, json, "utf-8");

    return {
      outputPath: config.outputPath,
      namespaceCount: resolved.identity.namespaces.length,
      keyCount: Object.keys(resolved.values).length,
      artifactSize: Buffer.byteLength(json, "utf-8"),
      revision,
    };
  }
}
