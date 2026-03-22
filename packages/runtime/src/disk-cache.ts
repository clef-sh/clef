import * as fs from "fs";
import * as path from "path";

interface DiskCacheMeta {
  sha?: string;
  fetchedAt: string;
}

/**
 * Disk-based cache for artifact fallback.
 *
 * Writes artifact JSON and metadata to disk so the runtime can recover
 * from VCS API failures by falling back to the last known good artifact.
 */
export class DiskCache {
  private readonly artifactPath: string;
  private readonly metaPath: string;

  constructor(cachePath: string, identity: string, environment: string) {
    const dir = path.join(cachePath, identity);
    this.artifactPath = path.join(dir, `${environment}.age`);
    this.metaPath = path.join(dir, `${environment}.meta`);
  }

  /** Write an artifact and optional metadata to disk. */
  write(raw: string, sha?: string): void {
    const dir = path.dirname(this.artifactPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.artifactPath, raw, "utf-8");
    const meta: DiskCacheMeta = { sha, fetchedAt: new Date().toISOString() };
    fs.writeFileSync(this.metaPath, JSON.stringify(meta), "utf-8");
  }

  /** Read the cached artifact. Returns null if no cache file exists. */
  read(): string | null {
    try {
      return fs.readFileSync(this.artifactPath, "utf-8");
    } catch {
      return null;
    }
  }

  /** Get the SHA from the cached metadata, if available. */
  getCachedSha(): string | undefined {
    try {
      const raw = fs.readFileSync(this.metaPath, "utf-8");
      const meta: DiskCacheMeta = JSON.parse(raw) as DiskCacheMeta;
      return meta.sha;
    } catch {
      return undefined;
    }
  }
}
