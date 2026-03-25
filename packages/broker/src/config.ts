const VALID_KMS_PROVIDERS = ["aws", "gcp", "azure"];
const HANDLER_PREFIX = "CLEF_BROKER_HANDLER_";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Resolved broker configuration. */
export interface BrokerConfig {
  identity: string;
  environment: string;
  kmsProvider: string;
  kmsKeyId: string;
  kmsRegion?: string;
  port: number;
  host: string;
  handlerConfig: Record<string, string>;
}

/**
 * Resolve broker configuration from environment variables.
 *
 * Required:
 *   CLEF_BROKER_IDENTITY, CLEF_BROKER_ENVIRONMENT,
 *   CLEF_BROKER_KMS_PROVIDER, CLEF_BROKER_KMS_KEY_ID
 *
 * Optional:
 *   CLEF_BROKER_KMS_REGION, CLEF_BROKER_PORT (default 8080),
 *   CLEF_BROKER_HOST (default "0.0.0.0")
 *
 * Handler config: all CLEF_BROKER_HANDLER_* vars are collected with the prefix stripped.
 */
export function resolveConfig(env: Record<string, string | undefined> = process.env): BrokerConfig {
  const identity = env.CLEF_BROKER_IDENTITY;
  if (!identity) throw new ConfigError("CLEF_BROKER_IDENTITY is required.");

  const environment = env.CLEF_BROKER_ENVIRONMENT;
  if (!environment) throw new ConfigError("CLEF_BROKER_ENVIRONMENT is required.");

  const kmsProvider = env.CLEF_BROKER_KMS_PROVIDER;
  if (!kmsProvider) throw new ConfigError("CLEF_BROKER_KMS_PROVIDER is required.");
  if (!VALID_KMS_PROVIDERS.includes(kmsProvider)) {
    throw new ConfigError(
      `CLEF_BROKER_KMS_PROVIDER must be one of: ${VALID_KMS_PROVIDERS.join(", ")}. Got: "${kmsProvider}"`,
    );
  }

  const kmsKeyId = env.CLEF_BROKER_KMS_KEY_ID;
  if (!kmsKeyId) throw new ConfigError("CLEF_BROKER_KMS_KEY_ID is required.");

  const kmsRegion = env.CLEF_BROKER_KMS_REGION;

  const portStr = env.CLEF_BROKER_PORT ?? "8080";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ConfigError(`CLEF_BROKER_PORT must be 1-65535. Got: "${portStr}"`);
  }

  const host = env.CLEF_BROKER_HOST ?? "0.0.0.0";

  // Collect handler-specific config from CLEF_BROKER_HANDLER_* env vars
  const handlerConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(HANDLER_PREFIX) && value !== undefined) {
      handlerConfig[key.slice(HANDLER_PREFIX.length)] = value;
    }
  }

  return { identity, environment, kmsProvider, kmsKeyId, kmsRegion, port, host, handlerConfig };
}
