import * as fs from "fs";
import * as crypto from "crypto";
import { SecretsCache } from "./cache";
import { AgeDecryptor } from "./decryptor";

/** Shape of a packed artifact JSON envelope. */
interface ArtifactEnvelope {
  version: number;
  identity: string;
  environment: string;
  packedAt: string;
  revision: string;
  ciphertextHash: string;
  ciphertext: string;
  keys: string[];
}

export interface PollerOptions {
  /** HTTP URL or local file path to the artifact. */
  source: string;
  /** Age private key string. */
  privateKey: string;
  /** Secrets cache to swap on new revisions. */
  cache: SecretsCache;
  /** Seconds between polls. */
  pollInterval: number;
  /** Optional error callback for logging. */
  onError?: (err: Error) => void;
}

/**
 * Periodically fetches a published artifact, decrypts it, and swaps the
 * secrets cache when a new revision is detected.
 */
export class ArtifactPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRevision: string | null = null;
  private readonly decryptor = new AgeDecryptor();
  private readonly options: PollerOptions;

  constructor(options: PollerOptions) {
    this.options = options;
  }

  /** Fetch, validate, decrypt, and cache the artifact. */
  async fetchAndDecrypt(): Promise<void> {
    const raw = await this.fetchArtifact();
    const artifact = this.parseAndValidate(raw);

    // Skip if revision unchanged
    if (artifact.revision === this.lastRevision) return;

    // Verify integrity
    const hash = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    if (hash !== artifact.ciphertextHash) {
      throw new Error(
        `Artifact integrity check failed: expected hash ${artifact.ciphertextHash}, got ${hash}`,
      );
    }

    // Decrypt
    const plaintext = await this.decryptor.decrypt(artifact.ciphertext, this.options.privateKey);
    const values: Record<string, string> = JSON.parse(plaintext);

    // Atomic swap
    this.options.cache.swap(values, artifact.keys, artifact.revision);
    this.lastRevision = artifact.revision;
  }

  /** Start the polling loop. Performs an initial fetch immediately. */
  async start(): Promise<void> {
    // Initial fetch — fail fast if source is unreachable
    await this.fetchAndDecrypt();

    this.timer = setInterval(async () => {
      try {
        await this.fetchAndDecrypt();
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }, this.options.pollInterval * 1000);
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the poller is currently running. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  private async fetchArtifact(): Promise<string> {
    const { source } = this.options;

    if (source.startsWith("http://") || source.startsWith("https://")) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to fetch artifact from ${source}: ${response.status}`);
      }
      return response.text();
    }

    // Local file
    return fs.readFileSync(source, "utf-8");
  }

  private parseAndValidate(raw: string): ArtifactEnvelope {
    const artifact: ArtifactEnvelope = JSON.parse(raw);

    if (artifact.version !== 1) {
      throw new Error(`Unsupported artifact version: ${artifact.version}`);
    }
    if (!artifact.ciphertext || !artifact.revision || !artifact.ciphertextHash) {
      throw new Error("Invalid artifact: missing required fields.");
    }

    return artifact;
  }
}
