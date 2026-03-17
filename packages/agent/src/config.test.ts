import { resolveConfig, ConfigError } from "./config";

describe("resolveConfig", () => {
  const baseEnv = {
    CLEF_AGENT_SOURCE: "https://bucket.s3.amazonaws.com/artifact.json",
    CLEF_AGENT_AGE_KEY: "AGE-SECRET-KEY-1TESTKEY",
  };

  it("should resolve with minimal required env vars", () => {
    const config = resolveConfig(baseEnv);

    expect(config.source).toBe("https://bucket.s3.amazonaws.com/artifact.json");
    expect(config.port).toBe(7779);
    expect(config.pollInterval).toBe(30);
    expect(config.ageKey).toBe("AGE-SECRET-KEY-1TESTKEY");
    expect(config.token).toBeTruthy();
  });

  it("should use custom port", () => {
    const config = resolveConfig({ ...baseEnv, CLEF_AGENT_PORT: "8080" });
    expect(config.port).toBe(8080);
  });

  it("should use custom poll interval", () => {
    const config = resolveConfig({ ...baseEnv, CLEF_AGENT_POLL_INTERVAL: "60" });
    expect(config.pollInterval).toBe(60);
  });

  it("should use custom token", () => {
    const config = resolveConfig({ ...baseEnv, CLEF_AGENT_TOKEN: "my-token" });
    expect(config.token).toBe("my-token");
  });

  it("should accept CLEF_AGENT_AGE_KEY_FILE instead of CLEF_AGENT_AGE_KEY", () => {
    const config = resolveConfig({
      CLEF_AGENT_SOURCE: "https://example.com/artifact.json",
      CLEF_AGENT_AGE_KEY_FILE: "/path/to/key.txt",
    });
    expect(config.ageKeyFile).toBe("/path/to/key.txt");
    expect(config.ageKey).toBeUndefined();
  });

  it("should throw ConfigError when CLEF_AGENT_SOURCE is missing", () => {
    expect(() => resolveConfig({ CLEF_AGENT_AGE_KEY: "key" })).toThrow(ConfigError);
    expect(() => resolveConfig({ CLEF_AGENT_AGE_KEY: "key" })).toThrow("CLEF_AGENT_SOURCE");
  });

  it("should throw ConfigError when neither age key is set", () => {
    expect(() => resolveConfig({ CLEF_AGENT_SOURCE: "https://example.com/a.json" })).toThrow(
      ConfigError,
    );
    expect(() => resolveConfig({ CLEF_AGENT_SOURCE: "https://example.com/a.json" })).toThrow(
      "CLEF_AGENT_AGE_KEY",
    );
  });

  it("should throw ConfigError for invalid port", () => {
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_PORT: "abc" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_PORT: "0" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_PORT: "99999" })).toThrow(ConfigError);
  });

  it("should throw ConfigError for invalid poll interval", () => {
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_POLL_INTERVAL: "abc" })).toThrow(
      ConfigError,
    );
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_POLL_INTERVAL: "0" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...baseEnv, CLEF_AGENT_POLL_INTERVAL: "-5" })).toThrow(
      ConfigError,
    );
  });

  it("should auto-generate token when not set", () => {
    const config1 = resolveConfig(baseEnv);
    const config2 = resolveConfig(baseEnv);
    // Each call generates a new random token
    expect(config1.token).toHaveLength(64); // 32 bytes hex
    expect(config2.token).toHaveLength(64);
  });
});
