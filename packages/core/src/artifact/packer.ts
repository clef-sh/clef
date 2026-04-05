import * as crypto from "crypto";
import { ClefManifest, EncryptionBackend, isKmsEnvelope } from "../types";
import { KmsProvider } from "../kms";
import { MatrixManager } from "../matrix/manager";
import { PackConfig, PackResult, PackedArtifact } from "./types";
import { FilePackOutput } from "./output";
import { resolveIdentitySecrets } from "./resolve";
import { buildSigningPayload, signEd25519, signKms } from "./signer";

/**
 * Packs an encrypted artifact for a service identity + environment.
 *
 * The artifact is a JSON envelope containing encrypted secrets (age for
 * age-only identities, AES-256-GCM for KMS envelope identities) that can
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
    if (config.signingKey && config.signingKmsKeyId) {
      throw new Error(
        "Cannot specify both signingKey (Ed25519) and signingKmsKeyId (KMS). Choose one.",
      );
    }

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
      // KMS envelope path — AES-256-GCM with KMS-wrapped DEK
      if (!this.kms) {
        throw new Error("KMS provider required for envelope encryption but none was provided.");
      }

      const dek = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);

      try {
        const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
        const ciphertextBuf = Buffer.concat([
          cipher.update(Buffer.from(plaintext, "utf-8")),
          cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        ciphertext = ciphertextBuf.toString("base64");

        const kmsConfig = resolved.envConfig.kms;
        const wrapped = await this.kms.wrap(kmsConfig.keyId, dek);

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
          envelope: {
            provider: kmsConfig.provider,
            keyId: kmsConfig.keyId,
            wrappedKey: wrapped.wrappedKey.toString("base64"),
            algorithm: wrapped.algorithm,
            iv: iv.toString("base64"),
            authTag: authTag.toString("base64"),
          },
        };
      } finally {
        dek.fill(0);
      }
    } else {
      // Age-only path (v1, unchanged)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
        const { Encrypter } = await import("age-encryption" as any);
        const e = new Encrypter();
        e.addRecipient(resolved.recipient!);
        const encrypted = await e.encrypt(plaintext);
        ciphertext = Buffer.from(encrypted as Uint8Array).toString("base64");
      } catch (err) {
        throw new Error(
          `Failed to age-encrypt artifact: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      };
    }

    // Set expiresAt before signing — the signature covers this field
    if (config.ttl && config.ttl > 0) {
      artifact.expiresAt = new Date(Date.now() + config.ttl * 1000).toISOString();
    }

    // Sign the artifact if a signing key is provided
    if (config.signingKey) {
      const payload = buildSigningPayload(artifact);
      artifact.signature = signEd25519(payload, config.signingKey);
      artifact.signatureAlgorithm = "Ed25519";
    } else if (config.signingKmsKeyId) {
      if (!this.kms) {
        throw new Error("KMS provider required for KMS signing but none was provided.");
      }
      const payload = buildSigningPayload(artifact);
      artifact.signature = await signKms(payload, this.kms, config.signingKmsKeyId);
      artifact.signatureAlgorithm = "ECDSA_SHA256";
    }

    const json = JSON.stringify(artifact, null, 2);

    // Use provided output backend, or fall back to FilePackOutput for backward compat
    const output = config.output ?? new FilePackOutput(config.outputPath ?? "artifact.json");
    await output.write(artifact, json);

    return {
      outputPath: config.outputPath ?? "",
      namespaceCount: resolved.identity.namespaces.length,
      keyCount: Object.keys(resolved.values).length,
      artifactSize: Buffer.byteLength(json, "utf-8"),
      revision: artifact.revision,
    };
  }
}
