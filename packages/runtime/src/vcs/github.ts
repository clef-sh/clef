import { VcsProvider, VcsProviderConfig, VcsFileResult } from "./types";

interface GitHubContentsResponse {
  sha: string;
  content: string;
  encoding: string;
}

/** GitHub Contents API provider. */
export class GitHubProvider implements VcsProvider {
  private readonly repo: string;
  private readonly token: string;
  private readonly ref?: string;
  private readonly apiUrl: string;

  constructor(config: VcsProviderConfig) {
    this.repo = config.repo;
    this.token = config.token;
    this.ref = config.ref;
    this.apiUrl = config.apiUrl ?? "https://api.github.com";
  }

  async fetchFile(path: string): Promise<VcsFileResult> {
    const url = new URL(`/repos/${this.repo}/contents/${path}`, this.apiUrl);
    if (this.ref) url.searchParams.set("ref", this.ref);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} fetching ${path} from ${this.repo}`);
    }

    const data: GitHubContentsResponse = (await res.json()) as GitHubContentsResponse;
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return { content, sha: data.sha };
  }
}
