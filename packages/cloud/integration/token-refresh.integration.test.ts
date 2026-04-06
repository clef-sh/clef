import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Integration test for the credential write → resolveAccessToken read-back path.
 *
 * Uses a real temp directory for credentials and a local HTTP server
 * simulating the Cognito token endpoint.
 */

/** Minimal mock Cognito token endpoint. */
function createMockCognito() {
  let callCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/oauth2/token") {
      callCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: `fresh_access_token_${callCount}`,
          id_token: "mock_id_token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  let address: { port: number } | null = null;

  return {
    start: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          address = server.address() as { port: number };
          resolve(`http://127.0.0.1:${address.port}`);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    getCallCount: () => callCount,
    resetCallCount: () => {
      callCount = 0;
    },
  };
}

describe("token refresh integration", () => {
  let mockCognito: ReturnType<typeof createMockCognito>;
  let cognitoEndpoint: string;
  let tmpDir: string;
  let originalHome: string;

  beforeAll(async () => {
    mockCognito = createMockCognito();
    cognitoEndpoint = await mockCognito.start();
  });

  afterAll(async () => {
    await mockCognito.stop();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-token-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tmpDir;
    mockCognito.resetCallCount();
    // Clear any module cache so resolveAccessToken reads fresh credentials
    jest.resetModules();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns cached access token without calling Cognito", async () => {
    // Write credentials with a valid (non-expired) access token
    const { writeCloudCredentials } = await import("../src/credentials");
    writeCloudCredentials({
      refreshToken: "mock_refresh_token",
      accessToken: "cached_access_token",
      accessTokenExpiry: Date.now() + 300_000, // 5 minutes from now
      endpoint: "https://api.clef.sh",
      cognitoDomain: cognitoEndpoint,
      clientId: "mock_client_id",
    });

    const { resolveAccessToken } = await import("../src/sops");
    const result = await resolveAccessToken();

    expect(result.accessToken).toBe("cached_access_token");
    expect(mockCognito.getCallCount()).toBe(0);
  });

  it("refreshes via Cognito when access token is expired", async () => {
    const { writeCloudCredentials } = await import("../src/credentials");
    writeCloudCredentials({
      refreshToken: "mock_refresh_token",
      accessToken: "expired_access_token",
      accessTokenExpiry: Date.now() - 1000, // Already expired
      endpoint: "https://api.clef.sh",
      cognitoDomain: cognitoEndpoint,
      clientId: "mock_client_id",
    });

    const { resolveAccessToken } = await import("../src/sops");
    const result = await resolveAccessToken();

    expect(result.accessToken).toBe("fresh_access_token_1");
    expect(mockCognito.getCallCount()).toBe(1);

    // Verify the new token was persisted
    const { readCloudCredentials } = await import("../src/credentials");
    const creds = readCloudCredentials();
    expect(creds?.accessToken).toBe("fresh_access_token_1");
  });

  it("uses cached device flow token without requiring Cognito config", async () => {
    // Simulate the state right after device flow: access token present, valid,
    // but cognitoDomain/clientId might not be set. The reordered check in
    // resolveAccessToken should return the cached token without erroring.
    const { writeCloudCredentials } = await import("../src/credentials");
    writeCloudCredentials({
      refreshToken: "mock_refresh_token",
      accessToken: "device_flow_access_token",
      accessTokenExpiry: Date.now() + 300_000,
    });

    const { resolveAccessToken } = await import("../src/sops");
    const result = await resolveAccessToken();

    expect(result.accessToken).toBe("device_flow_access_token");
    expect(mockCognito.getCallCount()).toBe(0);
  });
});
