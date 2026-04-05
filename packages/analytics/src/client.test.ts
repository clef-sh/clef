const mockCapture = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);
const MockPostHog = jest.fn().mockImplementation(() => ({
  capture: mockCapture,
  shutdown: mockShutdown,
}));

jest.mock("posthog-node", () => ({
  PostHog: MockPostHog,
}));

jest.mock("fs", () => ({
  readFileSync: jest.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
}));

// Each test gets a fresh module to reset the internal client/disabled state
function loadClient() {
  let mod: typeof import("./client");
  jest.isolateModules(() => {
    mod = require("./client");
  });
  return mod!;
}

describe("analytics client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CLEF_ANALYTICS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should call PostHog.capture with correct event shape", () => {
    const { track } = loadClient();

    track("cli_command", { command: "get", duration_ms: 150, success: true });

    expect(MockPostHog).toHaveBeenCalledWith(
      expect.any(String), // API key
      expect.objectContaining({ flushAt: 1, flushInterval: 0 }),
    );
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: expect.any(String),
        event: "cli_command",
        properties: expect.objectContaining({
          command: "get",
          duration_ms: 150,
          success: true,
          os: expect.any(String),
          arch: expect.any(String),
          nodeVersion: expect.any(String),
        }),
      }),
    );
  });

  it("should generate a stable anonymous distinctId", () => {
    const { track } = loadClient();

    track("event_1");
    track("event_2");

    const id1 = mockCapture.mock.calls[0][0].distinctId;
    const id2 = mockCapture.mock.calls[1][0].distinctId;
    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
  });

  it("should not create PostHog client when CLEF_ANALYTICS=0", () => {
    process.env.CLEF_ANALYTICS = "0";
    const { track } = loadClient();

    track("test_event");

    expect(MockPostHog).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("should not create PostHog client when CLEF_ANALYTICS=false", () => {
    process.env.CLEF_ANALYTICS = "false";
    const { track } = loadClient();

    track("test_event");

    expect(MockPostHog).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("should report disabled when opted out via env", () => {
    process.env.CLEF_ANALYTICS = "0";
    const { isDisabled } = loadClient();

    expect(isDisabled()).toBe(true);
  });

  it("should report enabled when no opt-out", () => {
    const { isDisabled } = loadClient();

    expect(isDisabled()).toBe(false);
  });

  it("should call PostHog.shutdown on shutdown", async () => {
    const { track, shutdown } = loadClient();

    track("test_event"); // creates the client
    await shutdown();

    expect(mockShutdown).toHaveBeenCalledWith(5000);
  });

  it("should not throw on shutdown when opted out (no client)", async () => {
    process.env.CLEF_ANALYTICS = "0";
    const { shutdown } = loadClient();

    await expect(shutdown()).resolves.toBeUndefined();
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("should only create one PostHog client across multiple track calls", () => {
    const { track } = loadClient();

    track("event_1");
    track("event_2");
    track("event_3");

    expect(MockPostHog).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledTimes(3);
  });

  it("should read opt-out from config file when env is not set", () => {
    const mockFs = require("fs") as { readFileSync: jest.Mock };
    mockFs.readFileSync.mockReturnValue("analytics: false\n");

    const { track } = loadClient();
    track("test_event");

    expect(MockPostHog).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
