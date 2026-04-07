import * as http from "http";
import { initiateDeviceFlow, pollDeviceFlow } from "../src/device-flow";

/** Minimal mock Cloud API server for device flow testing. */
function createMockServer() {
  const sessions = new Map<string, { flow: string; environment?: string; pollCount: number }>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/v1/device/init") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const sessionId = `sess_${Date.now()}`;
        sessions.set(sessionId, {
          flow: parsed.flow,
          environment: parsed.environment,
          pollCount: 0,
        });

        const loginPath =
          parsed.flow === "login"
            ? `/cloud/auth?session=${sessionId}`
            : `/cloud/setup?session=${sessionId}`;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              sessionId,
              loginUrl: `http://127.0.0.1:${address!.port}${loginPath}`,
              pollUrl: `/api/v1/device/poll/${sessionId}`,
              expiresIn: 900,
            },
          }),
        );
      });
      return;
    }

    const pollMatch = url.pathname.match(/^\/api\/v1\/device\/poll\/(.+)$/);
    if (req.method === "GET" && pollMatch) {
      const sessionId = pollMatch[1];
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      session.pollCount++;

      if (session.pollCount === 1) {
        const status = session.flow === "setup" ? "awaiting_payment" : "pending";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { status } }));
        return;
      }

      const result: Record<string, unknown> = {
        status: "complete",
        token: "mock_refresh_token",
        accessToken: "mock_access_token",
        accessTokenExpiresIn: 3600,
        cognitoDomain: "https://auth.mock.amazoncognito.com",
        clientId: "mock_client_id",
      };
      if (session.flow === "setup") {
        result.integrationId = "int_mock";
        result.keyId = `clef:int_mock/${session.environment}`;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: result }));
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
    getSessions: () => sessions,
  };
}

describe("device flow integration", () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let endpoint: string;

  beforeAll(async () => {
    mockServer = createMockServer();
    endpoint = await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it("login flow: init → poll pending → poll complete with tokens", async () => {
    const session = await initiateDeviceFlow(endpoint, {
      repoName: "test-repo",
      clientVersion: "0.1.0",
      flow: "login",
    });

    expect(session.sessionId).toBeDefined();
    expect(session.loginUrl).toContain("/cloud/auth?session=");
    expect(session.pollUrl).toContain("/api/v1/device/poll/");

    // Resolve relative pollUrl
    const pollUrl = session.pollUrl.startsWith("http")
      ? session.pollUrl
      : `${endpoint}${session.pollUrl}`;

    // First poll returns pending
    const pending = await pollDeviceFlow(pollUrl);
    expect(pending.status).toBe("pending");

    // Second poll returns complete with tokens
    const complete = await pollDeviceFlow(pollUrl);
    expect(complete.status).toBe("complete");
    expect(complete.token).toBe("mock_refresh_token");
    expect(complete.accessToken).toBe("mock_access_token");
    expect(complete.accessTokenExpiresIn).toBe(3600);
    expect(complete.cognitoDomain).toBe("https://auth.mock.amazoncognito.com");
    expect(complete.clientId).toBe("mock_client_id");
    // Login flow should not return integration data
    expect(complete.integrationId).toBeUndefined();
    expect(complete.keyId).toBeUndefined();
  });

  it("setup flow: init → poll awaiting_payment → poll complete with integration data", async () => {
    const session = await initiateDeviceFlow(endpoint, {
      repoName: "test-repo",
      environment: "production",
      clientVersion: "0.1.0",
      flow: "setup",
    });

    expect(session.loginUrl).toContain("/cloud/setup?session=");

    const pollUrl = session.pollUrl.startsWith("http")
      ? session.pollUrl
      : `${endpoint}${session.pollUrl}`;

    // First poll returns awaiting_payment
    const awaiting = await pollDeviceFlow(pollUrl);
    expect(awaiting.status).toBe("awaiting_payment");

    // Second poll completes setup
    const complete = await pollDeviceFlow(pollUrl);
    expect(complete.status).toBe("complete");
    expect(complete.token).toBe("mock_refresh_token");
    expect(complete.accessToken).toBe("mock_access_token");
    expect(complete.integrationId).toBe("int_mock");
    expect(complete.keyId).toBe("clef:int_mock/production");
  });

  it("login flow omits environment from server request", async () => {
    await initiateDeviceFlow(endpoint, {
      repoName: "test-repo",
      clientVersion: "0.1.0",
      flow: "login",
    });

    // The mock server stores session data including environment.
    // For login flow, environment should be undefined.
    const sessions = mockServer.getSessions();
    const lastSession = Array.from(sessions.values()).pop()!;
    expect(lastSession.flow).toBe("login");
    expect(lastSession.environment).toBeUndefined();
  });

  it("setup flow includes environment in server request", async () => {
    await initiateDeviceFlow(endpoint, {
      repoName: "test-repo",
      environment: "staging",
      clientVersion: "0.1.0",
      flow: "setup",
    });

    const sessions = mockServer.getSessions();
    const lastSession = Array.from(sessions.values()).pop()!;
    expect(lastSession.flow).toBe("setup");
    expect(lastSession.environment).toBe("staging");
  });

  it("handles server error on init", async () => {
    // Hit a broken endpoint
    await expect(
      initiateDeviceFlow(`${endpoint}/broken`, {
        repoName: "test-repo",
        clientVersion: "0.1.0",
        flow: "login",
      }),
    ).rejects.toThrow("Device flow init failed");
  });

  it("handles poll for nonexistent session", async () => {
    await expect(pollDeviceFlow(`${endpoint}/api/v1/device/poll/nonexistent`)).rejects.toThrow(
      "Device flow poll failed (404)",
    );
  });
});
