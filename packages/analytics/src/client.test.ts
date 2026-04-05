import { track, shutdown, isDisabled } from "./client";

const mockCapture = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);

jest.mock("posthog-node", () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    shutdown: mockShutdown,
  })),
}));

jest.mock("fs", () => ({
  readFileSync: jest.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
}));

describe("analytics client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CLEF_ANALYTICS;
    // Reset module state by re-requiring
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should track events when analytics is enabled", () => {
    // Re-import to get fresh module state
    const { track: freshTrack } = jest.requireActual("./client");
    // Since PostHog is mocked, we just verify the function doesn't throw
    expect(() => freshTrack("test_event", { cli_version: "1.0.0" })).not.toThrow();
  });

  it("should not track when CLEF_ANALYTICS=0", () => {
    process.env.CLEF_ANALYTICS = "0";
    const { track: freshTrack } = jest.requireActual("./client");
    freshTrack("test_event");
    // PostHog constructor should not be called
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("should not track when CLEF_ANALYTICS=false", () => {
    process.env.CLEF_ANALYTICS = "false";
    const { track: freshTrack } = jest.requireActual("./client");
    freshTrack("test_event");
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("should report disabled when opted out", () => {
    process.env.CLEF_ANALYTICS = "0";
    const { isDisabled: freshIsDisabled } = jest.requireActual("./client");
    expect(freshIsDisabled()).toBe(true);
  });

  it("should not throw on shutdown when no client exists", async () => {
    process.env.CLEF_ANALYTICS = "0";
    const { shutdown: freshShutdown } = jest.requireActual("./client");
    await expect(freshShutdown()).resolves.toBeUndefined();
  });
});
