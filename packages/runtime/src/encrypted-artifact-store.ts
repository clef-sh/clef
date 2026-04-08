import type { ArtifactEnvelope } from "./poller";

/**
 * Holds the latest validated-but-encrypted artifact envelope.
 *
 * In JIT mode (cacheTtl=0) the poller writes here after fetch+validate,
 * and the HTTP server reads from here on each request to decrypt on demand.
 */
export class EncryptedArtifactStore {
  private artifact: ArtifactEnvelope | null = null;
  private _storedAt: number | null = null;

  /** Atomically replace the stored artifact. */
  swap(artifact: ArtifactEnvelope): void {
    this.artifact = artifact;
    this._storedAt = Date.now();
  }

  /** Get the current encrypted artifact. Returns null if not yet loaded. */
  get(): ArtifactEnvelope | null {
    return this.artifact;
  }

  /** Whether an artifact has been stored. */
  isReady(): boolean {
    return this.artifact !== null;
  }

  /** Epoch ms of last store, or null. */
  getStoredAt(): number | null {
    return this._storedAt;
  }

  /** Get the revision from the stored artifact. */
  getRevision(): string | null {
    return this.artifact?.revision ?? null;
  }

  /** Clear the stored artifact (on revocation/expiry). */
  wipe(): void {
    this.artifact = null;
    this._storedAt = null;
  }
}
