import { resolveConfig, ConfigError } from "./config";

describe("resolveConfig", () => {
  const baseEnv = {
    CLEF_AGENT_SOURCE: "https://bucket.s3.amazonaws.com/artifact.json",
    CLEF_AGENT_AGE_KEY: "AGE-SECRET-KEY-1TESTKEY",
  };

  it("should resolve with minimal required env vars (source)", () => {
    const config = resolveConfig(baseEnv);

    expect(config.source).toBe("https://bucket.s3.amazonaws.com/artifact.json");
    expect(config.port).toBe(7779);
    expect(config.pollInterval).toBe(30);
    expect(config.ageKey).toBe("AGE-SECRET-KEY-1TESTKEY");
    expect(config.token).toBeTruthy();
    expect(config.vcs).toBeUndefined();
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

  it("should throw ConfigError when neither source nor VCS is set", () => {
    expect(() => resolveConfig({ CLEF_AGENT_AGE_KEY: "key" })).toThrow(ConfigError);
    expect(() => resolveConfig({ CLEF_AGENT_AGE_KEY: "key" })).toThrow(
      "Either CLEF_AGENT_SOURCE or VCS configuration",
    );
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

  describe("VCS configuration", () => {
    const vcsEnv = {
      CLEF_AGENT_VCS_PROVIDER: "github",
      CLEF_AGENT_VCS_REPO: "org/secrets",
      CLEF_AGENT_VCS_TOKEN: "ghp_test123",
      CLEF_AGENT_VCS_IDENTITY: "api-gateway",
      CLEF_AGENT_VCS_ENVIRONMENT: "production",
      CLEF_AGENT_AGE_KEY: "AGE-SECRET-KEY-1TESTKEY",
    };

    it("should resolve VCS config from env vars", () => {
      const config = resolveConfig(vcsEnv);

      expect(config.vcs).toEqual({
        provider: "github",
        repo: "org/secrets",
        token: "ghp_test123",
        identity: "api-gateway",
        environment: "production",
        ref: undefined,
        apiUrl: undefined,
      });
      expect(config.source).toBeUndefined();
    });

    it("should include optional VCS fields", () => {
      const config = resolveConfig({
        ...vcsEnv,
        CLEF_AGENT_VCS_REF: "v1.0.0",
        CLEF_AGENT_VCS_API_URL: "https://github.corp.com/api/v3",
      });

      expect(config.vcs?.ref).toBe("v1.0.0");
      expect(config.vcs?.apiUrl).toBe("https://github.corp.com/api/v3");
    });

    it("should resolve cachePath", () => {
      const config = resolveConfig({
        ...vcsEnv,
        CLEF_AGENT_CACHE_PATH: "/var/cache/clef",
      });

      expect(config.cachePath).toBe("/var/cache/clef");
    });

    it("should allow both source and VCS to coexist", () => {
      const config = resolveConfig({
        ...vcsEnv,
        CLEF_AGENT_SOURCE: "https://fallback.example.com/a.json",
      });

      expect(config.source).toBe("https://fallback.example.com/a.json");
      expect(config.vcs).toBeDefined();
    });

    it("should throw when partial VCS config is provided", () => {
      expect(() =>
        resolveConfig({
          CLEF_AGENT_VCS_PROVIDER: "github",
          CLEF_AGENT_AGE_KEY: "AGE-SECRET-KEY-1TESTKEY",
        }),
      ).toThrow(ConfigError);
      expect(() =>
        resolveConfig({
          CLEF_AGENT_VCS_PROVIDER: "github",
          CLEF_AGENT_AGE_KEY: "AGE-SECRET-KEY-1TESTKEY",
        }),
      ).toThrow("CLEF_AGENT_VCS_REPO");
    });

    it("should throw for invalid VCS provider", () => {
      expect(() =>
        resolveConfig({
          ...vcsEnv,
          CLEF_AGENT_VCS_PROVIDER: "svn",
        }),
      ).toThrow(ConfigError);
      expect(() =>
        resolveConfig({
          ...vcsEnv,
          CLEF_AGENT_VCS_PROVIDER: "svn",
        }),
      ).toThrow("Invalid CLEF_AGENT_VCS_PROVIDER");
    });

    it("should accept gitlab as VCS provider", () => {
      const config = resolveConfig({
        ...vcsEnv,
        CLEF_AGENT_VCS_PROVIDER: "gitlab",
      });
      expect(config.vcs?.provider).toBe("gitlab");
    });

    it("should accept bitbucket as VCS provider", () => {
      const config = resolveConfig({
        ...vcsEnv,
        CLEF_AGENT_VCS_PROVIDER: "bitbucket",
      });
      expect(config.vcs?.provider).toBe("bitbucket");
    });
  });
});
