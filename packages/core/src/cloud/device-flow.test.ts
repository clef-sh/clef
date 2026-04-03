import { initiateDeviceFlow, pollDeviceFlow } from "./device-flow";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("initiateDeviceFlow", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should POST to /api/v1/device/init and return session", async () => {
    const session = {
      sessionId: "sess_abc",
      loginUrl: "https://cloud.clef.sh/setup?session=sess_abc",
      pollUrl: "https://api.clef.sh/api/v1/device/poll/sess_abc",
      expiresIn: 900,
    };
    mockFetch.mockResolvedValue(jsonResponse(200, session));

    const result = await initiateDeviceFlow("https://api.clef.sh", {
      repoName: "my-app",
      environment: "production",
      clientVersion: "0.1.11",
    });

    expect(result).toEqual(session);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.clef.sh/api/v1/device/init",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("my-app"),
      }),
    );
  });

  it("should use default endpoint when undefined", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { sessionId: "s", loginUrl: "u", pollUrl: "p", expiresIn: 900 }),
    );

    await initiateDeviceFlow(undefined, {
      repoName: "r",
      environment: "e",
      clientVersion: "v",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.clef.sh/api/v1/device/init",
      expect.anything(),
    );
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: "internal" }));

    await expect(
      initiateDeviceFlow("https://api.clef.sh", {
        repoName: "r",
        environment: "e",
        clientVersion: "v",
      }),
    ).rejects.toThrow("Device flow init failed (500)");
  });
});

describe("pollDeviceFlow", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should return pending status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: "pending" }));

    const result = await pollDeviceFlow("https://api.clef.sh/api/v1/device/poll/sess_abc");

    expect(result.status).toBe("pending");
  });

  it("should return complete with token and integration data", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        status: "complete",
        token: "clef_tok_abc",
        integrationId: "int_abc123",
        keyId: "clef:int_abc123/production",
      }),
    );

    const result = await pollDeviceFlow("https://api.clef.sh/api/v1/device/poll/sess_abc");

    expect(result.status).toBe("complete");
    expect(result.token).toBe("clef_tok_abc");
    expect(result.integrationId).toBe("int_abc123");
    expect(result.keyId).toBe("clef:int_abc123/production");
  });

  it("should return expired status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: "expired" }));

    const result = await pollDeviceFlow("https://api.clef.sh/api/v1/device/poll/sess_abc");

    expect(result.status).toBe("expired");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(429, "rate limited"));

    await expect(pollDeviceFlow("https://api.clef.sh/api/v1/device/poll/sess_abc")).rejects.toThrow(
      "Device flow poll failed (429)",
    );
  });
});
