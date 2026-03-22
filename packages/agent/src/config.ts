import { randomBytes } from "crypto";

/** VCS provider configuration for fetching artifacts from git. */
export interface VcsConfig {
  provider: "github" | "gitlab" | "bitbucket";
  repo: string;
  token: string;
  identity: string;
  environment: string;
  ref?: string;
  apiUrl?: string;
}

/** Resolved agent configuration. */
export interface AgentConfig {
  /** HTTP URL or local file path to the published artifact. Optional when VCS is configured. */
  source?: string;
  /** VCS provider configuration. */
  vcs?: VcsConfig;
  /** Disk cache path for fallback on VCS failure. */
  cachePath?: string;
  /** Port for the HTTP API server. */
  port: number;
  /** Seconds between artifact polls. */
  pollInterval: number;
  /** Inline age private key. */
  ageKey?: string;
  /** Path to age key file. */
  ageKeyFile?: string;
  /** Bearer token for API authentication. Auto-generated if not set. */
  token: string;
}

/** Errors describing missing or invalid configuration. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Resolve agent configuration from environment variables.
 *
 * | Variable                       | Default        | Description                          |
 * |--------------------------------|----------------|--------------------------------------|
 * | CLEF_AGENT_SOURCE              | —              | HTTP URL or local file path          |
 * | CLEF_AGENT_VCS_PROVIDER        | —              | VCS provider (github/gitlab/bitbucket) |
 * | CLEF_AGENT_VCS_REPO            | —              | VCS repository (owner/repo)          |
 * | CLEF_AGENT_VCS_TOKEN           | —              | VCS authentication token             |
 * | CLEF_AGENT_VCS_IDENTITY        | —              | Packed artifact identity             |
 * | CLEF_AGENT_VCS_ENVIRONMENT     | —              | Packed artifact environment          |
 * | CLEF_AGENT_VCS_REF             | —              | Git ref (branch/tag/sha)             |
 * | CLEF_AGENT_VCS_API_URL         | —              | Custom VCS API base URL              |
 * | CLEF_AGENT_CACHE_PATH          | —              | Disk cache path for fallback         |
 * | CLEF_AGENT_PORT                | 7779           | HTTP API port                        |
 * | CLEF_AGENT_POLL_INTERVAL       | 30             | Seconds between polls                |
 * | CLEF_AGENT_AGE_KEY             | —              | Inline age private key               |
 * | CLEF_AGENT_AGE_KEY_FILE        | —              | Path to age key file                 |
 * | CLEF_AGENT_TOKEN               | auto-generated | Bearer token for API auth            |
 */
export function resolveConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const source = env.CLEF_AGENT_SOURCE;

  // VCS configuration
  const vcsProvider = env.CLEF_AGENT_VCS_PROVIDER;
  const vcsRepo = env.CLEF_AGENT_VCS_REPO;
  const vcsToken = env.CLEF_AGENT_VCS_TOKEN;
  const vcsIdentity = env.CLEF_AGENT_VCS_IDENTITY;
  const vcsEnvironment = env.CLEF_AGENT_VCS_ENVIRONMENT;
  const vcsRef = env.CLEF_AGENT_VCS_REF;
  const vcsApiUrl = env.CLEF_AGENT_VCS_API_URL;
  const cachePath = env.CLEF_AGENT_CACHE_PATH;

  let vcs: VcsConfig | undefined;

  // If any VCS var is set, validate all required VCS vars
  const anyVcsSet = vcsProvider || vcsRepo || vcsToken || vcsIdentity || vcsEnvironment;
  if (anyVcsSet) {
    if (!vcsProvider || !vcsRepo || !vcsToken || !vcsIdentity || !vcsEnvironment) {
      throw new ConfigError(
        "When using VCS, all of CLEF_AGENT_VCS_PROVIDER, CLEF_AGENT_VCS_REPO, " +
          "CLEF_AGENT_VCS_TOKEN, CLEF_AGENT_VCS_IDENTITY, and CLEF_AGENT_VCS_ENVIRONMENT must be set.",
      );
    }
    const validProviders = ["github", "gitlab", "bitbucket"];
    if (!validProviders.includes(vcsProvider)) {
      throw new ConfigError(
        `Invalid CLEF_AGENT_VCS_PROVIDER '${vcsProvider}'. Must be one of: ${validProviders.join(", ")}.`,
      );
    }
    vcs = {
      provider: vcsProvider as VcsConfig["provider"],
      repo: vcsRepo,
      token: vcsToken,
      identity: vcsIdentity,
      environment: vcsEnvironment,
      ref: vcsRef,
      apiUrl: vcsApiUrl,
    };
  }

  // Require either source or VCS config
  if (!source && !vcs) {
    throw new ConfigError(
      "Either CLEF_AGENT_SOURCE or VCS configuration (CLEF_AGENT_VCS_*) is required.",
    );
  }

  const portStr = env.CLEF_AGENT_PORT ?? "7779";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ConfigError(
      `Invalid CLEF_AGENT_PORT '${portStr}'. Must be a number between 1 and 65535.`,
    );
  }

  const intervalStr = env.CLEF_AGENT_POLL_INTERVAL ?? "30";
  const pollInterval = parseInt(intervalStr, 10);
  if (isNaN(pollInterval) || pollInterval < 1) {
    throw new ConfigError(
      `Invalid CLEF_AGENT_POLL_INTERVAL '${intervalStr}'. Must be a positive integer.`,
    );
  }

  const ageKey = env.CLEF_AGENT_AGE_KEY;
  const ageKeyFile = env.CLEF_AGENT_AGE_KEY_FILE;
  if (!ageKey && !ageKeyFile) {
    throw new ConfigError("Either CLEF_AGENT_AGE_KEY or CLEF_AGENT_AGE_KEY_FILE must be set.");
  }

  const token = env.CLEF_AGENT_TOKEN ?? randomBytes(32).toString("hex");

  return { source, vcs, cachePath, port, pollInterval, ageKey, ageKeyFile, token };
}
