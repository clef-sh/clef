import * as crypto from "crypto";
import { ClefRuntime, init, InlineArtifactSource } from "./index";
import type { ArtifactSource, ArtifactFetchResult } from "./sources/types";

jest.mock("fs");
jest.mock(
  "age-encryption",
  () => ({
    Decrypter: jest.fn().mockImplementation(() => ({
      addIdentity: jest.fn(),
      decrypt: jest
        .fn()
        .mockResolvedValue('{"app":{"DB_URL":"postgres://...","API_KEY":"secret"}}'),
    })),
  }),
  { virtual: true },
);

const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeArtifact(revision = "rev1"): string {
  const ciphertext = "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----";
  const hash = crypto.createHash("sha256").update(ciphertext).digest("hex");

  return JSON.stringify({
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision,
    ciphertextHash: hash,
    ciphertext,
  });
}

describe("ClefRuntime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("with VCS source", () => {
    it("should fetch from VCS provider and expose secrets", async () => {
      const artifactJson = makeArtifact();
      const content = Buffer.from(artifactJson).toString("base64");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "abc123", content, encoding: "base64" }),
      });

      const runtime = new ClefRuntime({
        provider: "github",
        repo: "org/secrets",
        identity: "api-gateway",
        environment: "production",
        token: "ghp_test",
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();

      expect(runtime.ready).toBe(true);
      expect(runtime.get("DB_URL", "app")).toBe("postgres://...");
      expect(runtime.get("API_KEY", "app")).toBe("secret");
      expect(runtime.get("MISSING", "app")).toBeUndefined();
      expect(runtime.get("DB_URL", "wrong-ns")).toBeUndefined();
      expect(runtime.getAll()).toEqual({
        app: { DB_URL: "postgres://...", API_KEY: "secret" },
      });
      expect(runtime.env()).toEqual({
        app__DB_URL: "postgres://...",
        app__API_KEY: "secret",
      });
      expect(runtime.keys().sort()).toEqual(["app__API_KEY", "app__DB_URL"]);
      expect(runtime.revision).toBe("rev1");
    });
  });

  describe("with HTTP source", () => {
    it("should fetch from HTTP URL and expose secrets", async () => {
      const artifactJson = makeArtifact("http-rev");
      // URL doesn't end in .age.json — no revocation check, single fetch call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(artifactJson),
        headers: new Headers(),
      });

      const runtime = new ClefRuntime({
        source: "https://bucket.example.com/artifact.json",
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();

      expect(runtime.ready).toBe(true);
      expect(runtime.get("DB_URL", "app")).toBe("postgres://...");
      expect(runtime.revision).toBe("http-rev");
    });
  });

  describe("with file source", () => {
    it("should read from local file and expose secrets", async () => {
      const artifactJson = makeArtifact("file-rev");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMock = require("fs") as jest.Mocked<typeof import("fs")>;
      fsMock.readFileSync.mockImplementation((p: unknown) => {
        if (String(p).endsWith(".revoked.json")) throw new Error("ENOENT");
        return artifactJson;
      });

      const runtime = new ClefRuntime({
        source: "/path/to/artifact.age.json",
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();

      expect(runtime.ready).toBe(true);
      expect(runtime.revision).toBe("file-rev");
    });
  });

  describe("with inline source", () => {
    it("accepts a PackedArtifact object and exposes secrets", async () => {
      const artifact = JSON.parse(makeArtifact("inline-obj"));

      const runtime = new ClefRuntime({
        source: artifact,
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();

      expect(runtime.ready).toBe(true);
      expect(runtime.get("DB_URL", "app")).toBe("postgres://...");
      expect(runtime.revision).toBe("inline-obj");
    });

    it("accepts a JSON-string artifact via a pre-built InlineArtifactSource", async () => {
      // A raw JSON-string `source` would hit the file-path branch by design
      // (the JSON-string heuristic is intentionally not added). Users with a
      // string in hand wrap it explicitly.
      const runtime = new ClefRuntime({
        source: new InlineArtifactSource(makeArtifact("inline-str")),
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();
      expect(runtime.ready).toBe(true);
      expect(runtime.revision).toBe("inline-str");
    });

    it("passes through a pre-built InlineArtifactSource instance unchanged", async () => {
      const source = new InlineArtifactSource(JSON.parse(makeArtifact("inline-prebuilt")));
      const runtime = new ClefRuntime({
        source,
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();
      expect(runtime.ready).toBe(true);
      expect(runtime.revision).toBe("inline-prebuilt");
    });

    it("passes through a user-defined ArtifactSource (duck-typed)", async () => {
      class CustomSource implements ArtifactSource {
        async fetch(): Promise<ArtifactFetchResult> {
          return { raw: makeArtifact("custom-rev"), contentHash: "custom-hash" };
        }
        describe(): string {
          return "custom";
        }
      }

      const runtime = new ClefRuntime({
        source: new CustomSource(),
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();
      expect(runtime.ready).toBe(true);
      expect(runtime.revision).toBe("custom-rev");
      expect(runtime.get("DB_URL", "app")).toBe("postgres://...");
    });

    it("throws at construction when the inline object is malformed", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bad = { version: 1, identity: "x" } as any;
      expect(
        () =>
          new ClefRuntime({
            source: bad,
            ageKey: "AGE-SECRET-KEY-1TEST",
          }),
      ).toThrow(/inline artifact/);
    });
  });

  describe("error handling", () => {
    it("should throw when no source is configured", () => {
      expect(() => new ClefRuntime({ ageKey: "AGE-SECRET-KEY-1TEST" })).toThrow(
        "No artifact source configured",
      );
    });

    it("should not throw when no age key is provided (KMS envelope artifacts supported)", () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(makeArtifact()),
        headers: new Headers(),
      });

      expect(
        () =>
          new ClefRuntime({
            source: "https://example.com/a.json",
          }),
      ).not.toThrow();
    });
  });

  describe("before start()", () => {
    it("should not be ready before start", () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(makeArtifact()),
        headers: new Headers(),
      });

      const runtime = new ClefRuntime({
        source: "https://example.com/a.json",
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      expect(runtime.ready).toBe(false);
      expect(runtime.get("DB_URL", "app")).toBeUndefined();
      expect(runtime.getAll()).toEqual({});
      expect(runtime.keys()).toEqual([]);
      expect(runtime.revision).toBe("");
    });
  });

  describe("polling", () => {
    it("should expose poller and cache for agent integration", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(makeArtifact()),
        headers: new Headers(),
      });

      const runtime = new ClefRuntime({
        source: "https://example.com/a.json",
        ageKey: "AGE-SECRET-KEY-1TEST",
        cacheTtl: 300,
      });

      expect(runtime.getPoller()).toBeDefined();
      expect(runtime.getCache()).toBeDefined();
    });
  });
});

describe("init()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return a ready runtime", async () => {
    const artifactJson = makeArtifact("init-rev");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(artifactJson),
      headers: new Headers(),
    });

    const runtime = await init({
      source: "https://example.com/a.json",
      ageKey: "AGE-SECRET-KEY-1TEST",
    });

    expect(runtime.ready).toBe(true);
    expect(runtime.revision).toBe("init-rev");
  });
});
