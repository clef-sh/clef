import { VcsProvider, VcsProviderConfig, VcsFileResult } from "./types";

interface GitLabFileResponse {
  blob_id: string;
  content: string;
  encoding: string;
}

/** GitLab Repository Files API provider. */
export class GitLabProvider implements VcsProvider {
  private readonly repo: string;
  private readonly token: string;
  private readonly ref?: string;
  private readonly apiUrl: string;

  constructor(config: VcsProviderConfig) {
    this.repo = config.repo;
    this.token = config.token;
    this.ref = config.ref;
    this.apiUrl = config.apiUrl ?? "https://gitlab.com";
  }

  async fetchFile(path: string): Promise<VcsFileResult> {
    const encodedRepo = encodeURIComponent(this.repo);
    const encodedPath = encodeURIComponent(path);
    const url = new URL(
      `/api/v4/projects/${encodedRepo}/repository/files/${encodedPath}`,
      this.apiUrl,
    );
    if (this.ref) url.searchParams.set("ref", this.ref);

    const res = await fetch(url.toString(), {
      headers: {
        "PRIVATE-TOKEN": this.token,
      },
    });

    if (!res.ok) {
      throw new Error(`GitLab API error: ${res.status} fetching ${path} from ${this.repo}`);
    }

    const data: GitLabFileResponse = (await res.json()) as GitLabFileResponse;
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return { content, sha: data.blob_id };
  }
}
