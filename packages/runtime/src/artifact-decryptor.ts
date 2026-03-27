import * as crypto from "crypto";
import { AgeDecryptor } from "./decrypt";
import { createKmsProvider } from "./kms";
import { TelemetryEmitter } from "./telemetry";
import type { ArtifactEnvelope } from "./poller";

/** Result of decrypting an artifact envelope. */
export interface DecryptedArtifact {
  values: Record<string, string>;
  keys: string[];
  revision: string;
}

export interface ArtifactDecryptorOptions {
  /** Age private key string. Optional for KMS envelope artifacts. */
  privateKey?: string;
  /** Optional telemetry emitter for decrypt error reporting. */
  telemetry?: TelemetryEmitter;
}

/**
 * Decrypts artifact envelopes into plaintext key-value pairs.
 *
 * Supports two paths:
 *   - **KMS envelope**: unwrap DEK via cloud KMS, then AES-256-GCM decrypt
 *   - **Age-only**: decrypt via the age private key
 *
 * The caller is responsible for validation (version, integrity, signature,
 * expiry). This module handles only the cryptographic decryption and JSON
 * parsing of the resulting plaintext.
 */
export class ArtifactDecryptor {
  private readonly ageDecryptor = new AgeDecryptor();
  private readonly privateKey?: string;
  private telemetryOverride?: TelemetryEmitter;
  private readonly initialTelemetry?: TelemetryEmitter;

  constructor(options: ArtifactDecryptorOptions) {
    this.privateKey = options.privateKey;
    this.initialTelemetry = options.telemetry;
  }

  /** Set or replace the telemetry emitter. */
  setTelemetry(emitter: TelemetryEmitter): void {
    this.telemetryOverride = emitter;
  }

  private get telemetry(): TelemetryEmitter | undefined {
    return this.telemetryOverride ?? this.initialTelemetry;
  }

  /**
   * Decrypt an artifact envelope into plaintext key-value pairs.
   *
   * @throws On KMS unwrap failure, AES-GCM auth failure, age decrypt failure,
   *         missing private key (config error), or malformed plaintext JSON.
   */
  async decrypt(artifact: ArtifactEnvelope): Promise<DecryptedArtifact> {
    let plaintext: string;

    if (artifact.envelope) {
      plaintext = await this.decryptKmsEnvelope(artifact);
    } else {
      plaintext = await this.decryptAge(artifact);
    }

    let values: Record<string, string>;
    try {
      values = JSON.parse(plaintext);
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: "payload_parse",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      plaintext = "";
    }

    return { values, keys: artifact.keys, revision: artifact.revision };
  }

  /** KMS envelope: unwrap DEK via KMS, then AES-256-GCM decrypt. */
  private async decryptKmsEnvelope(artifact: ArtifactEnvelope): Promise<string> {
    const envelope = artifact.envelope!;
    let dek: Buffer;
    try {
      const kms = createKmsProvider(envelope.provider);
      const wrappedKey = Buffer.from(envelope.wrappedKey, "base64");
      dek = await kms.unwrap(envelope.keyId, wrappedKey, envelope.algorithm);
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: "kms_unwrap",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    try {
      const iv = Buffer.from(envelope.iv, "base64");
      const authTag = Buffer.from(envelope.authTag, "base64");
      const ciphertextBuf = Buffer.from(artifact.ciphertext, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]).toString("utf-8");
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: "decrypt",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      dek.fill(0);
    }
  }

  /** Age-only: decrypt with the static private key. */
  private async decryptAge(artifact: ArtifactEnvelope): Promise<string> {
    if (!this.privateKey) {
      // Config error — NOT an artifact.invalid event
      throw new Error(
        "Artifact requires an age private key. Set CLEF_AGENT_AGE_KEY or use KMS envelope encryption.",
      );
    }

    try {
      return await this.ageDecryptor.decrypt(artifact.ciphertext, this.privateKey);
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: err instanceof SyntaxError ? "payload_parse" : "decrypt",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
