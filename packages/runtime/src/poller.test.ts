import * as crypto from "crypto";
import { ArtifactPoller } from "./poller";
import { SecretsCache } from "./secrets-cache";
import { ArtifactSource } from "./sources/types";
import { DiskCache } from "./disk-cache";

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

function mockSource(raw: string, contentHash?: string): ArtifactSource {
  return {
    fetch: jest.fn().mockResolvedValue({ raw, contentHash }),
    describe: () => "mock source",
  };
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
    it("should fetch from source and populate cache", async () => {
      const source = mockSource(makeArtifact());

      const poller = new ArtifactPoller({
        source,
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

    it("should skip when contentHash is unchanged", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockResolvedValue({ raw: makeArtifact(), contentHash: "hash1" }),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);

      const swapSpy = jest.spyOn(cache, "swap");
      await poller.fetchAndDecrypt();
      expect(swapSpy).not.toHaveBeenCalled();
    });

    it("should skip when revision is unchanged (no contentHash)", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockResolvedValue({ raw: makeArtifact({ revision: "rev1" }) }),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();
      const swapSpy = jest.spyOn(cache, "swap");
      await poller.fetchAndDecrypt();
      expect(swapSpy).not.toHaveBeenCalled();
    });

    it("should update cache when revision changes", async () => {
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev2" }) }),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await poller.fetchAndDecrypt();
      expect(cache.getRevision()).toBe("rev1");

      await poller.fetchAndDecrypt();
      expect(cache.getRevision()).toBe("rev2");
    });

    it("should throw on integrity check failure", async () => {
      const source = mockSource(
        makeArtifact({
          ciphertextHash: "badhash000000000000000000000000000000000000000000000000000000000",
        }),
      );

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("integrity check failed");
    });

    it("should throw on unsupported artifact version", async () => {
      const source = mockSource(makeArtifact({ version: 99 }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Unsupported artifact version");
    });

    it("should call onRefresh callback on successful cache swap", async () => {
      const onRefresh = jest.fn();
      const source = mockSource(makeArtifact({ revision: "rev-new" }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
        onRefresh,
      });

      await poller.fetchAndDecrypt();
      expect(onRefresh).toHaveBeenCalledWith("rev-new");
    });
  });

  describe("disk cache integration", () => {
    it("should write to disk cache on successful fetch", async () => {
      const artifactJson = makeArtifact();
      const source = mockSource(artifactJson, "sha123");
      const diskCache = {
        write: jest.fn(),
        read: jest.fn(),
        getCachedSha: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
        diskCache,
      });

      await poller.fetchAndDecrypt();
      expect(diskCache.write).toHaveBeenCalledWith(artifactJson, "sha123");
    });

    it("should fall back to disk cache when fetch fails", async () => {
      const artifactJson = makeArtifact({ revision: "cached-rev" });
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };
      const diskCache = {
        write: jest.fn(),
        read: jest.fn().mockReturnValue(artifactJson),
        getCachedSha: jest.fn().mockReturnValue("cached-sha"),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
        diskCache,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);
      expect(cache.getRevision()).toBe("cached-rev");
    });

    it("should throw when fetch fails and no disk cache", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("network error");
    });

    it("should throw when fetch fails and disk cache is empty", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };
      const diskCache = {
        write: jest.fn(),
        read: jest.fn().mockReturnValue(null),
        getCachedSha: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        pollInterval: 30,
        diskCache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("network error");
    });
  });

  describe("start/stop", () => {
    it("should start polling and become running", async () => {
      const source = mockSource(makeArtifact());

      const poller = new ArtifactPoller({
        source,
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
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockRejectedValueOnce(new Error("poll failed")),
        describe: () => "mock",
      };

      const onError = jest.fn();
      const poller = new ArtifactPoller({
        source,
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
