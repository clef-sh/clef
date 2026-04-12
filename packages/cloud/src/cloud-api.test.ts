import { startInstall, pollInstall, getMe } from "./cloud-api";

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

describe("startInstall", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should POST to /api/v1/install/start with auth header", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          install_url: "https://github.com/apps/clef-bot/installations/new?state=tok",
          state: "tok",
          expires_in: 600,
        },
        success: true,
      }),
    );

    const result = await startInstall("https://cloud.clef.sh", "jwt_abc");

    expect(result).toEqual({
      install_url: "https://github.com/apps/clef-bot/installations/new?state=tok",
      state: "tok",
      expires_in: 600,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://cloud.clef.sh/api/v1/install/start",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt_abc",
        }),
      }),
    );
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, "unauthorized"));

    await expect(startInstall("https://cloud.clef.sh", "bad_token")).rejects.toThrow(
      "Install start failed (401)",
    );
  });
});

describe("pollInstall", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should GET poll endpoint with state query param", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: { status: "pending" },
        success: true,
      }),
    );

    const result = await pollInstall("https://cloud.clef.sh", "tok");

    expect(result.status).toBe("pending");
    expect(mockFetch).toHaveBeenCalledWith("https://cloud.clef.sh/api/v1/install/poll?state=tok");
  });

  it("should return complete with installation data", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          status: "complete",
          installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
        },
        success: true,
      }),
    );

    const result = await pollInstall("https://cloud.clef.sh", "tok");

    expect(result.status).toBe("complete");
    expect(result.installation).toEqual({
      id: 12345678,
      account: "acme",
      installedAt: 1712847600000,
    });
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, "not found"));

    await expect(pollInstall("https://cloud.clef.sh", "bad_tok")).rejects.toThrow(
      "Install poll failed (404)",
    );
  });
});

describe("getMe", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should GET /api/v1/me with auth header", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
          installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
          subscription: { tier: "free", status: "active" },
        },
        success: true,
      }),
    );

    const result = await getMe("https://cloud.clef.sh", "jwt_abc");

    expect(result.user.login).toBe("jamesspears");
    expect(result.installation!.account).toBe("acme");
    expect(result.subscription.tier).toBe("free");
  });

  it("should throw session expired on 401", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, "unauthorized"));

    await expect(getMe("https://cloud.clef.sh", "expired_jwt")).rejects.toThrow("Session expired");
  });
});
