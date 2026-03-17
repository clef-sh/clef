import { randomBytes } from "crypto";

/** Resolved agent configuration. */
export interface AgentConfig {
  /** HTTP URL or local file path to the published artifact. */
  source: string;
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
 * | Variable                  | Default        | Description                          |
 * |---------------------------|----------------|--------------------------------------|
 * | CLEF_AGENT_SOURCE         | (required)     | HTTP URL or local file path          |
 * | CLEF_AGENT_PORT           | 7779           | HTTP API port                        |
 * | CLEF_AGENT_POLL_INTERVAL  | 30             | Seconds between polls                |
 * | CLEF_AGENT_AGE_KEY        | —              | Inline age private key               |
 * | CLEF_AGENT_AGE_KEY_FILE   | —              | Path to age key file                 |
 * | CLEF_AGENT_TOKEN          | auto-generated | Bearer token for API auth            |
 */
export function resolveConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const source = env.CLEF_AGENT_SOURCE;
  if (!source) {
    throw new ConfigError(
      "CLEF_AGENT_SOURCE is required. Set it to an HTTP URL or local file path.",
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

  return { source, port, pollInterval, ageKey, ageKeyFile, token };
}
