import { resolveConfig, ConfigError } from "./config";

function baseEnv(): Record<string, string> {
  return {
    CLEF_BROKER_IDENTITY: "rds-primary",
    CLEF_BROKER_ENVIRONMENT: "production",
    CLEF_BROKER_KMS_PROVIDER: "aws",
    CLEF_BROKER_KMS_KEY_ID: "arn:aws:kms:us-east-1:123456789:key/abc-123",
  };
}

describe("resolveConfig", () => {
  it("resolves with all required env vars", () => {
    const config = resolveConfig(baseEnv());
    expect(config.identity).toBe("rds-primary");
    expect(config.environment).toBe("production");
    expect(config.kmsProvider).toBe("aws");
    expect(config.kmsKeyId).toBe("arn:aws:kms:us-east-1:123456789:key/abc-123");
  });

  it("defaults port to 8080 and host to 127.0.0.1", () => {
    const config = resolveConfig(baseEnv());
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
  });

  it("accepts custom port and host", () => {
    const config = resolveConfig({
      ...baseEnv(),
      CLEF_BROKER_PORT: "3000",
      CLEF_BROKER_HOST: "127.0.0.1",
    });
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
  });

  it("accepts kmsRegion", () => {
    const config = resolveConfig({ ...baseEnv(), CLEF_BROKER_KMS_REGION: "eu-west-1" });
    expect(config.kmsRegion).toBe("eu-west-1");
  });

  it("throws ConfigError when identity is missing", () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).CLEF_BROKER_IDENTITY;
    expect(() => resolveConfig(env)).toThrow(ConfigError);
    expect(() => resolveConfig(env)).toThrow("CLEF_BROKER_IDENTITY is required");
  });

  it("throws ConfigError when environment is missing", () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).CLEF_BROKER_ENVIRONMENT;
    expect(() => resolveConfig(env)).toThrow(ConfigError);
    expect(() => resolveConfig(env)).toThrow("CLEF_BROKER_ENVIRONMENT is required");
  });

  it("throws ConfigError when kmsProvider is missing", () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).CLEF_BROKER_KMS_PROVIDER;
    expect(() => resolveConfig(env)).toThrow(ConfigError);
    expect(() => resolveConfig(env)).toThrow("CLEF_BROKER_KMS_PROVIDER is required");
  });

  it("throws ConfigError for invalid kmsProvider", () => {
    const env = { ...baseEnv(), CLEF_BROKER_KMS_PROVIDER: "oracle" };
    expect(() => resolveConfig(env)).toThrow(ConfigError);
    expect(() => resolveConfig(env)).toThrow("must be one of: aws, gcp, azure");
  });

  it("throws ConfigError when kmsKeyId is missing", () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).CLEF_BROKER_KMS_KEY_ID;
    expect(() => resolveConfig(env)).toThrow(ConfigError);
    expect(() => resolveConfig(env)).toThrow("CLEF_BROKER_KMS_KEY_ID is required");
  });

  it("throws ConfigError for invalid port", () => {
    expect(() => resolveConfig({ ...baseEnv(), CLEF_BROKER_PORT: "0" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...baseEnv(), CLEF_BROKER_PORT: "70000" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...baseEnv(), CLEF_BROKER_PORT: "abc" })).toThrow(ConfigError);
  });

  it("collects CLEF_BROKER_HANDLER_* vars with prefix stripped", () => {
    const config = resolveConfig({
      ...baseEnv(),
      CLEF_BROKER_HANDLER_DB_HOST: "rds.example.com",
      CLEF_BROKER_HANDLER_DB_PORT: "5432",
      CLEF_BROKER_HANDLER_DB_USER: "admin",
    });
    expect(config.handlerConfig).toEqual({
      DB_HOST: "rds.example.com",
      DB_PORT: "5432",
      DB_USER: "admin",
    });
  });

  it("returns empty handlerConfig when no handler vars exist", () => {
    const config = resolveConfig(baseEnv());
    expect(config.handlerConfig).toEqual({});
  });

  it("accepts gcp and azure as kmsProvider", () => {
    expect(resolveConfig({ ...baseEnv(), CLEF_BROKER_KMS_PROVIDER: "gcp" }).kmsProvider).toBe(
      "gcp",
    );
    expect(resolveConfig({ ...baseEnv(), CLEF_BROKER_KMS_PROVIDER: "azure" }).kmsProvider).toBe(
      "azure",
    );
  });
});
