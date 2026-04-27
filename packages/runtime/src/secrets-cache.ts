interface CacheSnapshot {
  values: Record<string, Record<string, string>>;
  revision: string;
  swappedAt: number;
}

/** In-memory secrets cache with single-reference swap. */
export class SecretsCache {
  private snapshot: CacheSnapshot | null = null;

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
    this.snapshot = { values: cloned, revision, swappedAt: Date.now() };
  }

  /** Whether the cache has exceeded the given TTL (seconds). */
  isExpired(ttlSeconds: number): boolean {
    if (!this.snapshot) return false;
    return (Date.now() - this.snapshot.swappedAt) / 1000 > ttlSeconds;
  }

  /** Clear the cached snapshot, zeroing values first (best-effort). */
  wipe(): void {
    if (this.snapshot) {
      for (const bucket of Object.values(this.snapshot.values)) {
        for (const k of Object.keys(bucket)) bucket[k] = "";
      }
    }
    this.snapshot = null;
  }

  /** Epoch ms when the cache was last swapped, or null if never loaded. */
  getSwappedAt(): number | null {
    return this.snapshot?.swappedAt ?? null;
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
