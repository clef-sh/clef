import { VcsProvider, VcsProviderConfig, VcsFileResult } from "./types";

interface BitbucketMetaResponse {
  commit: { hash: string };
}

/** Bitbucket Source API provider. */
export class BitbucketProvider implements VcsProvider {
  private readonly repo: string;
  private readonly token: string;
  private readonly ref: string;
  private readonly apiUrl: string;

  constructor(config: VcsProviderConfig) {
    this.repo = config.repo;
    this.token = config.token;
    this.ref = config.ref ?? "main";
    this.apiUrl = config.apiUrl ?? "https://api.bitbucket.org";
  }

  async fetchFile(path: string): Promise<VcsFileResult> {
    const baseUrl = `${this.apiUrl}/2.0/repositories/${this.repo}/src/${this.ref}/${path}`;

    // Fetch metadata (JSON) for the commit hash
    const metaRes = await fetch(baseUrl, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    if (!metaRes.ok) {
      throw new Error(`Bitbucket API error: ${metaRes.status} fetching ${path} from ${this.repo}`);
    }

    const meta: BitbucketMetaResponse = (await metaRes.json()) as BitbucketMetaResponse;

    // Fetch raw file content
    const rawRes = await fetch(baseUrl, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!rawRes.ok) {
      throw new Error(
        `Bitbucket API error: ${rawRes.status} fetching raw content of ${path} from ${this.repo}`,
      );
    }

    const content = await rawRes.text();

    return { content, sha: meta.commit.hash };
  }
}
