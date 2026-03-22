import * as crypto from "crypto";
import { SecretsCache } from "./secrets-cache";
import { AgeDecryptor } from "./decrypt";
import { ArtifactSource } from "./sources/types";
import { DiskCache } from "./disk-cache";
import { createKmsProvider } from "./kms";
import { TelemetryEmitter } from "./telemetry";

/** KMS envelope metadata for artifacts using KMS envelope encryption. */
export interface ArtifactKmsEnvelope {
  provider: string;
  keyId: string;
  wrappedKey: string;
  algorithm: string;
}

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
  envelope?: ArtifactKmsEnvelope;
  /** ISO-8601 expiry timestamp. Artifact is rejected after this time. */
  expiresAt?: string;
  /** ISO-8601 revocation timestamp. Present when the artifact has been revoked. */
  revokedAt?: string;
}

export interface PollerOptions {
  /** Artifact source strategy. */
  source: ArtifactSource;
  /** Age private key string. Optional for KMS envelope artifacts. */
  privateKey?: string;
  /** Secrets cache to swap on new revisions. */
  cache: SecretsCache;
  /** Optional disk cache for fallback. */
  diskCache?: DiskCache;
  /** Optional callback on successful refresh. */
  onRefresh?: (revision: string) => void;
  /** Optional error callback for logging. */
  onError?: (err: Error) => void;
  /** Max seconds the cache may be served without a successful refresh. */
  cacheTtl?: number;
  /** Optional telemetry emitter for event reporting. */
  telemetry?: TelemetryEmitter;
}

/**
 * Periodically fetches a published artifact, decrypts it, and swaps the
 * secrets cache when a new revision is detected.
 */
/** Minimum poll interval in milliseconds (floor for all scheduling). */
const MIN_POLL_MS = 5_000;

