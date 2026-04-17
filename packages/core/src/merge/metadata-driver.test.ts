import * as YAML from "yaml";
import { mergeMetadataContents } from "./metadata-driver";

/** Helper: construct a `.clef-meta.yaml` content string from inputs. */
function meta(
  pending: Array<{ key: string; since: string; setBy: string }>,
  rotations: Array<{
    key: string;
    last_rotated_at: string;
    rotated_by: string;
    rotation_count: number;
  }>,
): string {
  return YAML.stringify({ version: 1, pending, rotations });
}

function parseMerged(content: string): {
  pending: Array<{ key: string; since: string; setBy: string }>;
  rotations: Array<{
    key: string;
    last_rotated_at: string;
    rotated_by: string;
    rotation_count: number;
  }>;
} {
  // Strip the header comment lines before parsing.
  const yamlOnly = content
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n");
  const parsed = YAML.parse(yamlOnly);
  return { pending: parsed.pending ?? [], rotations: parsed.rotations ?? [] };
}

describe("mergeMetadataContents", () => {
  describe("rotations merge", () => {
    it("keeps the later last_rotated_at when both sides modified the same key", () => {
      const ours = meta(
        [],
        [
          {
            key: "STRIPE_KEY",
            last_rotated_at: "2026-04-14T09:00:00.000Z",
            rotated_by: "alice",
            rotation_count: 3,
          },
        ],
      );
      const theirs = meta(
        [],
        [
          {
            key: "STRIPE_KEY",
            last_rotated_at: "2026-04-15T14:30:00.000Z",
            rotated_by: "bob",
            rotation_count: 3,
          },
        ],
      );

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.rotations).toHaveLength(1);
      expect(merged.rotations[0]).toMatchObject({
        key: "STRIPE_KEY",
        last_rotated_at: "2026-04-15T14:30:00.000Z", // later timestamp wins
        rotated_by: "bob", // follows the winning timestamp
        rotation_count: 4, // max(3, 3) + 1 records the merge
      });
    });

    it("merges disjoint per-key records from both sides (unrelated keys)", () => {
      const ours = meta(
        [],
        [
          {
            key: "KEY_A",
            last_rotated_at: "2026-04-14T09:00:00.000Z",
            rotated_by: "alice",
            rotation_count: 1,
          },
        ],
      );
      const theirs = meta(
        [],
        [
          {
            key: "KEY_B",
            last_rotated_at: "2026-04-15T14:30:00.000Z",
            rotated_by: "bob",
            rotation_count: 2,
          },
        ],
      );

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.rotations).toHaveLength(2);
      expect(merged.rotations.find((r) => r.key === "KEY_A")?.rotation_count).toBe(1);
      expect(merged.rotations.find((r) => r.key === "KEY_B")?.rotation_count).toBe(2);
    });

    it("takes the one-sided record verbatim when only one side has it", () => {
      const ours = meta(
        [],
        [
          {
            key: "KEY_A",
            last_rotated_at: "2026-04-14T09:00:00.000Z",
            rotated_by: "alice",
            rotation_count: 3,
          },
        ],
      );
      const theirs = meta([], []);

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.rotations).toHaveLength(1);
      expect(merged.rotations[0].rotation_count).toBe(3); // unchanged
    });

    it("takes the max of rotation_count across sides (+1) even when ours is older", () => {
      // Edge: ours has older timestamp but higher count.  The merge +1 bumps
      // count regardless of which timestamp wins.
      const ours = meta(
        [],
        [
          {
            key: "K",
            last_rotated_at: "2026-04-10T00:00:00.000Z",
            rotated_by: "alice",
            rotation_count: 5,
          },
        ],
      );
      const theirs = meta(
        [],
        [
          {
            key: "K",
            last_rotated_at: "2026-04-15T00:00:00.000Z",
            rotated_by: "bob",
            rotation_count: 2,
          },
        ],
      );

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.rotations[0].rotation_count).toBe(6); // max(5, 2) + 1
      expect(merged.rotations[0].last_rotated_at).toBe("2026-04-15T00:00:00.000Z");
      expect(merged.rotations[0].rotated_by).toBe("bob");
    });
  });

  describe("pending merge — resolution-wins state machine", () => {
    it("drops a pending entry if the other side resolved it (moved to rotations)", () => {
      // Scenario: Alice's branch still has KEY in `pending`.  Bob's branch
      // resolved it — KEY is absent from Bob's pending and present in Bob's
      // rotations.  Merge must drop pending and keep the resolution.
      const ours = meta([{ key: "KEY", since: "2026-04-10T00:00:00.000Z", setBy: "alice" }], []);
      const theirs = meta(
        [],
        [
          {
            key: "KEY",
            last_rotated_at: "2026-04-12T00:00:00.000Z",
            rotated_by: "bob",
            rotation_count: 1,
          },
        ],
      );

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.pending).toHaveLength(0);
      expect(merged.rotations).toHaveLength(1);
      expect(merged.rotations[0].key).toBe("KEY");
    });

    it("drops a pending entry when our side resolved it (symmetric)", () => {
      const ours = meta(
        [],
        [
          {
            key: "KEY",
            last_rotated_at: "2026-04-12T00:00:00.000Z",
            rotated_by: "alice",
            rotation_count: 1,
          },
        ],
      );
      const theirs = meta([{ key: "KEY", since: "2026-04-10T00:00:00.000Z", setBy: "bob" }], []);

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.pending).toHaveLength(0);
      expect(merged.rotations).toHaveLength(1);
    });

    it("keeps the later `since` when both sides have the same key still pending", () => {
      const ours = meta([{ key: "K", since: "2026-04-10T00:00:00.000Z", setBy: "alice" }], []);
      const theirs = meta([{ key: "K", since: "2026-04-12T00:00:00.000Z", setBy: "bob" }], []);

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.pending).toHaveLength(1);
      expect(merged.pending[0].since).toBe("2026-04-12T00:00:00.000Z");
      expect(merged.pending[0].setBy).toBe("bob");
    });

    it("keeps one-sided pending entries (no resolution on either side)", () => {
      const ours = meta(
        [{ key: "ONLY_OURS", since: "2026-04-10T00:00:00.000Z", setBy: "alice" }],
        [],
      );
      const theirs = meta([], []);

      const merged = parseMerged(mergeMetadataContents(ours, theirs));
      expect(merged.pending).toHaveLength(1);
      expect(merged.pending[0].key).toBe("ONLY_OURS");
    });
  });

  describe("robustness", () => {
    it("treats empty or malformed inputs as empty metadata (no throw)", () => {
      const merged = parseMerged(mergeMetadataContents("", "not: valid: yaml:"));
      expect(merged.pending).toEqual([]);
      expect(merged.rotations).toEqual([]);
    });

    it("produces the header comment in the output", () => {
      const out = mergeMetadataContents(meta([], []), meta([], []));
      expect(out.startsWith("# Managed by Clef. Do not edit manually.")).toBe(true);
    });

    it("emits both sections even when empty (predictable shape)", () => {
      const out = mergeMetadataContents(meta([], []), meta([], []));
      const parsed = parseMerged(out);
      expect(parsed.pending).toEqual([]);
      expect(parsed.rotations).toEqual([]);
    });
  });
});
