import * as http from "http";
import { exchangeGitHubToken } from "../src/device-flow";

/**
 * Integration test for the Clef token exchange.
 *
 * Uses a local HTTP server to simulate the Clef Cloud backend.
 * The GitHub Device Flow endpoints (github.com) are hardcoded in the module,
 * so we only integration-test the Clef-side exchange here.
 */

function createMockClefCloud() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // POST /api/v1/auth/github/token
    if (req.method === "POST" && url.pathname === "/api/v1/auth/github/token") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              session_token: `jwt_${parsed.access_token}`,
              user: {
                id: "u1",
                login: "testuser",
                email: "test@clef.sh",
              },
            },
            success: true,
          }),
        );
      });
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
  };
}

describe("GitHub device flow integration", () => {
  let mockCloud: ReturnType<typeof createMockClefCloud>;
  let cloudUrl: string;

  beforeAll(async () => {
    mockCloud = createMockClefCloud();
    cloudUrl = await mockCloud.start();
  });

  afterAll(async () => {
    await mockCloud.stop();
  });

  it("exchanges a GitHub token for Clef credentials", async () => {
    const creds = await exchangeGitHubToken(cloudUrl, "gho_test_token");

    expect(creds.session_token).toBe("jwt_gho_test_token");
    expect(creds.login).toBe("testuser");
    expect(creds.email).toBe("test@clef.sh");
    expect(creds.base_url).toBe(cloudUrl);
    expect(creds.expires_at).toBeTruthy();
  });
});
