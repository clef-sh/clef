/**
 * Agent E2E tests — black-box subprocess testing.
 *
 * Spawns `node dist/agent.cjs` as a real subprocess with env vars,
 * waits for readiness, and hits the HTTP API from the outside.
 * No in-process imports of agent code except the subprocess launcher.
 *
 * Run: npm run test:e2e -w packages/agent
 */
import * as http from "http";
import { scaffoldFixture, agentFetch, type TestFixture } from "./harness";
import { startAgent, type AgentProcess } from "./agent-process";

const TEST_SECRETS = {
  DATABASE_URL: "postgres://localhost:5432/mydb",
  API_KEY: "sk_live_test_12345",
  WEBHOOK_SECRET: "whsec_e2e_test",
};

let fixture: TestFixture;
let agent: AgentProcess;

beforeAll(async () => {
  fixture = scaffoldFixture(TEST_SECRETS);
  agent = await startAgent(fixture.artifactPath, fixture.keys.privateKey);
}, 30_000);

afterAll(async () => {
  if (agent) await agent.stop();
  if (fixture) fixture.cleanup();
});

// ── Health & Readiness ────────────────────────────────────────────────────────

describe("health and readiness", () => {
  it("GET /v1/health returns ok with revision", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/health");
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.status).toBe("ok");
    expect(b.revision).toBe("rev-001");
    expect(b.lastRefreshAt).toEqual(expect.any(Number));
    expect(b.expired).toBe(false);
  });

  it("GET /v1/ready returns 200", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/ready");
    expect(status).toBe(200);
    expect(body).toEqual({ ready: true });
  });

  it("health and ready do not require auth", async () => {
    // No token — should still succeed
    const health = await agentFetch(agent.url, "/v1/health");
    expect(health.status).toBe(200);
    const ready = await agentFetch(agent.url, "/v1/ready");
    expect(ready.status).toBe(200);
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("authentication", () => {
  it("GET /v1/secrets returns 401 without token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets");
    expect(status).toBe(401);
  });

  it("GET /v1/secrets returns 401 with wrong token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets", "wrong-token");
    expect(status).toBe(401);
  });

  it("GET /v1/keys returns 401 without token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/keys");
    expect(status).toBe(401);
  });
});

// ── Secrets Retrieval ─────────────────────────────────────────────────────────

describe("secrets retrieval", () => {
  it("GET /v1/secrets returns all decrypted secrets", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/secrets", agent.token);
    expect(status).toBe(200);
    expect(body).toEqual(TEST_SECRETS);
  });

  it("GET /v1/secrets/:key returns individual secret", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/secrets/DATABASE_URL", agent.token);
    expect(status).toBe(200);
    expect(body).toEqual({ value: TEST_SECRETS.DATABASE_URL });
  });

  it("GET /v1/secrets/:key returns 404 for missing key", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets/NONEXISTENT", agent.token);
    expect(status).toBe(404);
  });

  it("GET /v1/keys returns key names", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/keys", agent.token);
    expect(status).toBe(200);
    expect(new Set(body as string[])).toEqual(new Set(Object.keys(TEST_SECRETS)));
  });
});

// ── Security Headers ──────────────────────────────────────────────────────────

describe("security headers", () => {
  it("GET /v1/secrets includes Cache-Control: no-store", async () => {
    const { headers } = await agentFetch(agent.url, "/v1/secrets", agent.token);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("rejects requests with invalid Host header", async () => {
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: agent.port,
          path: "/v1/health",
          method: "GET",
          headers: { Host: "evil.example.com" },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.end();
    });
    expect(status).toBe(403);
  });
});

// ── Fresh Agent with Updated Artifact ─────────────────────────────────────────

describe("artifact update", () => {
  let agent2: AgentProcess;
  let fixture2: TestFixture;

  afterEach(async () => {
    if (agent2) await agent2.stop();
    if (fixture2) fixture2.cleanup();
  });

  it("serves new secrets after artifact is replaced and agent restarted", async () => {
    const updatedSecrets = { UPDATED_KEY: "updated_value", ANOTHER: "val2" };
    fixture2 = scaffoldFixture(updatedSecrets);
    agent2 = await startAgent(fixture2.artifactPath, fixture2.keys.privateKey);

    const { status, body } = await agentFetch(agent2.url, "/v1/secrets", agent2.token);
    expect(status).toBe(200);
    expect(body).toEqual(updatedSecrets);
  });
});

// ── Config Error ──────────────────────────────────────────────────────────────

describe("startup errors", () => {
  it("agent exits with code 1 when no source is configured", async () => {
    await expect(startAgent("/nonexistent/artifact.json", "invalid-key")).rejects.toThrow(
      /exited prematurely/,
    );
  });
});
