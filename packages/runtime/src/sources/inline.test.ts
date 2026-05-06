import { InlineArtifactSource } from "./inline";
import { InvalidArtifactError } from "@clef-sh/core";
import type { PackedArtifact } from "@clef-sh/core";

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision: "rev1",
    ciphertextHash: "deadbeef",
    ciphertext: "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----",
    ...overrides,
  };
}

describe("InlineArtifactSource", () => {
  describe("constructor with string input", () => {
    it("accepts a valid JSON string and returns it verbatim from fetch", async () => {
      const json = JSON.stringify(makeArtifact());
      const source = new InlineArtifactSource(json);
      const result = await source.fetch();
      expect(result.raw).toBe(json);
    });

    it("throws InvalidArtifactError at construction for missing fields", () => {
      const bad = JSON.stringify({ version: 1, identity: "x" });
      expect(() => new InlineArtifactSource(bad)).toThrow(InvalidArtifactError);
    });

    it("throws InvalidArtifactError at construction for unsupported version", () => {
      const bad = JSON.stringify({ ...makeArtifact(), version: 2 });
      expect(() => new InlineArtifactSource(bad)).toThrow(/unsupported version/);
    });

    it("throws SyntaxError at construction for malformed JSON", () => {
      expect(() => new InlineArtifactSource("{not json}")).toThrow(SyntaxError);
    });
  });

  describe("constructor with object input", () => {
    it("accepts a valid PackedArtifact object and stringifies it for fetch", async () => {
      const artifact = makeArtifact();
      const source = new InlineArtifactSource(artifact);
      const result = await source.fetch();
      expect(JSON.parse(result.raw)).toEqual(artifact);
    });

    it("throws InvalidArtifactError at construction for missing fields", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bad = { version: 1, identity: "x" } as any;
      expect(() => new InlineArtifactSource(bad)).toThrow(InvalidArtifactError);
    });

    it("throws InvalidArtifactError at construction for wrong version", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bad = { ...makeArtifact(), version: 2 } as any;
      expect(() => new InlineArtifactSource(bad)).toThrow(/unsupported version/);
    });
  });

  describe("contentHash", () => {
    it("is stable across repeated fetch calls", async () => {
      const source = new InlineArtifactSource(makeArtifact());
      const a = await source.fetch();
      const b = await source.fetch();
      expect(a.contentHash).toBe(b.contentHash);
      expect(a.contentHash).toBeDefined();
    });

    it("differs between distinct artifacts", async () => {
      const a = new InlineArtifactSource(makeArtifact({ revision: "rev-a" }));
      const b = new InlineArtifactSource(makeArtifact({ revision: "rev-b" }));
      const ra = await a.fetch();
      const rb = await b.fetch();
      expect(ra.contentHash).not.toBe(rb.contentHash);
    });
  });

  describe("describe", () => {
    it("labels object inputs without leaking ciphertext", () => {
      const source = new InlineArtifactSource(makeArtifact());
      expect(source.describe()).toBe("inline (PackedArtifact)");
    });

    it("labels string inputs with byte length but no contents", () => {
      const json = JSON.stringify(makeArtifact());
      const source = new InlineArtifactSource(json);
      expect(source.describe()).toBe(`inline (json string, ${json.length} bytes)`);
      expect(source.describe()).not.toContain("BEGIN AGE");
    });
  });
});
