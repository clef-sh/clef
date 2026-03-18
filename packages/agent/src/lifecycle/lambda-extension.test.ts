import { LambdaExtension } from "./lambda-extension";
import { ArtifactPoller } from "../poller";
import { AgentServerHandle } from "../server";

describe("LambdaExtension", () => {
  let mockPoller: jest.Mocked<Pick<ArtifactPoller, "fetchAndDecrypt" | "start" | "stop">>;
  let mockServer: jest.Mocked<AgentServerHandle>;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

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
      .mockReturnValueOnce(now) // initial
      .mockReturnValueOnce(now + 60_000); // 60s later

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
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 60_000);

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
