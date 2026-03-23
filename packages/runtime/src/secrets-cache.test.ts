import { SecretsCache } from "./secrets-cache";

describe("SecretsCache", () => {
  let cache: SecretsCache;

  beforeEach(() => {
    cache = new SecretsCache();
  });

  it("should start as not ready", () => {
    expect(cache.isReady()).toBe(false);
    expect(cache.getAll()).toBeNull();
    expect(cache.getRevision()).toBeNull();
    expect(cache.getKeys()).toEqual([]);
  });

  it("should become ready after swap", () => {
    cache.swap({ KEY: "value" }, ["KEY"], "rev1");
    expect(cache.isReady()).toBe(true);
  });

  it("should return correct values after swap", () => {
    cache.swap({ DB_URL: "postgres://...", API_KEY: "secret" }, ["DB_URL", "API_KEY"], "rev1");

    expect(cache.get("DB_URL")).toBe("postgres://...");
    expect(cache.get("API_KEY")).toBe("secret");
    expect(cache.get("MISSING")).toBeUndefined();
  });

  it("should return all values as a copy", () => {
    const values = { A: "1", B: "2" };
    cache.swap(values, ["A", "B"], "rev1");

    const all = cache.getAll();
    expect(all).toEqual({ A: "1", B: "2" });

    // Verify it's a copy, not a reference
    if (all) {
      all.A = "mutated";
      expect(cache.get("A")).toBe("1");
    }
  });

  it("should return keys", () => {
    cache.swap({ X: "1", Y: "2" }, ["X", "Y"], "rev1");
    expect(cache.getKeys()).toEqual(["X", "Y"]);
  });

  it("should return keys as a copy", () => {
    cache.swap({ X: "1" }, ["X"], "rev1");
    const keys = cache.getKeys();
    keys.push("INJECTED");
    expect(cache.getKeys()).toEqual(["X"]);
  });

  it("should return revision", () => {
    cache.swap({}, [], "rev42");
    expect(cache.getRevision()).toBe("rev42");
  });

  it("should atomically swap to new values", () => {
    cache.swap({ OLD: "old" }, ["OLD"], "rev1");
    expect(cache.get("OLD")).toBe("old");

    cache.swap({ NEW: "new" }, ["NEW"], "rev2");
    expect(cache.get("OLD")).toBeUndefined();
    expect(cache.get("NEW")).toBe("new");
    expect(cache.getRevision()).toBe("rev2");
    expect(cache.getKeys()).toEqual(["NEW"]);
  });

  describe("isExpired", () => {
    it("should return false when snapshot is null (not loaded)", () => {
      expect(cache.isExpired(300)).toBe(false);
    });

    it("should return false when cache is fresh", () => {
      cache.swap({ K: "v" }, ["K"], "rev1");
      expect(cache.isExpired(300)).toBe(false);
    });

    it("should return true when cache exceeds TTL", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 400_000); // swap 400s ago
      cache.swap({ K: "v" }, ["K"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);
      expect(cache.isExpired(300)).toBe(true);
    });

    it("should return false when cache is exactly at TTL boundary", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 300_000); // swap exactly 300s ago
      cache.swap({ K: "v" }, ["K"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);
      // 300_000 / 1000 = 300, which is NOT > 300
      expect(cache.isExpired(300)).toBe(false);
    });
  });

  describe("wipe", () => {
    it("should reset cache to not ready", () => {
      cache.swap({ K: "v" }, ["K"], "rev1");
      expect(cache.isReady()).toBe(true);

      cache.wipe();
      expect(cache.isReady()).toBe(false);
      expect(cache.getAll()).toBeNull();
      expect(cache.getRevision()).toBeNull();
    });
  });

  describe("getSwappedAt", () => {
    it("should return null when not loaded", () => {
      expect(cache.getSwappedAt()).toBeNull();
    });

    it("should return timestamp after swap", () => {
      const before = Date.now();
      cache.swap({ K: "v" }, ["K"], "rev1");
      const after = Date.now();

      const swappedAt = cache.getSwappedAt();
      expect(swappedAt).toBeGreaterThanOrEqual(before);
      expect(swappedAt).toBeLessThanOrEqual(after);
    });

    it("should update on subsequent swaps", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now);
      cache.swap({ K: "v" }, ["K"], "rev1");
      expect(cache.getSwappedAt()).toBe(now);

      jest.spyOn(Date, "now").mockReturnValueOnce(now + 5000);
      cache.swap({ K: "v2" }, ["K"], "rev2");
      expect(cache.getSwappedAt()).toBe(now + 5000);
    });
  });
});
