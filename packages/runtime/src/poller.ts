import * as crypto from "crypto";
import { SecretsCache } from "./secrets-cache";
import { AgeDecryptor } from "./decrypt";
import { ArtifactSource } from "./sources/types";
import { DiskCache } from "./disk-cache";

/** Shape of a packed artifact JSON envelope. */
export interface ArtifactEnvelope {
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
  /** Artifact source strategy. */
  source: ArtifactSource;
  /** Age private key string. */
  privateKey: string;
  /** Secrets cache to swap on new revisions. */
  cache: SecretsCache;
  /** Seconds between polls. */
  pollInterval: number;
  /** Optional disk cache for fallback. */
  diskCache?: DiskCache;
  /** Optional callback on successful refresh. */
  onRefresh?: (revision: string) => void;
  /** Optional error callback for logging. */
  onError?: (err: Error) => void;
}

/**
 * Periodically fetches a published artifact, decrypts it, and swaps the
 * secrets cache when a new revision is detected.
 */
export class ArtifactPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastContentHash: string | null = null;
  private lastRevision: string | null = null;
  private readonly decryptor = new AgeDecryptor();
  private readonly options: PollerOptions;

  constructor(options: PollerOptions) {
    this.options = options;
  }

  /** Fetch, validate, decrypt, and cache the artifact. */
  async fetchAndDecrypt(): Promise<void> {
    let raw: string;
    let contentHash: string | undefined;

    try {
      const result = await this.options.source.fetch();
      raw = result.raw;
      contentHash = result.contentHash;

      // Content-hash short-circuit: skip parse+decrypt if unchanged
      if (contentHash && contentHash === this.lastContentHash) return;

      // Write to disk cache on successful fetch
      this.options.diskCache?.write(raw, contentHash);
    } catch (err) {
      // Attempt disk cache fallback
      if (this.options.diskCache) {
        const cached = this.options.diskCache.read();
        if (cached) {
          raw = cached;
          contentHash = this.options.diskCache.getCachedSha();
          // If the cached hash matches, still skip
          if (contentHash && contentHash === this.lastContentHash) return;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

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
    this.lastContentHash = contentHash ?? null;
    this.options.onRefresh?.(artifact.revision);
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

  private parseAndValidate(raw: string): ArtifactEnvelope {
    const artifact: ArtifactEnvelope = JSON.parse(raw) as ArtifactEnvelope;

    if (artifact.version !== 1) {
      throw new Error(`Unsupported artifact version: ${artifact.version}`);
    }
    if (!artifact.ciphertext || !artifact.revision || !artifact.ciphertextHash) {
      throw new Error("Invalid artifact: missing required fields.");
    }

    return artifact;
  }
}
