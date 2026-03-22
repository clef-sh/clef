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
    this.artifactPath = path.join(dir, `${environment}.age.json`);
    this.metaPath = path.join(dir, `${environment}.meta`);
  }

  /** Write an artifact and optional metadata to disk (atomic via tmp+rename). */
  write(raw: string, sha?: string): void {
    const dir = path.dirname(this.artifactPath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpArtifact = `${this.artifactPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpArtifact, raw, "utf-8");
    fs.renameSync(tmpArtifact, this.artifactPath);

    const meta: DiskCacheMeta = { sha, fetchedAt: new Date().toISOString() };
    const tmpMeta = `${this.metaPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpMeta, JSON.stringify(meta), "utf-8");
    fs.renameSync(tmpMeta, this.metaPath);
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

  /** Get the fetchedAt timestamp from metadata, if available. */
  getFetchedAt(): string | undefined {
    try {
      const raw = fs.readFileSync(this.metaPath, "utf-8");
      const meta: DiskCacheMeta = JSON.parse(raw) as DiskCacheMeta;
      return meta.fetchedAt;
    } catch {
      return undefined;
    }
  }

  /** Remove cached artifact and metadata files. */
  purge(): void {
    try {
      fs.unlinkSync(this.artifactPath);
    } catch {
      // ENOENT is fine
    }
    try {
      fs.unlinkSync(this.metaPath);
    } catch {
      // ENOENT is fine
    }
  }
}
