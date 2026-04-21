import { PackBackendRegistry } from "./registry";
import type { PackBackend } from "./types";

function stubBackend(id: string): PackBackend {
  return {
    id,
    description: `stub backend ${id}`,
    async pack() {
      throw new Error("not implemented");
    },
  };
}

describe("PackBackendRegistry", () => {
  it("registers and resolves a backend", async () => {
    const reg = new PackBackendRegistry();
    reg.register("stub", () => stubBackend("stub"));
    expect(reg.has("stub")).toBe(true);
    const backend = await reg.resolve("stub");
    expect(backend.id).toBe("stub");
  });

  it("lists backends in registration order", () => {
    const reg = new PackBackendRegistry();
    reg.register("a", () => stubBackend("a"));
    reg.register("b", () => stubBackend("b"));
    reg.register("c", () => stubBackend("c"));
    expect(reg.list()).toEqual(["a", "b", "c"]);
  });

  it("throws when registering a duplicate id", () => {
    const reg = new PackBackendRegistry();
    reg.register("stub", () => stubBackend("stub"));
    expect(() => reg.register("stub", () => stubBackend("stub"))).toThrow(/already registered/);
  });

  it("returns false from has() for an unknown id", () => {
    const reg = new PackBackendRegistry();
    expect(reg.has("nope")).toBe(false);
  });

  it("throws a helpful error when resolving an unknown id", async () => {
    const reg = new PackBackendRegistry();
    reg.register("one", () => stubBackend("one"));
    reg.register("two", () => stubBackend("two"));
    await expect(reg.resolve("missing")).rejects.toThrow(
      /Unknown pack backend "missing"\. Available backends: one, two/,
    );
  });

  it("lists '(none)' in the error when the registry is empty", async () => {
    const reg = new PackBackendRegistry();
    await expect(reg.resolve("anything")).rejects.toThrow(/\(none\)/);
  });

  it("supports async factories", async () => {
    const reg = new PackBackendRegistry();
    reg.register("async", async () => stubBackend("async"));
    const backend = await reg.resolve("async");
    expect(backend.id).toBe("async");
  });

  it("supports sync factories (resolve awaits uniformly)", async () => {
    const reg = new PackBackendRegistry();
    reg.register("sync", () => stubBackend("sync"));
    const backend = await reg.resolve("sync");
    expect(backend.id).toBe("sync");
  });
});
