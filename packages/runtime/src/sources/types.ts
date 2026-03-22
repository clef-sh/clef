/** Result of fetching an artifact from a source. */
export interface ArtifactFetchResult {
  /** Raw artifact JSON string. */
  raw: string;
  /** VCS SHA / HTTP ETag for change detection. */
  contentHash?: string;
}

/** Strategy interface for fetching packed artifacts. */
export interface ArtifactSource {
  /** Fetch the artifact. */
  fetch(): Promise<ArtifactFetchResult>;
  /** Human-readable description for logging. */
  describe(): string;
}
