/**
 * Filesystem-backed `BlobStore`. Cells are stored as SOPS files at paths
 * derived from the manifest's `file_pattern` (e.g.
 * `{namespace}/{environment}.enc.yaml`). Pending/rotation metadata
 * lives in a co-located `.clef-meta.yaml` sidecar (mirroring the
 * existing on-disk format).
 *
 * Atomicity: `writeBlob` uses `writeFileAtomic` so a crash mid-write
 * cannot leave a torn ciphertext file. `writePendingMetadata` likewise
 * uses the existing `pending/metadata.ts` helpers, which are atomic.
 *
 * Path operations (cell→file, namespace→directory) are exposed publicly
 * so the substrate-specific traits (`MergeAware`, `Structural`) wired
 * up by `composeSecretSource` can do filesystem-shaped work like
 * `fs.renameSync` cascades.
 */
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import type { ClefManifest } from "../types";
import type { BlobStore } from "./blob-store";
import type { CellRef, CellPendingMetadata } from "./types";
import { loadMetadata, saveMetadata } from "../pending/metadata";

export class FilesystemBlobStore implements BlobStore {
  readonly id = "filesystem";
  readonly description = "Filesystem-backed SOPS files (default substrate)";

  constructor(
    private readonly manifest: ClefManifest,
    private readonly repoRoot: string,
  ) {}

  /**
   * Resolve a cell reference to its absolute filesystem path. Public —
   * used by substrate-specific trait implementations.
   */
  cellPath(cell: CellRef): string {
    const relativePath = this.manifest.file_pattern
      .replace("{namespace}", cell.namespace)
      .replace("{environment}", cell.environment);
    return path.join(this.repoRoot, relativePath);
  }

  /** The repo root, exposed for filesystem-shaped trait implementations. */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  blobFormat(cell: CellRef): "yaml" | "json" {
    return this.cellPath(cell).endsWith(".json") ? "json" : "yaml";
  }

  async readBlob(cell: CellRef): Promise<string> {
    const filePath = this.cellPath(cell);
    return fs.readFileSync(filePath, "utf-8");
  }

  async writeBlob(cell: CellRef, blob: string): Promise<void> {
    const filePath = this.cellPath(cell);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic write: a torn file from Ctrl+C / OOM mid-write would be
    // undecryptable. Write to a sibling temp path, fsync, then rename
    // (POSIX rename is atomic on the same filesystem; Windows rename is
    // atomic since at least NT 5.1). This mirrors what `write-file-atomic`
    // does — kept inline to keep `BlobStore` substrate-internal and
    // testable without mock-juggling.
    const tmpPath = `${filePath}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
    const handle = fs.openSync(tmpPath, "w");
    try {
      fs.writeFileSync(handle, blob);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tmpPath, filePath);
  }

  async deleteBlob(cell: CellRef): Promise<void> {
    const filePath = this.cellPath(cell);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Also clean up the sidecar — orphaned `.clef-meta.yaml` files
    // would mislead lint into reporting pending state for a cell that
    // no longer exists.
    const sidecar = this.sidecarPath(filePath);
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }

  async blobExists(cell: CellRef): Promise<boolean> {
    return fs.existsSync(this.cellPath(cell));
  }

  async readPendingMetadata(cell: CellRef): Promise<CellPendingMetadata> {
    return loadMetadata(this.cellPath(cell));
  }

  async writePendingMetadata(cell: CellRef, meta: CellPendingMetadata): Promise<void> {
    await saveMetadata(this.cellPath(cell), meta);
  }

  private sidecarPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath).replace(/\.enc\.(yaml|json)$/, "");
    return path.join(dir, `${base}.clef-meta.yaml`);
  }
}
