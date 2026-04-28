/**
 * Agent E2E tests — black-box subprocess testing.
 *
 * Uses Node's built-in test runner (node:test) instead of Jest to avoid
 * Windows subprocess cleanup issues (ECONNRESET on stdio pipes).
 *
 * Run: npx tsx --test packages/agent/e2e/agent.e2e.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { scaffoldFixture, agentFetch, type TestFixture } from "./harness";
import { startAgent, type AgentProcess } from "./agent-process";

const TEST_SECRETS = {
  app: {
    DATABASE_URL: "postgres://localhost:5432/mydb",
    API_KEY: "sk_live_test_12345",
    WEBHOOK_SECRET: "whsec_e2e_test",
  },
};

let fixture: TestFixture;
let agent: AgentProcess;

before(async () => {
  fixture = scaffoldFixture(TEST_SECRETS);
  agent = await startAgent(fixture.artifactPath, fixture.keys.privateKey);
});

after(async () => {
  if (agent) await agent.stop();
  if (fixture) fixture.cleanup();
});

// ── Health & Readiness ────────────────────────────────────────────────────────

describe("health and readiness", () => {
  it("GET /v1/health returns ok with revision", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/health");
    assert.equal(status, 200);
    const b = body as Record<string, unknown>;
    assert.equal(b.status, "ok");
    assert.equal(b.revision, "rev-001");
    assert.equal(typeof b.lastRefreshAt, "number");
    assert.equal(b.expired, false);
  });

  it("GET /v1/ready returns 200", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/ready");
    assert.equal(status, 200);
    assert.deepEqual(body, { ready: true });
  });

  it("health and ready do not require auth", async () => {
    const health = await agentFetch(agent.url, "/v1/health");
    assert.equal(health.status, 200);
    const ready = await agentFetch(agent.url, "/v1/ready");
    assert.equal(ready.status, 200);
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("authentication", () => {
  it("GET /v1/secrets returns 401 without token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets");
    assert.equal(status, 401);
  });

  it("GET /v1/secrets returns 401 with wrong token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets", "wrong-token");
    assert.equal(status, 401);
  });

  it("GET /v1/keys returns 401 without token", async () => {
    const { status } = await agentFetch(agent.url, "/v1/keys");
    assert.equal(status, 401);
  });
});

// ── Secrets Retrieval ─────────────────────────────────────────────────────────

describe("secrets retrieval", () => {
  it("GET /v1/secrets returns all decrypted secrets", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/secrets", agent.token);
    assert.equal(status, 200);
    assert.deepEqual(body, TEST_SECRETS);
  });

  it("GET /v1/secrets/:key route is removed (returns 404)", async () => {
    const { status } = await agentFetch(agent.url, "/v1/secrets/DATABASE_URL", agent.token);
    assert.equal(status, 404);
  });

  it("GET /v1/keys returns key names in flat <namespace>__<key> form", async () => {
    const { status, body } = await agentFetch(agent.url, "/v1/keys", agent.token);
    assert.equal(status, 200);
    const keys = new Set(body as string[]);
    const expected = new Set(
      Object.entries(TEST_SECRETS).flatMap(([ns, bucket]) =>
        Object.keys(bucket).map((k) => `${ns}__${k}`),
      ),
    );
    assert.deepEqual(keys, expected);
  });
});

// ── Security Headers ──────────────────────────────────────────────────────────

describe("security headers", () => {
  it("GET /v1/secrets includes Cache-Control: no-store", async () => {
    const { headers } = await agentFetch(agent.url, "/v1/secrets", agent.token);
    assert.equal(headers["cache-control"], "no-store");
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
        (res) => {
          res.resume(); // drain the response body
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", () => {}); // swallow socket reset on Windows
      req.end();
    });
    assert.equal(status, 403);
  });
});

// ── Fresh Agent with Updated Artifact ─────────────────────────────────────────

describe("artifact update", () => {
  it("serves new secrets after artifact is replaced and agent restarted", async () => {
    const updatedSecrets = { app: { UPDATED_KEY: "updated_value", ANOTHER: "val2" } };
    const fixture2 = scaffoldFixture(updatedSecrets);
    const agent2 = await startAgent(fixture2.artifactPath, fixture2.keys.privateKey);

    try {
      const { status, body } = await agentFetch(agent2.url, "/v1/secrets", agent2.token);
      assert.equal(status, 200);
      assert.deepEqual(body, updatedSecrets);
    } finally {
      await agent2.stop();
      fixture2.cleanup();
    }
  });
});

// ── Config Error ──────────────────────────────────────────────────────────────

describe("startup errors", () => {
  it("agent exits with code 1 when no source is configured", async () => {
    await assert.rejects(
      () => startAgent("/nonexistent/artifact.json", "invalid-key"),
      /exited prematurely/,
    );
  });
});
