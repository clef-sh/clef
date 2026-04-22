import { resolveToken, resolveEndpoint } from "./auth";
import { ClefClientError } from "./types";

describe("resolveToken", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.CLEF_AGENT_TOKEN;
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it("returns explicit token", () => {
    expect(resolveToken("my-token")).toBe("my-token");
  });

  it("falls back to CLEF_AGENT_TOKEN env var", () => {
    process.env.CLEF_AGENT_TOKEN = "env-token";
    expect(resolveToken()).toBe("env-token");
  });

  it("prefers explicit over env var", () => {
    process.env.CLEF_AGENT_TOKEN = "env-token";
    expect(resolveToken("explicit")).toBe("explicit");
  });

  it("throws ClefClientError when no token available", () => {
    expect(() => resolveToken()).toThrow(ClefClientError);
    expect(() => resolveToken()).toThrow("No agent token configured");
  });
});

describe("resolveEndpoint", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.CLEF_ENDPOINT;
  });

  afterAll(() => {
    process.env = origEnv;
  });

  it("returns explicit endpoint", () => {
    expect(resolveEndpoint("http://custom:8080")).toBe("http://custom:8080");
  });

  it("falls back to CLEF_ENDPOINT env var", () => {
    process.env.CLEF_ENDPOINT = "http://env:9999";
    expect(resolveEndpoint()).toBe("http://env:9999");
  });

  it("defaults to localhost:7779", () => {
    expect(resolveEndpoint()).toBe("http://127.0.0.1:7779");
  });
});
