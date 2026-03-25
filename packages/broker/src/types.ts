/** Result of a broker's credential generation. */
export interface BrokerCreateResult {
  /** Generated credentials as key-value pairs. */
  data: Record<string, string>;
  /** Seconds until these credentials expire. */
  ttl: number;
  /** Identifier for revocation tracking (Tier 2 brokers). */
  entityId?: string;
}

/**
 * Handler interface that broker authors implement.
 *
 * Only `create` is required. Tier 1 brokers (self-expiring credentials like
 * STS tokens, RDS IAM tokens, OAuth access tokens) only need `create`.
 * Tier 2 brokers (stateful credentials like SQL database users) also
 * implement `revoke`.
 */
export interface BrokerHandler {
  /** Generate fresh credentials from the given configuration. */
  create(config: Record<string, string>): Promise<BrokerCreateResult>;
  /** Revoke a previously issued credential (Tier 2). */
  revoke?(entityId: string, config: Record<string, string>): Promise<void>;
  /** Validate that the handler can reach its target system. */
  validateConnection?(config: Record<string, string>): Promise<boolean>;
}

/** Log levels for broker operational logging. */
export type LogLevel = "info" | "warn" | "error";

/** Structured log callback. */
export type LogFn = (level: LogLevel, message: string, context?: Record<string, unknown>) => void;

/** Options for `createHandler()`. */
export interface HandleOptions {
  /** Service identity name embedded in the artifact envelope. */
  identity: string;
  /** Environment name embedded in the artifact envelope. */
  environment: string;
  /** KMS provider name ("aws", "gcp", or "azure"). */
  kmsProvider: string;
  /** KMS key ID/ARN for wrapping the ephemeral age private key. */
  kmsKeyId: string;
  /** KMS region (AWS only). */
  kmsRegion?: string;
  /** Override handler config. Default: collected from CLEF_BROKER_HANDLER_* env vars. */
  config?: Record<string, string>;
  /** Structured log callback for operational events. */
  onLog?: LogFn;
}

/** Response from a broker invocation. Maps directly to Lambda/Cloud Function response format. */
export interface BrokerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Handle returned by `createHandler()`. */
export interface BrokerInvoker {
  /** Generate or return a cached artifact envelope. */
  invoke(): Promise<BrokerResponse>;
  /** Graceful shutdown: revoke the active credential if applicable. */
  shutdown(): Promise<void>;
}

/** Options for the `serve()` HTTP server wrapper. */
export interface ServeOptions extends HandleOptions {
  /** Port to listen on. Default: 8080. */
  port?: number;
  /** Bind address. Default: "0.0.0.0" (broker serves encrypted envelopes, not plaintext). */
  host?: string;
}

/** Handle to a running broker server. */
export interface BrokerServerHandle {
  /** Base URL of the running server (e.g. "http://127.0.0.1:8080"). */
  url: string;
  /** Graceful shutdown: revokes active credential if applicable, then closes. */
  stop: () => Promise<void>;
}
