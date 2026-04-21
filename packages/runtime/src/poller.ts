import * as crypto from "crypto";
import { SecretsCache } from "./secrets-cache";
import { ArtifactSource } from "./sources/types";
import { DiskCache } from "./disk-cache";
import { EncryptedArtifactStore } from "./encrypted-artifact-store";
import { ArtifactDecryptor } from "./artifact-decryptor";
import { TelemetryEmitter } from "./telemetry";
import { buildSigningPayload, verifySignature } from "./signature";
import { assertPackedArtifact, InvalidArtifactError } from "@clef-sh/core";
import type { PackedArtifact } from "@clef-sh/core";

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
  /** Max seconds the cache may be served without a successful refresh. 0 = JIT mode. */
  cacheTtl?: number;
  /** Optional telemetry emitter for event reporting. */
  telemetry?: TelemetryEmitter;
  /**
   * Public key for artifact signature verification (base64-encoded DER SPKI).
   * When set, artifacts without a valid signature are hard-rejected before decryption.
   */
  verifyKey?: string;
  /** Encrypted artifact store for JIT mode. When set, enables fetch-only polling. */
  encryptedStore?: EncryptedArtifactStore;
}

/**
 * Periodically fetches a published artifact, decrypts it, and swaps the
 * secrets cache when a new revision is detected.
 *
 * In JIT mode (cacheTtl=0 with encryptedStore), the poller fetches and
 * validates the artifact but does NOT decrypt. The encrypted artifact is
 * stored for on-demand decryption by the request handler.
 */
/** Minimum poll interval in milliseconds (floor for all scheduling). */
const MIN_POLL_MS = 5_000;

