/** Thread-safe in-memory secrets cache with atomic swap. */
export class SecretsCache {
  private values: Record<string, string> | null = null;
  private revision: string | null = null;
  private keys: string[] = [];

  /** Atomically replace the cached secrets. */
  swap(values: Record<string, string>, keys: string[], revision: string): void {
    this.values = { ...values };
    this.keys = [...keys];
    this.revision = revision;
  }

  /** Get a single secret value by key. Returns undefined if not cached or key missing. */
  get(key: string): string | undefined {
    return this.values?.[key];
  }

  /** Get all cached secret values. Returns null if not yet loaded. */
  getAll(): Record<string, string> | null {
    if (!this.values) return null;
    return { ...this.values };
  }

  /** Get the list of available secret key names. */
  getKeys(): string[] {
    return [...this.keys];
  }

  /** Get the current artifact revision, or null if not loaded. */
  getRevision(): string | null {
    return this.revision;
  }

  /** Whether the cache has been loaded at least once. */
  isReady(): boolean {
    return this.values !== null;
  }
}
