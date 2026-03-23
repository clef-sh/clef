import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ClefManifest, EncryptionBackend, isKmsEnvelope } from "../types";
import { KmsProvider } from "../kms";
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
    private readonly kms?: KmsProvider,
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
    let artifact: PackedArtifact;

    if (isKmsEnvelope(resolved.envConfig)) {
      // KMS envelope path
      if (!this.kms) {
        throw new Error("KMS provider required for envelope encryption but none was provided.");
      }

      // Generate ephemeral age key pair
      const { generateIdentity, identityToRecipient, Encrypter } = await import(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
        "age-encryption" as any
      );
      const ephemeralPrivateKey = (await generateIdentity()) as string;
      const ephemeralPublicKey = (await identityToRecipient(ephemeralPrivateKey)) as string;

      try {
        const e = new Encrypter();
        e.addRecipient(ephemeralPublicKey);
        const encrypted = await e.encrypt(plaintext);
        ciphertext =
          typeof encrypted === "string"
            ? encrypted
            : new TextDecoder().decode(encrypted as Uint8Array);
      } catch {
        throw new Error("Failed to age-encrypt artifact with ephemeral key.");
      }

      // Wrap the ephemeral private key with KMS
      const kmsConfig = resolved.envConfig.kms;
      const wrapped = await this.kms.wrap(kmsConfig.keyId, Buffer.from(ephemeralPrivateKey));

      const revision = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const ciphertextHash = crypto.createHash("sha256").update(ciphertext).digest("hex");

      artifact = {
        version: 1,
        identity: config.identity,
        environment: config.environment,
        packedAt: new Date().toISOString(),
        revision,
        ciphertextHash,
        ciphertext,
        keys: Object.keys(resolved.values),
        envelope: {
          provider: kmsConfig.provider,
          keyId: kmsConfig.keyId,
          wrappedKey: wrapped.wrappedKey.toString("base64"),
          algorithm: wrapped.algorithm,
        },
      };
    } else {
      // Age-only path (v1, unchanged)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
        const { Encrypter } = await import("age-encryption" as any);
        const e = new Encrypter();
        e.addRecipient(resolved.recipient!);
        const encrypted = await e.encrypt(plaintext);
        ciphertext =
          typeof encrypted === "string"
            ? encrypted
            : new TextDecoder().decode(encrypted as Uint8Array);
      } catch {
        throw new Error("Failed to age-encrypt artifact. Check recipient key.");
      }

      const revision = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const ciphertextHash = crypto.createHash("sha256").update(ciphertext).digest("hex");

      artifact = {
        version: 1,
        identity: config.identity,
        environment: config.environment,
        packedAt: new Date().toISOString(),
        revision,
        ciphertextHash,
        ciphertext,
        keys: Object.keys(resolved.values),
      };
    }

    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (config.ttl && config.ttl > 0) {
      artifact.expiresAt = new Date(Date.now() + config.ttl * 1000).toISOString();
    }

    const json = JSON.stringify(artifact, null, 2);
    const tmpOutput = `${config.outputPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpOutput, json, "utf-8");
    fs.renameSync(tmpOutput, config.outputPath);

    return {
      outputPath: config.outputPath,
      namespaceCount: resolved.identity.namespaces.length,
      keyCount: Object.keys(resolved.values).length,
      artifactSize: Buffer.byteLength(json, "utf-8"),
      revision: artifact.revision,
    };
  }
}
