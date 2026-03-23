interface CacheSnapshot {
  values: Record<string, string>;
  keys: string[];
  revision: string;
  swappedAt: number;
}

/** In-memory secrets cache with single-reference swap. */
export class SecretsCache {
  private snapshot: CacheSnapshot | null = null;

  /** Replace the cached secrets in a single reference assignment. */
  swap(values: Record<string, string>, keys: string[], revision: string): void {
    this.snapshot = { values: { ...values }, keys: [...keys], revision, swappedAt: Date.now() };
  }

  /** Whether the cache has exceeded the given TTL (seconds). */
  isExpired(ttlSeconds: number): boolean {
    if (!this.snapshot) return false;
    return (Date.now() - this.snapshot.swappedAt) / 1000 > ttlSeconds;
  }

  /** Clear the cached snapshot. */
  wipe(): void {
    this.snapshot = null;
  }

  /** Epoch ms when the cache was last swapped, or null if never loaded. */
  getSwappedAt(): number | null {
    return this.snapshot?.swappedAt ?? null;
  }

  /** Get a single secret value by key. Returns undefined if not cached or key missing. */
  get(key: string): string | undefined {
    return this.snapshot?.values[key];
  }

  /** Get all cached secret values. Returns null if not yet loaded. */
  getAll(): Record<string, string> | null {
    const s = this.snapshot;
    if (!s) return null;
    return { ...s.values };
  }

  /** Get the list of available secret key names. */
  getKeys(): string[] {
    const s = this.snapshot;
    return s ? [...s.keys] : [];
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
