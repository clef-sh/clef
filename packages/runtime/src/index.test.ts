import * as crypto from "crypto";
import { ClefRuntime, init } from "./index";

jest.mock("fs");
jest.mock(
  "age-encryption",
  () => ({
    Decrypter: jest.fn().mockImplementation(() => ({
      addIdentity: jest.fn(),
      decrypt: jest.fn().mockResolvedValue('{"DB_URL":"postgres://...","API_KEY":"secret"}'),
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
    keys: ["DB_URL", "API_KEY"],
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
      mockFetch.mockResolvedValue({
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
      expect(runtime.get("DB_URL")).toBe("postgres://...");
      expect(runtime.get("API_KEY")).toBe("secret");
      expect(runtime.getAll()).toEqual({ DB_URL: "postgres://...", API_KEY: "secret" });
      expect(runtime.env()).toEqual({ DB_URL: "postgres://...", API_KEY: "secret" });
      expect(runtime.keys()).toEqual(["DB_URL", "API_KEY"]);
      expect(runtime.revision).toBe("rev1");
    });
  });

  describe("with HTTP source", () => {
    it("should fetch from HTTP URL and expose secrets", async () => {
      const artifactJson = makeArtifact("http-rev");
      mockFetch.mockResolvedValue({
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
      expect(runtime.get("DB_URL")).toBe("postgres://...");
      expect(runtime.revision).toBe("http-rev");
    });
  });

  describe("with file source", () => {
    it("should read from local file and expose secrets", async () => {
      const artifactJson = makeArtifact("file-rev");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMock = require("fs") as jest.Mocked<typeof import("fs")>;
      fsMock.readFileSync.mockReturnValue(artifactJson);

      const runtime = new ClefRuntime({
        source: "/path/to/artifact.json",
        ageKey: "AGE-SECRET-KEY-1TEST",
      });

      await runtime.start();

      expect(runtime.ready).toBe(true);
      expect(runtime.revision).toBe("file-rev");
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
      expect(runtime.get("DB_URL")).toBeUndefined();
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
        pollInterval: 60,
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
    mockFetch.mockResolvedValue({
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
