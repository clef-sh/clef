// Core modules
export { SecretsCache } from "./secrets-cache";
export { DiskCache } from "./disk-cache";
export { AgeDecryptor } from "./decrypt";
export { ArtifactPoller } from "./poller";
export type { PollerOptions } from "./poller";
export type { PackedArtifact, KmsEnvelope } from "@clef-sh/core";
export { ArtifactDecryptor } from "./artifact-decryptor";
export type { DecryptedArtifact, ArtifactDecryptorOptions } from "./artifact-decryptor";
export { EncryptedArtifactStore } from "./encrypted-artifact-store";

// Telemetry
export { TelemetryEmitter } from "./telemetry";
export type {
  TelemetryOptions,
  TelemetryEvent,
  AgentStartedEvent,
  AgentStoppedEvent,
  ArtifactRefreshedEvent,
  ArtifactRevokedEvent,
  ArtifactExpiredEvent,
  FetchFailedEvent,
  CacheExpiredEvent,
  ArtifactInvalidEvent,
} from "./telemetry";

// VCS
export type { VcsProvider, VcsProviderConfig, VcsFileResult } from "./vcs/types";
export { GitHubProvider } from "./vcs/github";
export { GitLabProvider } from "./vcs/gitlab";
export { BitbucketProvider } from "./vcs/bitbucket";
export { createVcsProvider } from "./vcs/index";

// KMS
export type { KmsProvider, KmsWrapResult, KmsProviderType } from "./kms";
export { AwsKmsProvider } from "./kms";
export { createKmsProvider } from "./kms";

// Sources
export type { ArtifactSource, ArtifactFetchResult } from "./sources/types";
export { HttpArtifactSource } from "./sources/http";
export { FileArtifactSource } from "./sources/file";
export { VcsArtifactSource } from "./sources/vcs";
export { S3ArtifactSource, isS3Url } from "./sources/s3";

// Signature verification
export { buildSigningPayload, verifySignature } from "./signature";

// High-level API
import { SecretsCache } from "./secrets-cache";
import { DiskCache } from "./disk-cache";
import { AgeDecryptor } from "./decrypt";
import { ArtifactPoller } from "./poller";
import { createVcsProvider } from "./vcs/index";
import { VcsArtifactSource } from "./sources/vcs";
import { HttpArtifactSource } from "./sources/http";
import { FileArtifactSource } from "./sources/file";
import { S3ArtifactSource, isS3Url } from "./sources/s3";
import { ArtifactSource } from "./sources/types";
import { TelemetryEmitter } from "./telemetry";

/**
 * Configuration for {@link ClefRuntime}.
 *
 * Supply **either** VCS fields (`provider`, `repo`, `token`, `identity`, `environment`)
 * **or** a `source` URL/path. VCS is the recommended approach — the runtime fetches
 * packed artifacts directly from your git repository via the provider API.
 */
export interface RuntimeConfig {
  /** VCS platform: `"github"`, `"gitlab"`, or `"bitbucket"`. */
  provider?: "github" | "gitlab" | "bitbucket";
  /** Repository identifier, e.g. `"org/secrets"`. */
  repo?: string;
  /** Service identity name as declared in `clef.yaml`. */
  identity?: string;
  /** Target environment (e.g. `"production"`). */
  environment?: string;
  /** VCS authentication token (GitHub PAT, GitLab PAT, Bitbucket app password). */
  token?: string;
  /** Git ref — branch, tag, or commit SHA. Defaults to the repo's default branch. */
  ref?: string;
  /** Custom VCS API base URL for self-hosted instances. */
  apiUrl?: string;

  /** HTTP URL or local file path to a packed artifact (alternative to VCS). */
  source?: string;

  /** Inline age private key (`AGE-SECRET-KEY-...`). */
  ageKey?: string;
  /** Path to an age key file. */
  ageKeyFile?: string;

  /** Disk cache directory. Enables fallback to the last fetched artifact on VCS failure. */
  cachePath?: string;
  /** Max seconds the runtime serves secrets without a successful refresh. */
  cacheTtl?: number;

  /** Optional telemetry emitter for event reporting. */
  telemetry?: TelemetryEmitter;

  /**
   * Public key for artifact signature verification (base64-encoded DER SPKI).
   * When set, unsigned or mis-signed artifacts are hard-rejected before decryption.
   */
  verifyKey?: string;
}

