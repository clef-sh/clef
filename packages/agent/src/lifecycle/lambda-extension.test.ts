import { LambdaExtension } from "./lambda-extension";
import { ArtifactPoller } from "@clef-sh/runtime";
import { AgentServerHandle } from "../server";

describe("LambdaExtension", () => {
  let mockPoller: jest.Mocked<Pick<ArtifactPoller, "fetchAndDecrypt" | "start" | "stop">>;
  let mockServer: jest.Mocked<AgentServerHandle>;
  let mockFetch: jest.Mock;
  let originalRuntimeApi: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();

    originalRuntimeApi = process.env.AWS_LAMBDA_RUNTIME_API;
    process.env.AWS_LAMBDA_RUNTIME_API = "127.0.0.1:9001";

    mockPoller = {
      fetchAndDecrypt: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
    };

    mockServer = {
      url: "http://127.0.0.1:7779",
      stop: jest.fn().mockResolvedValue(undefined),
      address: jest.fn().mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 7779 }),
    };

    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    if (originalRuntimeApi === undefined) {
      delete process.env.AWS_LAMBDA_RUNTIME_API;
    } else {
      process.env.AWS_LAMBDA_RUNTIME_API = originalRuntimeApi;
    }
  });

  it("should register with the Extensions API", async () => {
    // Mock register response
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([["Lambda-Extension-Identifier", "ext-123"]]),
      })
      // Mock first INVOKE event
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    // Override headers.get for the register response
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (key: string) => (key === "Lambda-Extension-Identifier" ? "ext-123" : null),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    const onLog = jest.fn();
    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
      onLog,
    });

    await ext.start();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9001/2020-01-01/extension/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockPoller.fetchAndDecrypt).toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("Registered"));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("SHUTDOWN"));
  });

  it("should refresh on INVOKE when TTL expired", async () => {
    const now = Date.now();
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(now) // constructor startedAt
      .mockReturnValueOnce(now) // initial lastRefresh
      .mockReturnValueOnce(now + 60_000) // elapsed check on INVOKE
      .mockReturnValueOnce(now + 60_000) // lastRefresh update after refresh
      .mockReturnValueOnce(now + 60_000); // shutdown uptimeSeconds

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "ext-123" },
      })
      // First event: INVOKE
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "INVOKE" }),
      })
      // Second event: SHUTDOWN
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
      onLog: jest.fn(),
    });

    await ext.start();

    // Initial fetch + refresh on INVOKE = 2 calls
    expect(mockPoller.fetchAndDecrypt).toHaveBeenCalledTimes(2);
  });

  it("should not refresh on INVOKE when TTL not expired", async () => {
    const now = Date.now();
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(now) // initial
      .mockReturnValueOnce(now + 5_000); // Only 5s later

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "ext-123" },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "INVOKE" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
      onLog: jest.fn(),
    });

    await ext.start();

    // Only the initial fetch, no refresh
    expect(mockPoller.fetchAndDecrypt).toHaveBeenCalledTimes(1);
  });

  it("should throw if registration fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
    });

    await expect(ext.start()).rejects.toThrow("register failed");
  });

  it("should use AWS_LAMBDA_RUNTIME_API from env instead of hardcoded host", async () => {
    process.env.AWS_LAMBDA_RUNTIME_API = "169.254.100.1:4242";

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "ext-123" },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
      onLog: jest.fn(),
    });

    await ext.start();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://169.254.100.1:4242/2020-01-01/extension/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "http://169.254.100.1:4242/2020-01-01/extension/event/next",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should throw a clear error if AWS_LAMBDA_RUNTIME_API is unset", async () => {
    delete process.env.AWS_LAMBDA_RUNTIME_API;

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
    });

    await expect(ext.start()).rejects.toThrow(/AWS_LAMBDA_RUNTIME_API is not set/);
  });

  it("should throw if no extension ID returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
    });

    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
    });

    await expect(ext.start()).rejects.toThrow("extension ID");
  });

  it("should handle refresh error gracefully on INVOKE", async () => {
    const now = Date.now();
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(now) // constructor startedAt
      .mockReturnValueOnce(now) // initial lastRefresh
      .mockReturnValueOnce(now + 60_000) // elapsed check on INVOKE
      .mockReturnValueOnce(now + 60_000); // shutdown uptimeSeconds

    mockPoller.fetchAndDecrypt
      .mockResolvedValueOnce(undefined) // initial OK
      .mockRejectedValueOnce(new Error("network down")); // refresh fails

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "ext-123" },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "INVOKE" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eventType: "SHUTDOWN" }),
      });

    const onLog = jest.fn();
    const ext = new LambdaExtension({
      poller: mockPoller as unknown as ArtifactPoller,
      server: mockServer,
      refreshTtl: 30,
      onLog,
    });

    // Should not throw — error is logged
    await ext.start();

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("Refresh failed"));
  });
});
