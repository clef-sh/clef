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
});