/**
 * High-level runtime for fetching and caching secrets.
 *
 * Supports VCS providers (GitHub, GitLab, Bitbucket), HTTP URLs, and
 * local file sources. Decrypts age-encrypted artifacts and serves
 * secrets from an in-memory cache with optional background polling.
 */
export class ClefRuntime {
  private readonly cache = new SecretsCache();
  private readonly poller: ArtifactPoller;
  private readonly config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;

    // Age key is optional — KMS envelope artifacts don't need one
    let privateKey: string | undefined;
    try {
      const decryptor = new AgeDecryptor();
      privateKey = decryptor.resolveKey(config.ageKey, config.ageKeyFile);
    } catch {
      // OK — will work if artifact uses KMS envelope encryption
    }

    const source = this.resolveSource(config);
    const diskCache = config.cachePath
      ? new DiskCache(
          config.cachePath,
          config.identity ?? "default",
          config.environment ?? "default",
        )
      : undefined;

    this.poller = new ArtifactPoller({
      source,
      privateKey,
      cache: this.cache,
      diskCache,
      cacheTtl: config.cacheTtl,
      telemetry: config.telemetry,
      verifyKey: config.verifyKey,
    });
  }

  /** Initial fetch + decrypt. Must be called before get/getAll. */
  async start(): Promise<void> {
    await this.poller.fetchAndDecrypt();
  }

  /** Start background polling. Schedule is derived from artifact expiresAt or cacheTtl. */
  startPolling(): void {
    this.poller.startPolling();
  }

  /** Stop background polling. */
  stopPolling(): void {
    this.poller.stop();
  }

  /** Get a single secret value by key. */
  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  /** Get all secrets as key-value map. */
  getAll(): Record<string, string> {
    return this.cache.getAll() ?? {};
  }

  /** Alias for getAll() — convenience for env injection. */
  env(): Record<string, string> {
    return this.getAll();
  }

  /** List available key names. */
  keys(): string[] {
    return this.cache.getKeys();
  }

  /** Current artifact revision. */
  get revision(): string {
    return this.cache.getRevision() ?? "";
  }

  /** Whether secrets have been loaded. */
  get ready(): boolean {
    return this.cache.isReady();
  }

  /** Get the underlying poller (for agent integration). */
  getPoller(): ArtifactPoller {
    return this.poller;
  }

  /** Get the underlying cache (for agent integration). */
  getCache(): SecretsCache {
    return this.cache;
  }

  private resolveSource(config: RuntimeConfig): ArtifactSource {
    // VCS source
    const vcsFields = {
      provider: config.provider,
      repo: config.repo,
      token: config.token,
      identity: config.identity,
      environment: config.environment,
    };
    const presentVcs = Object.entries(vcsFields).filter(([, v]) => !!v);
    const missingVcs = Object.entries(vcsFields).filter(([, v]) => !v);

    if (presentVcs.length > 0 && missingVcs.length > 0) {
      const missing = missingVcs.map(([k]) => k).join(", ");
      throw new Error(
        `Partial VCS config detected. Missing: ${missing}. Provide all VCS fields (provider, repo, token, identity, environment) or use a source URL/path instead.`,
      );
    }

    if (presentVcs.length === Object.keys(vcsFields).length) {
      const provider = createVcsProvider({
        provider: config.provider!,
        repo: config.repo!,
        token: config.token!,
        ref: config.ref,
        apiUrl: config.apiUrl,
      });
      return new VcsArtifactSource(provider, config.identity!, config.environment!);
    }

    // HTTP, S3, or file source
    if (config.source) {
      if (isS3Url(config.source)) {
        return new S3ArtifactSource(config.source);
      }
      if (config.source.startsWith("http://") || config.source.startsWith("https://")) {
        return new HttpArtifactSource(config.source);
      }
      return new FileArtifactSource(config.source);
    }

    throw new Error(
      "No artifact source configured. Provide VCS config (provider, repo, token, identity, environment) or a source URL/path.",
    );
  }
}

/** Convenience one-shot function (no polling). Initializes and returns a ready runtime. */
export async function init(config: RuntimeConfig): Promise<ClefRuntime> {
  const runtime = new ClefRuntime(config);
  await runtime.start();
  return runtime;
}
