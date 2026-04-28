import { ClefClientOptions } from "./types";
import { resolveToken, resolveEndpoint } from "./auth";
import { request } from "./http";

interface CacheEntry {
  secrets: Record<string, Record<string, string>>;
  fetchedAt: number;
}

/**
 * Lightweight client for consuming Clef secrets from a serve endpoint.
 *
 * ```typescript
 * const secrets = new ClefClient();
 * const dbUrl = await secrets.get("DB_URL");
 * ```
 */
export class ClefClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly envFallback: boolean;
  private readonly cacheTtlMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private cache: CacheEntry | null = null;

  constructor(options?: ClefClientOptions) {
    this.endpoint = resolveEndpoint(options?.endpoint);
    this.token = resolveToken(options?.token);
    this.envFallback = options?.envFallback ?? true;
    this.cacheTtlMs = options?.cacheTtlMs ?? 0;
    this.fetchFn = options?.fetch ?? globalThis.fetch;
  }

  /**
   * Get a single secret value, scoped to a namespace.
   *
   * Falls back to `process.env['<namespace>__<key>']` (the env-var-shaped
   * qualified form) when `envFallback` is enabled and the secret isn't found.
   */
  async get(key: string, namespace: string): Promise<string | undefined> {
    const all = await this.fetchSecrets();
    const value = all[namespace]?.[key];
    if (value !== undefined) return value;

    if (this.envFallback && typeof process !== "undefined") {
      return process.env[`${namespace}__${key}`];
    }

    return undefined;
  }

  /** Get all secrets as `namespace → key → value`. */
  async getAll(): Promise<Record<string, Record<string, string>>> {
    return this.fetchSecrets();
  }

  /** List available key names in flat `<namespace>__<key>` form. */
  async keys(): Promise<string[]> {
    const all = await this.fetchSecrets();
    const out: string[] = [];
    for (const [ns, bucket] of Object.entries(all)) {
      for (const k of Object.keys(bucket)) out.push(`${ns}__${k}`);
    }
    return out;
  }

  /** Check if the serve endpoint is reachable. */
  async health(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.endpoint}/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchSecrets(): Promise<Record<string, Record<string, string>>> {
    if (this.cacheTtlMs > 0 && this.cache) {
      const age = Date.now() - this.cache.fetchedAt;
      if (age < this.cacheTtlMs) {
        return this.cache.secrets;
      }
    }

    const secrets = await request<Record<string, Record<string, string>>>(this.endpoint, {
      method: "GET",
      path: "/v1/secrets",
      token: this.token,
      fetchFn: this.fetchFn,
    });

    if (this.cacheTtlMs > 0) {
      this.cache = { secrets, fetchedAt: Date.now() };
    }

    return secrets;
  }
}
