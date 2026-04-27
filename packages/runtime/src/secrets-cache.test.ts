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
    cache.swap({ app: { KEY: "value" } }, "rev1");
    expect(cache.isReady()).toBe(true);
  });

  it("should look up scoped values when given a namespace", () => {
    cache.swap({ database: { DB_URL: "postgres://...", API_KEY: "secret" } }, "rev1");

    expect(cache.get("DB_URL", "database")).toBe("postgres://...");
    expect(cache.get("API_KEY", "database")).toBe("secret");
    expect(cache.get("DB_URL", "missing")).toBeUndefined();
    expect(cache.get("MISSING", "database")).toBeUndefined();
  });

  it("should search across namespaces when no namespace is given (internal callers)", () => {
    cache.swap({ database: { DB_URL: "value" }, payments: { STRIPE_KEY: "k" } }, "rev1");

    expect(cache.get("DB_URL")).toBe("value");
    expect(cache.get("STRIPE_KEY")).toBe("k");
    expect(cache.get("MISSING")).toBeUndefined();
  });

  it("should return all values as a deep copy", () => {
    const values = { ns: { A: "1", B: "2" } };
    cache.swap(values, "rev1");

    const all = cache.getAll();
    expect(all).toEqual({ ns: { A: "1", B: "2" } });

    if (all) {
      all.ns.A = "mutated";
      expect(cache.get("A", "ns")).toBe("1");
    }
  });

  it("should return keys in flat <namespace>__<key> form", () => {
    cache.swap({ database: { X: "1" }, payments: { Y: "2" } }, "rev1");
    expect(cache.getKeys().sort()).toEqual(["database__X", "payments__Y"]);
  });

  it("should return keys as a copy", () => {
    cache.swap({ ns: { X: "1" } }, "rev1");
    const keys = cache.getKeys();
    keys.push("INJECTED");
    expect(cache.getKeys()).toEqual(["ns__X"]);
  });

  it("should return revision", () => {
    cache.swap({}, "rev42");
    expect(cache.getRevision()).toBe("rev42");
  });

  it("should atomically swap to new values", () => {
    cache.swap({ ns: { OLD: "old" } }, "rev1");
    expect(cache.get("OLD", "ns")).toBe("old");

    cache.swap({ ns: { NEW: "new" } }, "rev2");
    expect(cache.get("OLD", "ns")).toBeUndefined();
    expect(cache.get("NEW", "ns")).toBe("new");
    expect(cache.getRevision()).toBe("rev2");
    expect(cache.getKeys()).toEqual(["ns__NEW"]);
  });

  describe("isExpired", () => {
    it("should return false when snapshot is null (not loaded)", () => {
      expect(cache.isExpired(300)).toBe(false);
    });

    it("should return false when cache is fresh", () => {
      cache.swap({ ns: { K: "v" } }, "rev1");
      expect(cache.isExpired(300)).toBe(false);
    });

    it("should return true when cache exceeds TTL", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 400_000);
      cache.swap({ ns: { K: "v" } }, "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);
      expect(cache.isExpired(300)).toBe(true);
    });

    it("should return false when cache is exactly at TTL boundary", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 300_000);
      cache.swap({ ns: { K: "v" } }, "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);
      expect(cache.isExpired(300)).toBe(false);
    });
  });

  describe("wipe", () => {
    it("should reset cache to not ready", () => {
      cache.swap({ ns: { K: "v" } }, "rev1");
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
      cache.swap({ ns: { K: "v" } }, "rev1");
      const after = Date.now();

      const swappedAt = cache.getSwappedAt();
      expect(swappedAt).toBeGreaterThanOrEqual(before);
      expect(swappedAt).toBeLessThanOrEqual(after);
    });

    it("should update on subsequent swaps", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now);
      cache.swap({ ns: { K: "v" } }, "rev1");
      expect(cache.getSwappedAt()).toBe(now);

      jest.spyOn(Date, "now").mockReturnValueOnce(now + 5000);
      cache.swap({ ns: { K: "v2" } }, "rev2");
      expect(cache.getSwappedAt()).toBe(now + 5000);
    });
  });
});
