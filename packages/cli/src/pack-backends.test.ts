import { PackBackendRegistry } from "@clef-sh/core";
import { createPackBackendRegistry, parseBackendOptions, resolveBackend } from "./pack-backends";

jest.mock(
  "@clef-sh/pack-happy-path",
  () => ({
    default: {
      id: "happy-path",
      description: "test fixture",
      async pack() {
        throw new Error("not used");
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  "clef-pack-community-only",
  () => ({
    default: {
      id: "community-only",
      description: "community-prefix fixture",
      async pack() {
        throw new Error("not used");
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  "@acme/custom-pack-name",
  () => ({
    default: {
      id: "custom",
      description: "verbatim package-name fixture",
      async pack() {
        throw new Error("not used");
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  "@clef-sh/pack-invalid-shape",
  () => ({
    default: { something: "not a backend" },
  }),
  { virtual: true },
);

jest.mock(
  "@clef-sh/pack-throws-at-import",
  () => {
    throw new Error("boom — plugin failed to initialise");
  },
  { virtual: true },
);

describe("createPackBackendRegistry", () => {
  it("registers json-envelope by default", async () => {
    const registry = createPackBackendRegistry();
    expect(registry.has("json-envelope")).toBe(true);
    const backend = await registry.resolve("json-envelope");
    expect(backend.id).toBe("json-envelope");
  });

  it("registers the bundled official AWS pack plugins", async () => {
    const registry = createPackBackendRegistry();
    expect(registry.has("aws-parameter-store")).toBe(true);
    expect(registry.has("aws-secrets-manager")).toBe(true);
    const ps = await registry.resolve("aws-parameter-store");
    expect(ps.id).toBe("aws-parameter-store");
    const sm = await registry.resolve("aws-secrets-manager");
    expect(sm.id).toBe("aws-secrets-manager");
  });

  it("does not register backends beyond the bundled set", () => {
    const registry = createPackBackendRegistry();
    expect(registry.list().sort()).toEqual(
      ["aws-parameter-store", "aws-secrets-manager", "json-envelope"].sort(),
    );
  });

  it("returns a fresh registry per call", () => {
    const a = createPackBackendRegistry();
    const b = createPackBackendRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toEqual(b.list());
  });
});

describe("parseBackendOptions", () => {
  it("returns an empty object for no input", () => {
    expect(parseBackendOptions([])).toEqual({});
  });

  it("parses a single key=value pair", () => {
    expect(parseBackendOptions(["path=secret/app"])).toEqual({ path: "secret/app" });
  });

  it("parses multiple key=value pairs", () => {
    expect(parseBackendOptions(["path=secret/app", "namespace=team-a", "mount=kv2"])).toEqual({
      path: "secret/app",
      namespace: "team-a",
      mount: "kv2",
    });
  });

  it("preserves '=' in values (only splits on the first one)", () => {
    expect(parseBackendOptions(["token=abc==def"])).toEqual({ token: "abc==def" });
    expect(parseBackendOptions(["query=a=1&b=2"])).toEqual({ query: "a=1&b=2" });
  });

  it("preserves ':' and other special characters in values", () => {
    expect(parseBackendOptions(["arn=arn:aws:kms:us-east-1:123:key/abc"])).toEqual({
      arn: "arn:aws:kms:us-east-1:123:key/abc",
    });
  });

  it("accepts empty values", () => {
    expect(parseBackendOptions(["flag="])).toEqual({ flag: "" });
  });

  it("throws on input without '='", () => {
    expect(() => parseBackendOptions(["not-a-kv-pair"])).toThrow(
      /Invalid --backend-opt format: 'not-a-kv-pair'/,
    );
  });

  it("throws on empty key", () => {
    expect(() => parseBackendOptions(["=value"])).toThrow(/Key must not be empty/);
  });

  it("throws on duplicate keys", () => {
    expect(() => parseBackendOptions(["path=a", "path=b"])).toThrow(
      /Duplicate --backend-opt key: 'path'/,
    );
  });

  it("uses hasOwnProperty check so inherited object properties don't false-trigger duplicate detection", () => {
    // Without hasOwnProperty, the first `--backend-opt constructor=x` would
    // throw 'Duplicate' because `{}.constructor` is inherited from Object.prototype.
    expect(() => parseBackendOptions(["constructor=x"])).not.toThrow();
  });
});

describe("resolveBackend", () => {
  function emptyRegistry(): PackBackendRegistry {
    return new PackBackendRegistry();
  }

  it("resolves a built-in backend via the registry first", async () => {
    const registry = createPackBackendRegistry();
    const backend = await resolveBackend(registry, "json-envelope");
    expect(backend.id).toBe("json-envelope");
  });

  it("resolves the @clef-sh/pack-<id> official-prefix plugin", async () => {
    const backend = await resolveBackend(emptyRegistry(), "happy-path");
    expect(backend.id).toBe("happy-path");
  });

  it("resolves the clef-pack-<id> community-prefix plugin", async () => {
    const backend = await resolveBackend(emptyRegistry(), "community-only");
    expect(backend.id).toBe("community-only");
  });

  it("resolves a verbatim package name when it starts with @", async () => {
    const backend = await resolveBackend(emptyRegistry(), "@acme/custom-pack-name");
    expect(backend.id).toBe("custom");
  });

  it("rejects a plugin whose default export is not a valid PackBackend", async () => {
    await expect(resolveBackend(emptyRegistry(), "invalid-shape")).rejects.toThrow(
      /does not export a valid PackBackend/,
    );
  });

  it("surfaces real plugin-side errors (does not treat them as not-installed)", async () => {
    await expect(resolveBackend(emptyRegistry(), "throws-at-import")).rejects.toThrow(
      /boom — plugin failed to initialise/,
    );
  });

  it("gives a clear install hint when no plugin is found", async () => {
    const registry = createPackBackendRegistry();
    const promise = resolveBackend(registry, "nowhere-to-be-found");
    await expect(promise).rejects.toThrow(/Unknown pack backend "nowhere-to-be-found"/);
    await expect(promise).rejects.toThrow(
      /npm install --save-dev @clef-sh\/pack-nowhere-to-be-found/,
    );
    await expect(promise).rejects.toThrow(/npm install --save-dev clef-pack-nowhere-to-be-found/);
    await expect(promise).rejects.toThrow(/Built-in backends: json-envelope/);
  });
});
