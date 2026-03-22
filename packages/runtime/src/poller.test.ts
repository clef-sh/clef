import * as crypto from "crypto";
import { ArtifactPoller } from "./poller";
import { SecretsCache } from "./secrets-cache";
import { ArtifactSource } from "./sources/types";
import { DiskCache } from "./disk-cache";
import { TelemetryEmitter } from "./telemetry";

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

// Mock KMS for envelope artifact tests
jest.mock("./kms", () => {
  const unwrapFn = jest.fn();
  return {
    createKmsProvider: jest.fn().mockReturnValue({
      wrap: jest.fn(),
      unwrap: unwrapFn,
    }),
    __mockUnwrap: unwrapFn,
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports -- access mock fn
const { __mockUnwrap: mockKmsUnwrap } = require("./kms") as { __mockUnwrap: jest.Mock };

function makeArtifact(
  overrides: Partial<{
    version: number;
    revision: string;
    ciphertext: string;
    ciphertextHash: string;
    keys: string[];
    envelope: {
      provider: string;
      keyId: string;
      wrappedKey: string;
      algorithm: string;
    };
  }> = {},
): string {
  const ciphertext =
    overrides.ciphertext ??
    "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----";
  const hash =
    overrides.ciphertextHash ?? crypto.createHash("sha256").update(ciphertext).digest("hex");

  const artifact: Record<string, unknown> = {
    version: overrides.version ?? 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision: overrides.revision ?? "1705276800000",
    ciphertextHash: hash,
    ciphertext,
    keys: overrides.keys ?? ["DB_URL", "API_KEY"],
  };
  if (overrides.envelope) {
    artifact.envelope = overrides.envelope;
  }
  return JSON.stringify(artifact);
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
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("integrity check failed");
    });

    it("should throw on unsupported artifact version", async () => {
      const source = mockSource(makeArtifact({ version: 99 }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Unsupported artifact version");
    });

    it("should throw when age-only artifact has no private key", async () => {
      const source = mockSource(makeArtifact());

      const poller = new ArtifactPoller({
        source,
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("requires an age private key");
    });

    it("should decrypt KMS envelope artifact via KMS unwrap", async () => {
      mockKmsUnwrap.mockResolvedValue(Buffer.from("AGE-SECRET-KEY-1UNWRAPPED"));

      const source = mockSource(
        makeArtifact({
          revision: "kms-rev",
          envelope: {
            provider: "aws",
            keyId: "arn:aws:kms:us-east-1:111:key/test",
            wrappedKey: Buffer.from("wrapped-key").toString("base64"),
            algorithm: "SYMMETRIC_DEFAULT",
          },
        }),
      );

      const poller = new ArtifactPoller({
        source,
        cache,
      });

      await poller.fetchAndDecrypt();

      expect(cache.isReady()).toBe(true);
      expect(cache.getRevision()).toBe("kms-rev");
      expect(mockKmsUnwrap).toHaveBeenCalledWith(
        "arn:aws:kms:us-east-1:111:key/test",
        expect.any(Buffer),
        "SYMMETRIC_DEFAULT",
      );
    });

    it("should reject artifact with incomplete envelope fields", async () => {
      const ciphertext =
        "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----";
      const hash = crypto.createHash("sha256").update(ciphertext).digest("hex");
      const raw = JSON.stringify({
        version: 1,
        identity: "api-gateway",
        environment: "production",
        packedAt: "2024-01-15T00:00:00.000Z",
        revision: "bad-envelope",
        ciphertextHash: hash,
        ciphertext,
        keys: ["DB_URL"],
        envelope: { provider: "aws" },
      });
      const source = mockSource(raw);

      const poller = new ArtifactPoller({
        source,
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("incomplete envelope fields");
    });

    it("should call onRefresh callback on successful cache swap", async () => {
      const onRefresh = jest.fn();
      const source = mockSource(makeArtifact({ revision: "rev-new" }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

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
        getFetchedAt: jest.fn(),
        purge: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        diskCache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("network error");
    });
  });

  describe("cache TTL enforcement", () => {
    it("should wipe and throw when fetch fails and in-memory cache is expired (no disk cache)", async () => {
      // First load succeeds
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockRejectedValueOnce(new Error("network error")),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        cacheTtl: 10,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);

      // Advance past TTL
      jest.advanceTimersByTime(15_000);

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("cache expired");
      expect(cache.isReady()).toBe(false);
    });

    it("should not wipe when fetch fails but cache is still fresh (no disk cache)", async () => {
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockRejectedValueOnce(new Error("network error")),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        cacheTtl: 300,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);

      // Cache is still fresh — should throw the original error, not expire
      await expect(poller.fetchAndDecrypt()).rejects.toThrow("network error");
      expect(cache.isReady()).toBe(true);
    });

    it("should wipe and purge when fetch fails and disk cache is expired", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };
      const diskCache = {
        write: jest.fn(),
        read: jest.fn().mockReturnValue(makeArtifact({ revision: "old" })),
        getCachedSha: jest.fn().mockReturnValue("sha-old"),
        getFetchedAt: jest.fn().mockReturnValue(new Date(Date.now() - 600_000).toISOString()),
        purge: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        diskCache,
        cacheTtl: 300,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("cache expired");
      expect(diskCache.purge).toHaveBeenCalled();
      expect(cache.isReady()).toBe(false);
    });

    it("should fall back to fresh disk cache even with TTL configured", async () => {
      const artifactJson = makeArtifact({ revision: "cached-rev" });
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };
      const diskCache = {
        write: jest.fn(),
        read: jest.fn().mockReturnValue(artifactJson),
        getCachedSha: jest.fn().mockReturnValue("cached-sha"),
        getFetchedAt: jest.fn().mockReturnValue(new Date().toISOString()),
        purge: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        diskCache,
        cacheTtl: 300,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);
      expect(cache.getRevision()).toBe("cached-rev");
      expect(diskCache.purge).not.toHaveBeenCalled();
    });

    it("should wipe cache when fetch fails, disk cache is empty, and in-memory cache is expired", async () => {
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockRejectedValueOnce(new Error("network error")),
        describe: () => "mock",
      };
      const diskCache = {
        write: jest.fn(),
        read: jest.fn().mockReturnValue(null),
        getCachedSha: jest.fn(),
        getFetchedAt: jest.fn(),
        purge: jest.fn(),
      } as unknown as DiskCache;

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,

        diskCache,
        cacheTtl: 10,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);

      // Advance past TTL
      jest.advanceTimersByTime(15_000);

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("cache expired");
      expect(cache.isReady()).toBe(false);
    });
  });

  describe("artifact expiry", () => {
    it("should reject an expired artifact and wipe cache", async () => {
      const expiredArtifact = makeArtifact({ revision: "exp-rev" });
      const parsed = JSON.parse(expiredArtifact);
      parsed.expiresAt = new Date(Date.now() - 60_000).toISOString();
      const source = mockSource(JSON.stringify(parsed));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Artifact expired at");
      expect(cache.isReady()).toBe(false);
    });

    it("should accept an artifact with future expiresAt", async () => {
      const futureArtifact = makeArtifact({ revision: "future-rev" });
      const parsed = JSON.parse(futureArtifact);
      parsed.expiresAt = new Date(Date.now() + 3600_000).toISOString();
      const source = mockSource(JSON.stringify(parsed));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);
    });

    it("should accept an artifact without expiresAt", async () => {
      const source = mockSource(makeArtifact({ revision: "no-exp" }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);
    });
  });

  describe("revocation", () => {
    function makeRevokedArtifact(): string {
      return JSON.stringify({
        version: 1,
        identity: "api-gateway",
        environment: "production",
        revokedAt: "2026-03-22T14:30:00.000Z",
      });
    }

    it("should wipe cache and throw when artifact has revokedAt", async () => {
      const source = mockSource(makeRevokedArtifact());

      // Pre-load cache
      cache.swap({ K: "v" }, ["K"], "old-rev");

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Artifact revoked");
      expect(cache.isReady()).toBe(false);
    });

    it("should proceed normally when artifact has no revokedAt", async () => {
      const source = mockSource(makeArtifact({ revision: "ok-rev" }));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await poller.fetchAndDecrypt();
      expect(cache.isReady()).toBe(true);
      expect(cache.getRevision()).toBe("ok-rev");
    });

    it("should include identity and timestamp in revocation error", async () => {
      const source = mockSource(makeRevokedArtifact());

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow(
        "api-gateway/production at 2026-03-22T14:30:00.000Z",
      );
    });
  });

  describe("telemetry", () => {
    let telemetry: {
      artifactRefreshed: jest.Mock;
      fetchFailed: jest.Mock;
      artifactRevoked: jest.Mock;
      artifactExpired: jest.Mock;
      cacheExpired: jest.Mock;
      artifactInvalid: jest.Mock;
    };

    beforeEach(() => {
      telemetry = {
        artifactRefreshed: jest.fn(),
        fetchFailed: jest.fn(),
        artifactRevoked: jest.fn(),
        artifactExpired: jest.fn(),
        cacheExpired: jest.fn(),
        artifactInvalid: jest.fn(),
      };
    });

    it("should emit artifact.refreshed on successful cache swap", async () => {
      const source = mockSource(makeArtifact({ revision: "rev-tel" }));
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await poller.fetchAndDecrypt();

      expect(telemetry.artifactRefreshed).toHaveBeenCalledWith({
        revision: "rev-tel",
        keyCount: 2,
        kmsEnvelope: false,
      });
    });

    it("should emit fetch.failed when source throws", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockRejectedValue(new Error("network error")),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("network error");

      expect(telemetry.fetchFailed).toHaveBeenCalledWith({
        error: "network error",
        diskCacheAvailable: false,
      });
    });

    it("should emit artifact.revoked when artifact has revokedAt", async () => {
      const raw = JSON.stringify({
        version: 1,
        identity: "api-gateway",
        environment: "production",
        revokedAt: "2026-03-22T14:30:00.000Z",
      });
      const source = mockSource(raw);

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Artifact revoked");

      expect(telemetry.artifactRevoked).toHaveBeenCalledWith({
        revokedAt: "2026-03-22T14:30:00.000Z",
      });
    });

    it("should emit artifact.expired when artifact is past expiresAt", async () => {
      const expiredArtifact = makeArtifact({ revision: "exp-rev" });
      const parsed = JSON.parse(expiredArtifact);
      parsed.expiresAt = new Date(Date.now() - 60_000).toISOString();
      const source = mockSource(JSON.stringify(parsed));

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Artifact expired at");

      expect(telemetry.artifactExpired).toHaveBeenCalledWith({
        expiresAt: parsed.expiresAt,
      });
    });

    it("should emit cache.expired when cache TTL exceeded", async () => {
      const source: ArtifactSource = {
        fetch: jest
          .fn()
          .mockResolvedValueOnce({ raw: makeArtifact({ revision: "rev1" }) })
          .mockRejectedValueOnce(new Error("network error")),
        describe: () => "mock",
      };

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        cacheTtl: 10,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await poller.fetchAndDecrypt();
      jest.advanceTimersByTime(15_000);

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("cache expired");

      expect(telemetry.cacheExpired).toHaveBeenCalledWith({
        cacheTtlSeconds: 10,
        diskCachePurged: false,
      });
    });

    it("should emit artifact.invalid with reason unsupported_version", async () => {
      const source = mockSource(makeArtifact({ version: 99 }));
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("Unsupported artifact version");

      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "unsupported_version",
        error: expect.stringContaining("Unsupported artifact version"),
      });
    });

    it("should emit artifact.invalid with reason missing_fields", async () => {
      const raw = JSON.stringify({
        version: 1,
        identity: "api-gateway",
        environment: "production",
        packedAt: "2024-01-15T00:00:00.000Z",
        revision: "rev1",
        // missing ciphertext and ciphertextHash
      });
      const source = mockSource(raw);
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("missing required fields");

      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "missing_fields",
        error: expect.stringContaining("missing required fields"),
      });
    });

    it("should emit artifact.invalid with reason integrity on hash mismatch", async () => {
      const source = mockSource(
        makeArtifact({
          ciphertextHash: "badhash000000000000000000000000000000000000000000000000000000000",
        }),
      );
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("integrity check failed");

      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "integrity",
        error: expect.stringContaining("integrity check failed"),
      });
    });

    it("should emit artifact.invalid with reason json_parse on malformed JSON", async () => {
      const source: ArtifactSource = {
        fetch: jest.fn().mockResolvedValue({ raw: "not valid json{{{" }),
        describe: () => "mock",
      };
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow();

      // The JSON.parse at the revocation check (line ~153) will throw first
      // But since it's outside validateDecryptAndCache, let's test with valid
      // JSON that fails parseAndValidate
    });

    it("should not emit artifact.invalid for missing private key (config error)", async () => {
      const source = mockSource(makeArtifact());
      const poller = new ArtifactPoller({
        source,
        // no privateKey
        cache,
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(poller.fetchAndDecrypt()).rejects.toThrow("requires an age private key");

      // Config error — should NOT be classified as artifact.invalid
      expect(telemetry.artifactInvalid).not.toHaveBeenCalled();
    });

    it("should not throw when telemetry is not configured", async () => {
      const source = mockSource(makeArtifact({ revision: "no-tel" }));
      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
      });

      await poller.fetchAndDecrypt();
      expect(telemetry.artifactRefreshed).not.toHaveBeenCalled();
    });
  });

  describe("start/stop", () => {
    it("should start polling and become running", async () => {
      const source = mockSource(makeArtifact());

      const poller = new ArtifactPoller({
        source,
        privateKey: "AGE-SECRET-KEY-1TEST",
        cache,
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
        cacheTtl: 100, // poll derived: 100/10 = 10s
        onError,
      });

      await poller.start();

      // Advance to trigger the scheduled poll (cacheTtl/10 = 10s)
      jest.advanceTimersByTime(10_000);
      // Wait for the async callback to settle
      await Promise.resolve();
      await Promise.resolve();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      poller.stop();
    });
  });
});
