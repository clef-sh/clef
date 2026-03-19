import * as fs from "fs";
import * as crypto from "crypto";
import { ArtifactPoller } from "./poller";
import { SecretsCache } from "./cache";

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

const mockFs = fs as jest.Mocked<typeof fs>;

function makeArtifact(
  overrides: Partial<{
    version: number;
    revision: string;
    ciphertext: string;
    ciphertextHash: string;
    keys: string[];
  }> = {},
): string {
  const ciphertext =
    overrides.ciphertext ??
    "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----";
  const hash =
    overrides.ciphertextHash ?? crypto.createHash("sha256").update(ciphertext).digest("hex");

  return JSON.stringify({
    version: overrides.version ?? 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision: overrides.revision ?? "1705276800000",
    ciphertextHash: hash,
    ciphertext,
    keys: overrides.keys ?? ["DB_URL", "API_KEY"],
  });
}

describe("ArtifactPoller", () => {
  let cache: SecretsCache;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    cache = new SecretsCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("fetchAndDecrypt", () => {
    it("should fetch from local file and populate cache", async () => {
      mockFs.readFileSync.mockReturnValue(makeArtifact());

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();

      expect(cache.isReady()).toBe(true);
      expect(cache.get("DB_URL")).toBe("postgres://...");
      expect(cache.get("API_KEY")).toBe("secret");
      expect(cache.getRevision()).toBe("1705276800000");
    });

    it("should skip when revision is unchanged", async () => {
      mockFs.readFileSync.mockReturnValue(makeArtifact({ revision: "rev1" }));

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();
      expect(cache.getRevision()).toBe("rev1");

      // Second fetch with same revision — should be a no-op
      const swapSpy = jest.spyOn(cache, "swap");
      await poller.fetchAndDecrypt();
      expect(swapSpy).not.toHaveBeenCalled();
    });

    it("should update cache when revision changes", async () => {
      mockFs.readFileSync.mockReturnValueOnce(makeArtifact({ revision: "rev1" }));

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();
      expect(cache.getRevision()).toBe("rev1");

      mockFs.readFileSync.mockReturnValueOnce(makeArtifact({ revision: "rev2" }));
      await poller.fetchAndDecrypt();
      expect(cache.getRevision()).toBe("rev2");
    });

    it("should throw on integrity check failure", async () => {
      mockFs.readFileSync.mockReturnValue(
        makeArtifact({
          ciphertextHash: "badhash000000000000000000000000000000000000000000000000000000000",
        }),
      );

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("integrity check failed");
    });

    it("should throw on unsupported artifact version", async () => {
      mockFs.readFileSync.mockReturnValue(makeArtifact({ version: 99 }));

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Unsupported artifact version");
    });

    it("should fetch from HTTP URL", async () => {
      const artifactJson = makeArtifact();
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(artifactJson),
      });
      global.fetch = mockFetch;

      const poller = new ArtifactPoller({
        source: "https://bucket.example.com/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();

      expect(mockFetch).toHaveBeenCalledWith("https://bucket.example.com/artifact.json");
      expect(cache.isReady()).toBe(true);
    });

    it("should throw on HTTP error", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const poller = new ArtifactPoller({
        source: "https://bucket.example.com/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("404");
    });
  });

  describe("start/stop", () => {
    it("should start polling and become running", async () => {
      mockFs.readFileSync.mockReturnValue(makeArtifact());

      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.start();
      expect(poller.isRunning()).toBe(true);
      expect(cache.isReady()).toBe(true);

      poller.stop();
      expect(poller.isRunning()).toBe(false);
    });

    it("should call onError when poll fails", async () => {
      mockFs.readFileSync
        .mockReturnValueOnce(makeArtifact({ revision: "rev1" }))
        .mockImplementationOnce(() => {
          throw new Error("file gone");
        });

      const onError = jest.fn();
      const poller = new ArtifactPoller({
        source: "/path/to/artifact.json",
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 10,
        onError,
      });

      await poller.start();

      // Advance to trigger interval
      jest.advanceTimersByTime(10_000);
      // Wait for the async callback to settle
      await Promise.resolve();
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      poller.stop();
    });
  });
});
