import { ClefClient } from "./clef-client";
import { ClefClientError } from "./types";

function mockFetch(secrets: Record<string, string>): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => secrets,
  } as Response);
}

function makeClient(
  overrides?: Partial<{
    fetch: jest.Mock;
    token: string;
    cacheTtlMs: number;
    envFallback: boolean;
  }>,
) {
  return new ClefClient({
    endpoint: "http://127.0.0.1:7779",
    token: overrides?.token ?? "test-token",
    fetch: overrides?.fetch ?? mockFetch({}),
    cacheTtlMs: overrides?.cacheTtlMs ?? 0,
    envFallback: overrides?.envFallback ?? true,
  });
}

describe("ClefClient", () => {
  describe("get", () => {
    it("returns a secret by key", async () => {
      const fetch = mockFetch({ DB_URL: "postgres://localhost", API_KEY: "sk-123" });
      const client = makeClient({ fetch });
      expect(await client.get("DB_URL")).toBe("postgres://localhost");
    });

    it("returns undefined for missing key", async () => {
      const fetch = mockFetch({ DB_URL: "postgres://localhost" });
      const client = makeClient({ fetch, envFallback: false });
      expect(await client.get("MISSING")).toBeUndefined();
    });

    it("falls back to process.env when key not found", async () => {
      process.env.FALLBACK_KEY = "from-env";
      const fetch = mockFetch({});
      const client = makeClient({ fetch });
      expect(await client.get("FALLBACK_KEY")).toBe("from-env");
      delete process.env.FALLBACK_KEY;
    });

    it("does not fall back when envFallback is false", async () => {
      process.env.NO_FALLBACK = "from-env";
      const fetch = mockFetch({});
      const client = makeClient({ fetch, envFallback: false });
      expect(await client.get("NO_FALLBACK")).toBeUndefined();
      delete process.env.NO_FALLBACK;
    });
  });

  describe("getAll", () => {
    it("returns all secrets", async () => {
      const secrets = { DB_URL: "pg://...", API_KEY: "sk-123" };
      const fetch = mockFetch(secrets);
      const client = makeClient({ fetch });
      expect(await client.getAll()).toEqual(secrets);
    });
  });

  describe("keys", () => {
    it("returns key names", async () => {
      const fetch = mockFetch({ A: "1", B: "2", C: "3" });
      const client = makeClient({ fetch });
      expect(await client.keys()).toEqual(["A", "B", "C"]);
    });
  });

  describe("health", () => {
    it("returns true when endpoint is reachable", async () => {
      const fetch = jest.fn().mockResolvedValue({ ok: true } as Response);
      const client = makeClient({ fetch });
      expect(await client.health()).toBe(true);
    });

    it("returns false when endpoint is unreachable", async () => {
      const fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const client = makeClient({ fetch });
      expect(await client.health()).toBe(false);
    });
  });

  describe("caching", () => {
    it("caches results for cacheTtlMs", async () => {
      const fetch = mockFetch({ KEY: "value" });
      const client = makeClient({ fetch, cacheTtlMs: 5000 });

      await client.get("KEY");
      await client.get("KEY");
      await client.get("KEY");

      // Only one fetch call — rest served from cache
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("does not cache when cacheTtlMs is 0", async () => {
      const fetch = mockFetch({ KEY: "value" });
      const client = makeClient({ fetch, cacheTtlMs: 0 });

      await client.get("KEY");
      await client.get("KEY");

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("refetches after cache expires", async () => {
      const fetch = mockFetch({ KEY: "value" });
      const client = makeClient({ fetch, cacheTtlMs: 100 });

      await client.get("KEY");
      expect(fetch).toHaveBeenCalledTimes(1);

      // Fast-forward past TTL
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now + 200);

      await client.get("KEY");
      expect(fetch).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });
  });

  describe("errors", () => {
    it("throws on missing token", () => {
      expect(() => new ClefClient({ endpoint: "http://localhost", envFallback: false })).toThrow(
        ClefClientError,
      );
    });
  });
});
