export const resolveConfig = jest.fn().mockReturnValue({
  source: "https://example.com/artifact.json",
  port: 7779,
  pollInterval: 30,
  ageKey: "AGE-SECRET-KEY-1MOCKKEY",
  token: "mock-token",
});

export const SecretsCache = jest.fn().mockImplementation(() => ({
  swap: jest.fn(),
  get: jest.fn(),
  getAll: jest.fn(),
  getKeys: jest.fn().mockReturnValue([]),
  getRevision: jest.fn().mockReturnValue(null),
  isReady: jest.fn().mockReturnValue(false),
}));

export const AgeDecryptor = jest.fn().mockImplementation(() => ({
  decrypt: jest.fn().mockResolvedValue("{}"),
  resolveKey: jest.fn().mockReturnValue("AGE-SECRET-KEY-1MOCKKEY"),
}));

export const ArtifactPoller = jest.fn().mockImplementation(() => ({
  fetchAndDecrypt: jest.fn().mockResolvedValue(undefined),
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  isRunning: jest.fn().mockReturnValue(false),
}));

export const startAgentServer = jest.fn().mockResolvedValue({
  url: "http://127.0.0.1:7779",
  stop: jest.fn().mockResolvedValue(undefined),
});

export const Daemon = jest.fn().mockImplementation(() => ({
  start: jest.fn().mockResolvedValue(undefined),
}));

export const ConfigError = class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
};

export const LambdaExtension = jest.fn();
export const healthHandler = jest.fn();
export const readyHandler = jest.fn();
