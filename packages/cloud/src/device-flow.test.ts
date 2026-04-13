import {
  requestDeviceCode,
  pollGitHubAuth,
  exchangeGitHubToken,
  runDeviceFlow,
} from "./device-flow";

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

describe("requestDeviceCode", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should POST to GitHub device code endpoint and return parsed result", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        device_code: "dc_abc123",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );

    const result = await requestDeviceCode("Iv1.test123");

    expect(result).toEqual({
      deviceCode: "dc_abc123",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "Iv1.test123",
          scope: "read:user user:email",
        }),
      }),
    );
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(422, { message: "bad request" }));

    await expect(requestDeviceCode("Iv1.test123")).rejects.toThrow(
      "GitHub device code request failed (422)",
    );
  });
});

describe("pollGitHubAuth", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should return success with access token when authorized", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        access_token: "gho_abc123",
        token_type: "bearer",
        scope: "read:user,user:email",
      }),
    );

    const result = await pollGitHubAuth("Iv1.test", "dc_abc", 0, 10);

    expect(result).toEqual({ status: "success", accessToken: "gho_abc123" });
  });

  it("should poll through authorization_pending then succeed", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { error: "authorization_pending" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "gho_abc123",
          token_type: "bearer",
          scope: "read:user",
        }),
      );

    const result = await pollGitHubAuth("Iv1.test", "dc_abc", 0, 10);

    expect(result).toEqual({ status: "success", accessToken: "gho_abc123" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should return expired when token expires", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { error: "expired_token" }));

    const result = await pollGitHubAuth("Iv1.test", "dc_abc", 0, 10);

    expect(result).toEqual({ status: "expired" });
  });

  it("should return access_denied when user denies", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { error: "access_denied" }));

    const result = await pollGitHubAuth("Iv1.test", "dc_abc", 0, 10);

    expect(result).toEqual({ status: "access_denied" });
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, "server error"));

    await expect(pollGitHubAuth("Iv1.test", "dc_abc", 0, 10)).rejects.toThrow(
      "GitHub token poll failed (500)",
    );
  });
});

describe("exchangeGitHubToken", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should exchange GitHub token for Clef session credentials", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          session_token: "jwt_abc",
          user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
        },
        success: true,
      }),
    );

    const result = await exchangeGitHubToken("https://cloud.clef.sh", "gho_abc");

    expect(result.session_token).toBe("jwt_abc");
    expect(result.login).toBe("jamesspears");
    expect(result.email).toBe("james@clef.sh");
    expect(result.base_url).toBe("https://cloud.clef.sh");
    expect(result.provider).toBe("github");
    expect(result.expires_at).toBeTruthy();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://cloud.clef.sh/api/v1/auth/github/token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ access_token: "gho_abc" }),
      }),
    );
  });

  it("should throw friendly message on 5xx", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, "internal"));

    await expect(exchangeGitHubToken("https://cloud.clef.sh", "gho_abc")).rejects.toThrow(
      "Authentication failed. Try again later.",
    );
  });

  it("should throw on 4xx with body", async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, "bad request"));

    await expect(exchangeGitHubToken("https://cloud.clef.sh", "gho_abc")).rejects.toThrow(
      "Token exchange failed (400)",
    );
  });
});

describe("runDeviceFlow", () => {
  beforeEach(() => mockFetch.mockReset());

  it("should run the full flow and return credentials on success", async () => {
    // Step 1: device code
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        device_code: "dc_abc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0,
      }),
    );

    // Step 3: poll (immediate success)
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "gho_success",
        token_type: "bearer",
        scope: "read:user",
      }),
    );

    // Step 4: exchange
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          session_token: "jwt_session",
          user: { id: "u1", login: "testuser", email: "test@test.com" },
        },
        success: true,
      }),
    );

    const onDeviceCode = jest.fn();
    const result = await runDeviceFlow("Iv1.test", "https://cloud.clef.sh", onDeviceCode);

    expect(result.status).toBe("success");
    expect(result.credentials!.session_token).toBe("jwt_session");
    expect(result.credentials!.login).toBe("testuser");
    expect(onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: "ABCD-1234" }));
  });

  it("should return expired when device code expires", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        device_code: "dc_abc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0,
      }),
    );

    mockFetch.mockResolvedValueOnce(jsonResponse(200, { error: "expired_token" }));

    const result = await runDeviceFlow("Iv1.test", "https://cloud.clef.sh", jest.fn());

    expect(result.status).toBe("expired");
    expect(result.credentials).toBeUndefined();
  });
});
