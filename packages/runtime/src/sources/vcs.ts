import { VcsProvider } from "../vcs/types";
import { ArtifactSource, ArtifactFetchResult } from "./types";

/** Fetches a packed artifact from a VCS provider. */
export class VcsArtifactSource implements ArtifactSource {
  private readonly provider: VcsProvider;
  private readonly path: string;
  private readonly identity: string;
  private readonly environment: string;

  constructor(provider: VcsProvider, identity: string, environment: string) {
    this.provider = provider;
    this.identity = identity;
    this.environment = environment;
    this.path = `.clef/packed/${identity}/${environment}.age.json`;
  }

  async fetch(): Promise<ArtifactFetchResult> {
    const result = await this.provider.fetchFile(this.path);
    return { raw: result.content, contentHash: result.sha };
  }

  describe(): string {
    return `VCS .clef/packed/${this.identity}/${this.environment}.age.json`;
  }
}