export class ArtifactPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastContentHash: string | null = null;
  private lastRevision: string | null = null;
  private lastExpiresAt: string | null = null;
  private readonly decryptor: ArtifactDecryptor;
  private readonly options: PollerOptions;
  private readonly jitMode: boolean;
  private telemetryOverride?: TelemetryEmitter;

  constructor(options: PollerOptions) {
    this.options = options;
    this.jitMode = !!options.encryptedStore;
    this.decryptor = new ArtifactDecryptor({
      privateKey: options.privateKey,
      telemetry: options.telemetry,
    });
  }

  /** Get the decryptor instance (for JIT mode server wiring). */
  getDecryptor(): ArtifactDecryptor {
    return this.decryptor;
  }

  /** Set or replace the telemetry emitter (e.g. after resolving token from secrets). */
  setTelemetry(emitter: TelemetryEmitter): void {
    this.telemetryOverride = emitter;
    this.decryptor.setTelemetry(emitter);
  }

  private get telemetry(): TelemetryEmitter | undefined {
    return this.telemetryOverride ?? this.options.telemetry;
  }

  /**
   * Fetch, validate, decrypt, and cache the artifact.
   * Used in cached mode (cacheTtl > 0).
   */
  async fetchAndDecrypt(): Promise<void> {
    const result = await this.fetchRaw();
    if (!result) return; // short-circuited (unchanged hash)
    await this.validateDecryptAndCache(result.artifact, result.contentHash);
  }

  /**
   * Fetch and validate the artifact without decrypting.
   * Stores the validated envelope in the encryptedStore for on-demand decryption.
   * Used in JIT mode (cacheTtl = 0).
   */
  async fetchAndValidate(): Promise<void> {
    const result = await this.fetchRaw();
    if (!result) return; // short-circuited (unchanged hash)

    const artifact = this.validateArtifact(result.artifact);

    this.options.encryptedStore!.swap(artifact);
    this.lastRevision = artifact.revision;
    this.lastContentHash = result.contentHash ?? null;
    this.lastExpiresAt = artifact.expiresAt ?? null;
    this.options.onRefresh?.(artifact.revision);
    this.telemetry?.artifactRefreshed({
      revision: artifact.revision,
      kmsEnvelope: !!artifact.envelope,
    });
  }

  /**
   * Fetch the raw artifact from the source (with disk cache fallback),
   * parse JSON, and check for revocation.
   *
   * Returns null when the content hash is unchanged (short-circuit).
   */
  private async fetchRaw(): Promise<{
    artifact: PackedArtifact;
    contentHash: string | undefined;
  } | null> {
    let raw: string;
    let contentHash: string | undefined;

    try {
      const result = await this.options.source.fetch();
      raw = result.raw;
      contentHash = result.contentHash;

      // Content-hash short-circuit: skip parse+decrypt if unchanged
      if (contentHash && contentHash === this.lastContentHash) return null;

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
          // Check if disk cache has also expired (skip TTL check in JIT mode)
          if (ttl !== undefined && ttl > 0) {
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
          if (contentHash && contentHash === this.lastContentHash) return null;
        } else {
          // No disk cache content — check in-memory TTL (skip in JIT mode)
          if (ttl !== undefined && ttl > 0 && this.options.cache.isExpired(ttl)) {
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
        // No disk cache configured — check in-memory TTL (skip in JIT mode)
        if (ttl !== undefined && ttl > 0 && this.options.cache.isExpired(ttl)) {
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

    const parsed: unknown = JSON.parse(raw);

    // Revocation kill-signal is honored even on malformed artifacts — a
    // revoke response should work regardless of whether the rest of the
    // artifact shape is valid. Full shape check follows immediately after.
    const asRecord = parsed as Record<string, unknown>;
    if (asRecord.revokedAt) {
      this.options.cache.wipe();
      this.options.encryptedStore?.wipe();
      this.options.diskCache?.purge();
      this.lastRevision = null;
      this.lastContentHash = null;
      this.telemetry?.artifactRevoked({
        revokedAt: String(asRecord.revokedAt),
      });
      throw new Error(
        `Artifact revoked: ${String(asRecord.identity)}/${String(asRecord.environment)} at ${String(asRecord.revokedAt)}`,
      );
    }

    try {
      assertPackedArtifact(parsed, "fetched artifact");
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: classifyValidationError(err),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return { artifact: parsed, contentHash };
  }

  /**
   * Validate the artifact envelope: version, required fields, expiry,
   * revision dedup, integrity hash, and signature.
   * Emits `artifact.invalid` / `artifact.expired` telemetry on failure.
   * Returns the validated artifact, or throws.
   */
  private validateArtifact(parsed: PackedArtifact): PackedArtifact {
    let artifact: PackedArtifact;
    try {
      artifact = this.validateEnvelope(parsed);
    } catch (err) {
      this.telemetry?.artifactInvalid({
        reason: classifyValidationError(err),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // Check artifact-level expiry
    if (artifact.expiresAt && Date.now() > new Date(artifact.expiresAt).getTime()) {
      this.options.cache.wipe();
      this.options.encryptedStore?.wipe();
      this.options.diskCache?.purge();
      this.telemetry?.artifactExpired({ expiresAt: artifact.expiresAt });
      throw new Error(`Artifact expired at ${artifact.expiresAt}`);
    }

    // Skip if revision unchanged
    if (artifact.revision === this.lastRevision) return artifact;

    // Verify integrity
    const hash = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    if (hash !== artifact.ciphertextHash) {
      const err = new Error(
        `Artifact integrity check failed: expected hash ${artifact.ciphertextHash}, got ${hash}`,
      );
      this.telemetry?.artifactInvalid({
        reason: "integrity",
        error: err.message,
      });
      throw err;
    }

    // Verify signature when a verify key is configured (hard reject)
    if (this.options.verifyKey) {
      if (!artifact.signature) {
        const err = new Error(
          "Artifact signature verification failed: artifact is unsigned but a verify key is configured. " +
            "Only signed artifacts are accepted when signature verification is enabled.",
        );
        this.telemetry?.artifactInvalid({
          reason: "signature_missing",
          error: err.message,
        });
        throw err;
      }

      const payload = buildSigningPayload(artifact);
      let valid: boolean;
      try {
        valid = verifySignature(payload, artifact.signature, this.options.verifyKey);
      } catch (sigErr) {
        const err = new Error(
          `Artifact signature verification error: ${sigErr instanceof Error ? sigErr.message : String(sigErr)}`,
        );
        this.telemetry?.artifactInvalid({
          reason: "signature_error",
          error: err.message,
        });
        throw err;
      }

      if (!valid) {
        const err = new Error(
          "Artifact signature verification failed: signature does not match the verify key. " +
            "The artifact may have been tampered with or signed by a different key.",
        );
        this.telemetry?.artifactInvalid({
          reason: "signature_invalid",
          error: err.message,
        });
        throw err;
      }
    }

    return artifact;
  }

  /**
   * Validate then decrypt and cache. Used by fetchAndDecrypt (cached mode).
   */
  private async validateDecryptAndCache(
    parsed: PackedArtifact,
    contentHash: string | undefined,
  ): Promise<void> {
    const artifact = this.validateArtifact(parsed);

    // Skip if revision unchanged (validateArtifact returns but doesn't throw)
    if (artifact.revision === this.lastRevision) return;

    // Delegate decryption to the ArtifactDecryptor
    const { values } = await this.decryptor.decrypt(artifact);

    // Atomic swap
    const keys = Object.keys(values);
    this.options.cache.swap(values, keys, artifact.revision);
    this.lastRevision = artifact.revision;
    this.lastContentHash = contentHash ?? null;
    this.lastExpiresAt = artifact.expiresAt ?? null;
    this.options.onRefresh?.(artifact.revision);
    this.telemetry?.artifactRefreshed({
      revision: artifact.revision,
      keyCount: keys.length,
      kmsEnvelope: !!artifact.envelope,
    });
  }

  /** Start the polling loop. Performs an initial fetch immediately. */
  async start(): Promise<void> {
    if (this.jitMode) {
      await this.fetchAndValidate();
    } else {
      await this.fetchAndDecrypt();
    }
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
        if (this.jitMode) {
          await this.fetchAndValidate();
        } else {
          await this.fetchAndDecrypt();
        }
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
    // JIT mode: 5s interval for fast recovery after rotate + re-enable IAM
    if (this.jitMode) return MIN_POLL_MS;
    // Fallback: derive from cacheTtl (default 30s if no TTL configured)
    const ttl = this.options.cacheTtl;
    if (ttl !== undefined) {
      return Math.max((ttl / 10) * 1000, MIN_POLL_MS);
    }
    return 30_000;
  }

  private validateEnvelope(artifact: PackedArtifact): PackedArtifact {
    // Version and shape verified by assertPackedArtifact at the parse boundary.
    // These checks enforce semantic validity (non-empty fields) on top of shape.
    if (!artifact.ciphertext || !artifact.revision || !artifact.ciphertextHash) {
      throw new Error("Invalid artifact: missing required fields.");
    }
    if (artifact.envelope) {
      if (
        !artifact.envelope.provider ||
        !artifact.envelope.keyId ||
        !artifact.envelope.wrappedKey ||
        !artifact.envelope.algorithm ||
        !artifact.envelope.iv ||
        !artifact.envelope.authTag
      ) {
        throw new Error("Invalid artifact: incomplete envelope fields.");
      }
    }

    return artifact;
  }
}

/** Classify a validation error from parseAndValidate into a machine-readable reason. */
function classifyValidationError(err: unknown): string {
  if (err instanceof SyntaxError) return "json_parse";
  const msg = err instanceof Error ? err.message : "";
  if (/unsupported( artifact)? version/i.test(msg)) return "unsupported_version";
  if (msg.includes("missing required fields")) return "missing_fields";
  if (msg.includes("incomplete envelope")) return "incomplete_envelope";
  if (msg.includes("signature")) return "signature";
  if (err instanceof InvalidArtifactError) return "invalid_shape";
  return "unknown";
}
