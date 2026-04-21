import { createPackBackendRegistry } from "./pack-backends";

describe("createPackBackendRegistry", () => {
  it("registers json-envelope by default", async () => {
    const registry = createPackBackendRegistry();
    expect(registry.has("json-envelope")).toBe(true);
    const backend = await registry.resolve("json-envelope");
    expect(backend.id).toBe("json-envelope");
  });

  it("does not register any backends beyond json-envelope", () => {
    const registry = createPackBackendRegistry();
    expect(registry.list()).toEqual(["json-envelope"]);
  });

  it("returns a fresh registry per call", () => {
    const a = createPackBackendRegistry();
    const b = createPackBackendRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toEqual(b.list());
  });
});
