/** Configuration for the ClefClient app SDK. */
export interface ClefClientOptions {
  /** Base URL of the clef serve endpoint. Default: http://127.0.0.1:7779 */
  endpoint?: string;
  /** Bearer token for authentication. Falls back to CLEF_SERVICE_TOKEN env var. */
  token?: string;
  /** Fall back to process.env when a key is not found. Default: true */
  envFallback?: boolean;
  /** In-memory cache TTL in milliseconds. 0 = no caching. Default: 0 */
  cacheTtlMs?: number;
  /** Custom fetch implementation (for testing or edge runtimes). */
  fetch?: typeof globalThis.fetch;
}

/** Error thrown by ClefClient. */
export class ClefClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly fix?: string,
  ) {
    super(message);
    this.name = "ClefClientError";
  }
}
