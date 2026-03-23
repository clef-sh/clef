/** Result of fetching a file from a VCS provider. */
export interface VcsFileResult {
  /** Raw file content. */
  content: string;
  /** Git blob SHA for change detection. */
  sha: string;
}

/** Configuration for a VCS provider. */
export interface VcsProviderConfig {
  /** VCS platform. */
  provider: "github" | "gitlab" | "bitbucket";
  /** Repository identifier, e.g. "owner/repo". */
  repo: string;
  /** Authentication token. */
  token: string;
  /** Branch, tag, or commit SHA. Defaults to the repo's default branch. */
  ref?: string;
  /** Custom base URL for self-hosted instances (GHE, GitLab CE/EE, Bitbucket DC). */
  apiUrl?: string;
}

/** Fetches files from a VCS provider API. */
export interface VcsProvider {
  /**
   * Fetch a single file by path from the repository.
   * @param path - Repository-relative file path (e.g. `.clef/packed/api/production.age.json`).
   */
  fetchFile(path: string): Promise<VcsFileResult>;
}
