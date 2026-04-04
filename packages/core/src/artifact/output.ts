import * as fs from "fs";
import * as path from "path";
import type { PackOutput, PackedArtifact } from "./types";

/** Writes the packed artifact to a local file (atomic rename). */
export class FilePackOutput implements PackOutput {
  constructor(private readonly outputPath: string) {}

  async write(_artifact: PackedArtifact, json: string): Promise<void> {
    const outputDir = path.dirname(this.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const tmpOutput = `${this.outputPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpOutput, json, "utf-8");
    fs.renameSync(tmpOutput, this.outputPath);
  }
}

/** Keeps the packed artifact in memory. Used by `clef serve` to avoid disk I/O. */
export class MemoryPackOutput implements PackOutput {
  private _artifact: PackedArtifact | null = null;
  private _json: string | null = null;

  async write(artifact: PackedArtifact, json: string): Promise<void> {
    this._artifact = artifact;
    this._json = json;
  }

  /** The packed artifact, or null if `write` hasn't been called. */
  get artifact(): PackedArtifact | null {
    return this._artifact;
  }

  /** The serialized JSON, or null if `write` hasn't been called. */
  get json(): string | null {
    return this._json;
  }
}
