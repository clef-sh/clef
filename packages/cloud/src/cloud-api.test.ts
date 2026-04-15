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

  it("returns already_installed shape when user is already set up", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          already_installed: true,
          installation: { id: 12345678, account: "acme" },
          dashboard_url: "https://cloud.clef.sh/dashboard",
        },
        success: true,
      }),
    );

    const result = await startInstall("https://cloud.clef.sh", "jwt_abc");

    expect(result).toEqual({
      already_installed: true,
      installation: { id: 12345678, account: "acme" },
      dashboard_url: "https://cloud.clef.sh/dashboard",
    });
  });

  it("returns already_installed shape with null dashboard_url", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          already_installed: true,
          installation: { id: 12345678, account: "acme" },
          dashboard_url: null,
        },
        success: true,
      }),
    );

    const result = await startInstall("https://cloud.clef.sh", "jwt_abc");

    expect(result).toEqual({
      already_installed: true,
      installation: { id: 12345678, account: "acme" },
      dashboard_url: null,
    });
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
          user: {
            clefId: "u1",
            vcsAccounts: [
              {
                provider: "github",
                login: "jamesspears",
                avatarUrl: "",
                displayName: "James Spears",
              },
            ],
            email: "james@clef.sh",
            displayName: "James Spears",
          },
          installations: [
            { id: 11111111, account: "acme-corp", installedAt: 1712847600000 },
            { id: 22222222, account: "jamesspears", installedAt: 1712848000000 },
          ],
          posthog_distinct_id: "u1",
          freeTierLimit: 1,
        },
        success: true,
      }),
    );

    const result = await getMe("https://cloud.clef.sh", "jwt_abc");

    expect(result.user.vcsAccounts[0].login).toBe("jamesspears");
    expect(result.installations).toHaveLength(2);
    expect(result.installations[0].account).toBe("acme-corp");
    expect(result.freeTierLimit).toBe(1);
  });

  it("should throw session expired on 401", async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, "unauthorized"));

    await expect(getMe("https://cloud.clef.sh", "expired_jwt")).rejects.toThrow("Session expired");
  });
});
