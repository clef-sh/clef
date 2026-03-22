import * as fs from "fs";
import { ArtifactSource, ArtifactFetchResult } from "./types";

/** Reads an artifact from a local file. */
export class FileArtifactSource implements ArtifactSource {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async fetch(): Promise<ArtifactFetchResult> {
    const raw = fs.readFileSync(this.path, "utf-8");
    return { raw };
  }

  describe(): string {
    return `file ${this.path}`;
  }
}