export class ArtifactPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastContentHash: string | null = null;
  private lastRevision: string | null = null;
  private lastExpiresAt: string | null = null;
  private readonly decryptor = new AgeDecryptor();
  private readonly options: PollerOptions;
  private telemetryOverride?: TelemetryEmitter;

  constructor(options: PollerOptions) {
    this.options = options;
  }

  /** Set or replace the telemetry emitter (e.g. after resolving token from secrets). */
  setTelemetry(emitter: TelemetryEmitter): void {
    this.telemetryOverride = emitter;
  }

  private get telemetry(): TelemetryEmitter | undefined {
    return this.telemetryOverride ?? this.options.telemetry;
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
      this.telemetry?.fetchFailed({
        error: err instanceof Error ? err.message : String(err),
        diskCacheAvailable: !!this.options.diskCache?.read(),
      });

      const ttl = this.options.cacheTtl;
      // Attempt disk cache fallback
      if (this.options.diskCache) {
        const cached = this.options.diskCache.read();
        if (cached) {
          // Check if disk cache has also expired
          if (ttl !== undefined) {
            const fetchedAt = this.options.diskCache.getFetchedAt();
            if (fetchedAt && (Date.now() - new Date(fetchedAt).getTime()) / 1000 > ttl) {
              this.options.cache.wipe();
              this.options.diskCache.purge();
              this.telemetry?.cacheExpired({
                cacheTtlSeconds: ttl,
                diskCachePurged: true,
              });
              throw new Error("Secrets cache expired: no successful refresh within TTL");
            }
          }
          raw = cached;
          contentHash = this.options.diskCache.getCachedSha();
          // If the cached hash matches, still skip
          if (contentHash && contentHash === this.lastContentHash) return;
        } else {
          // No disk cache content — check in-memory TTL
          if (ttl !== undefined && this.options.cache.isExpired(ttl)) {
            this.options.cache.wipe();
            this.telemetry?.cacheExpired({
              cacheTtlSeconds: ttl,
              diskCachePurged: false,
            });
            throw new Error("Secrets cache expired: no successful refresh within TTL");
          }
          throw err;
        }
      } else {
        // No disk cache configured — check in-memory TTL
        if (ttl !== undefined && this.options.cache.isExpired(ttl)) {
          this.options.cache.wipe();
          this.telemetry?.cacheExpired({
            cacheTtlSeconds: ttl,
            diskCachePurged: false,
          });
          throw new Error("Secrets cache expired: no successful refresh within TTL");
        }
        throw err;
      }
    }

    // Check for revocation before full validation — a revoked artifact
    // won't have ciphertext/revision fields.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.revokedAt) {
      this.options.cache.wipe();
      this.options.diskCache?.purge();
      this.lastRevision = null;
      this.lastContentHash = null;
      this.telemetry?.artifactRevoked({
        revokedAt: String(parsed.revokedAt),
      });
      throw new Error(
        `Artifact revoked: ${parsed.identity}/${parsed.environment} at ${parsed.revokedAt}`,
      );
    }

    const artifact = this.parseAndValidate(raw);

    // Check artifact-level expiry
    if (artifact.expiresAt && Date.now() > new Date(artifact.expiresAt).getTime()) {
      this.options.cache.wipe();
      this.options.diskCache?.purge();
      this.telemetry?.artifactExpired({ expiresAt: artifact.expiresAt });
      throw new Error(`Artifact expired at ${artifact.expiresAt}`);
    }

    // Skip if revision unchanged
    if (artifact.revision === this.lastRevision) return;

    // Verify integrity
    const hash = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    if (hash !== artifact.ciphertextHash) {
      throw new Error(
        `Artifact integrity check failed: expected hash ${artifact.ciphertextHash}, got ${hash}`,
      );
    }

    // Resolve the age private key
    let agePrivateKey: string;
    if (artifact.envelope) {
      // KMS envelope: unwrap the ephemeral private key via KMS
      const kms = createKmsProvider(artifact.envelope.provider);
      const wrappedKey = Buffer.from(artifact.envelope.wrappedKey, "base64");
      const unwrapped = await kms.unwrap(
        artifact.envelope.keyId,
        wrappedKey,
        artifact.envelope.algorithm,
      );
      // Note: unwrapped Buffer is zeroed below, but the resulting JS string is
      // immutable and cannot be cleared (inherent V8/Node.js limitation). Accepted risk.
      agePrivateKey = unwrapped.toString("utf-8");
      unwrapped.fill(0);
    } else {
      // Age-only: use the static private key
      if (!this.options.privateKey) {
        throw new Error(
          "Artifact requires an age private key. Set CLEF_AGENT_AGE_KEY or use KMS envelope encryption.",
        );
      }
      agePrivateKey = this.options.privateKey;
    }

    // Decrypt
    const plaintext = await this.decryptor.decrypt(artifact.ciphertext, agePrivateKey);
    const values: Record<string, string> = JSON.parse(plaintext);

    // Atomic swap
    this.options.cache.swap(values, artifact.keys, artifact.revision);
    this.lastRevision = artifact.revision;
    this.lastContentHash = contentHash ?? null;
    this.lastExpiresAt = artifact.expiresAt ?? null;
    this.options.onRefresh?.(artifact.revision);
    this.telemetry?.artifactRefreshed({
      revision: artifact.revision,
      keyCount: artifact.keys.length,
      kmsEnvelope: !!artifact.envelope,
    });
  }

  /** Start the polling loop. Performs an initial fetch immediately. */
  async start(): Promise<void> {
    // Initial fetch — fail fast if source is unreachable
    await this.fetchAndDecrypt();
    this.scheduleNext();
  }

  /** Start only the polling schedule (no initial fetch). */
  startPolling(): void {
    if (this.timer) return;
    this.scheduleNext();
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Whether the poller is currently running. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Compute the next poll delay and schedule a fetch. */
  private scheduleNext(): void {
    const delayMs = this.computeNextPollMs();
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.fetchAndDecrypt();
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      this.scheduleNext();
    }, delayMs);
  }

  /** Compute ms until next poll: 80% of expiresAt remaining, or cacheTtl / 10 fallback. */
  private computeNextPollMs(): number {
    // If the artifact has an expiresAt, refresh at 80% of remaining time
    if (this.lastExpiresAt) {
      const msRemaining = new Date(this.lastExpiresAt).getTime() - Date.now();
      if (msRemaining > 0) {
        return Math.max(msRemaining * 0.8, MIN_POLL_MS);
      }
      // Already expired — poll immediately (with floor)
      return MIN_POLL_MS;
    }
    // Fallback: derive from cacheTtl (default 30s if no TTL configured)
    const ttl = this.options.cacheTtl;
    if (ttl !== undefined) {
      return Math.max((ttl / 10) * 1000, MIN_POLL_MS);
    }
    return 30_000;
  }

  private parseAndValidate(raw: string): ArtifactEnvelope {
    const artifact: ArtifactEnvelope = JSON.parse(raw) as ArtifactEnvelope;

    if (artifact.version !== 1) {
      throw new Error(`Unsupported artifact version: ${artifact.version}`);
    }
    if (!artifact.ciphertext || !artifact.revision || !artifact.ciphertextHash) {
      throw new Error("Invalid artifact: missing required fields.");
    }
    if (artifact.envelope) {
      if (
        !artifact.envelope.provider ||
        !artifact.envelope.keyId ||
        !artifact.envelope.wrappedKey ||
        !artifact.envelope.algorithm
      ) {
        throw new Error("Invalid artifact: incomplete envelope fields.");
      }
    }

    return artifact;
  }
}
