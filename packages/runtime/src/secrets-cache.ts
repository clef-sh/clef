interface CacheSnapshot {
  values: Record<string, Record<string, string>>;
  revision: string;
  swappedAt: number;
}

/** In-memory secrets cache with single-reference swap. */
export class SecretsCache {
  private snapshot: CacheSnapshot | null = null;
  // Tracks the last successful refresh attempt, including no-op refreshes
  // where the source returned identical content. TTL is measured against
  // this — not against `swappedAt` — so a stable artifact doesn't cause
  // the cache to "expire" while polling is healthy.
  private lastRefreshAt: number | null = null;

  /** Replace the cached secrets in a single reference assignment. */
  swap(values: Record<string, Record<string, string>>, revision: string): void {
    // Zero old values before dropping the reference — defense-in-depth
    // against plaintext lingering in the heap until GC.
    if (this.snapshot) {
      for (const bucket of Object.values(this.snapshot.values)) {
        for (const k of Object.keys(bucket)) bucket[k] = "";
      }
    }
    const cloned: Record<string, Record<string, string>> = {};
    for (const [ns, bucket] of Object.entries(values)) {
      cloned[ns] = { ...bucket };
    }
    const now = Date.now();
    this.snapshot = { values: cloned, revision, swappedAt: now };
    this.lastRefreshAt = now;
  }

  /**
   * Bump the freshness clock without touching cached values. Called by the
   * poller when a fetch succeeds but the artifact is unchanged (same content
   * hash or same revision) — proves the source is still reachable and the
   * cached secrets are still authoritative.
   */
  markFresh(): void {
    this.lastRefreshAt = Date.now();
  }

  /** Whether the last successful refresh has exceeded the given TTL (seconds). */
  isExpired(ttlSeconds: number): boolean {
    if (this.lastRefreshAt === null) return false;
    return (Date.now() - this.lastRefreshAt) / 1000 > ttlSeconds;
  }

  /** Clear the cached snapshot, zeroing values first (best-effort). */
  wipe(): void {
    if (this.snapshot) {
      for (const bucket of Object.values(this.snapshot.values)) {
        for (const k of Object.keys(bucket)) bucket[k] = "";
      }
    }
    this.snapshot = null;
    this.lastRefreshAt = null;
  }

  /** Epoch ms when the cache values last *changed*, or null if never loaded. */
  getSwappedAt(): number | null {
    return this.snapshot?.swappedAt ?? null;
  }

  /** Epoch ms of the last successful refresh attempt (incl. no-op), or null. */
  getLastRefreshAt(): number | null {
    return this.lastRefreshAt;
  }

  /**
   * Get a single secret value.
   *
   * - With `namespace`: scoped lookup (`values[namespace]?.[key]`).
   * - Without `namespace`: searches every namespace, returns the first match.
   *   This loose form exists for **internal callers only** (the agent's
   *   telemetry-config bootstrap) where the namespace isn't known a priori.
   *   Public APIs (`runtime.get`, `client.get`) require the namespace.
   */
  get(key: string, namespace?: string): string | undefined {
    const values = this.snapshot?.values;
    if (!values) return undefined;
    if (namespace !== undefined) return values[namespace]?.[key];
    for (const bucket of Object.values(values)) {
      if (key in bucket) return bucket[key];
    }
    return undefined;
  }

  /** Get all cached secrets as nested namespace → key → value. Null if not yet loaded. */
  getAll(): Record<string, Record<string, string>> | null {
    const s = this.snapshot;
    if (!s) return null;
    const out: Record<string, Record<string, string>> = {};
    for (const [ns, bucket] of Object.entries(s.values)) {
      out[ns] = { ...bucket };
    }
    return out;
  }

  /** Get the list of available secret key names in flat `<namespace>__<key>` form. */
  getKeys(): string[] {
    const s = this.snapshot;
    if (!s) return [];
    const out: string[] = [];
    for (const [ns, bucket] of Object.entries(s.values)) {
      for (const k of Object.keys(bucket)) out.push(`${ns}__${k}`);
    }
    return out;
  }

  /** Get the current artifact revision, or null if not loaded. */
  getRevision(): string | null {
    return this.snapshot?.revision ?? null;
  }

  /** Whether the cache has been loaded at least once. */
  isReady(): boolean {
    return this.snapshot !== null;
  }
}
