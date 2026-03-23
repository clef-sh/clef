import { ArtifactSource, ArtifactFetchResult } from "./types";

/** Fetches an artifact from an HTTP(S) URL. */
export class HttpArtifactSource implements ArtifactSource {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async fetch(): Promise<ArtifactFetchResult> {
    const res = await fetch(this.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch artifact from ${this.url}: ${res.status}`);
    }
    const raw = await res.text();
    const etag = res.headers.get("etag") ?? undefined;
    return { raw, contentHash: etag };
  }

  describe(): string {
    return `HTTP ${this.url}`;
  }
}
