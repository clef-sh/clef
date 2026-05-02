import * as crypto from "crypto";
import { assertPackedArtifact } from "@clef-sh/core";
import type { PackedArtifact } from "@clef-sh/core";
import { ArtifactSource, ArtifactFetchResult } from "./types";

/**
 * Reads an artifact from an in-memory value — a parsed {@link PackedArtifact}
 * object or a pre-stringified JSON string.
 *
 * Use this when the encrypted artifact is bundled directly into the deployed
 * code (e.g. `import artifact from "./artifact.production.json"` in a Vercel
 * serverless function), avoiding any runtime fetch from disk or network.
 *
 * Validation runs eagerly in the constructor — `assertPackedArtifact` is
 * called once on the parsed value, so a malformed artifact throws at the
 * construction site (or module-import time if the source is wired at the
 * top level), not deep inside `runtime.start()`.
 *
 * Calling `runtime.startPolling()` with an inline source is unnecessary —
 * the content cannot change for the lifetime of the process.
 */
export class InlineArtifactSource implements ArtifactSource {
  private readonly raw: string;
  private readonly contentHashValue: string;
  private readonly inputKind: "object" | "string";

  constructor(artifact: string | PackedArtifact) {
    if (typeof artifact === "string") {
      const parsed: unknown = JSON.parse(artifact);
      assertPackedArtifact(parsed, "inline artifact");
      this.raw = artifact;
      this.inputKind = "string";
    } else {
      assertPackedArtifact(artifact, "inline artifact");
      this.raw = JSON.stringify(artifact);
      this.inputKind = "object";
    }
    this.contentHashValue = crypto.createHash("sha256").update(this.raw).digest("hex").slice(0, 16);
  }

  async fetch(): Promise<ArtifactFetchResult> {
    return { raw: this.raw, contentHash: this.contentHashValue };
  }

  describe(): string {
    return this.inputKind === "object"
      ? "inline (PackedArtifact)"
      : `inline (json string, ${this.raw.length} bytes)`;
  }
}
