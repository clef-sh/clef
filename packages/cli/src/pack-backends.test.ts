import { createPackBackendRegistry, parseBackendOptions } from "./pack-backends";

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
