/**
 * Agent integration tests — server + cache layer with real age-encrypted artifacts.
 *
 * Encryption and decryption happen in ESM subprocess helpers (age-encryption
 * is ESM-only). The Express server and HTTP layer are tested in-process.
 *
 * Run: npm run test:integration -w packages/agent
 */
import * as fs from "fs";
import * as http from "http";
import { execFileSync } from "child_process";
import * as path from "path";
import { startAgentServer, AgentServerHandle } from "../src/server";
import { SecretsCache } from "@clef-sh/runtime";
import { scaffoldFixture, createArtifact, agentFetch, type TestFixture } from "../e2e/harness";

const HELPERS_DIR = path.resolve(__dirname, "../e2e/helpers");
const TEST_PORT = 29779;
const TOKEN = "e2e-test-token-abcdef1234567890";

const TEST_SECRETS = {
  DATABASE_URL: "postgres://localhost:5432/mydb",
  API_KEY: "sk_live_test_12345",
  WEBHOOK_SECRET: "whsec_e2e_test",
};

/**
 * Decrypt an artifact file using the ESM subprocess helper.
 */
function decryptArtifact(artifactPath: string, privateKey: string): Record<string, string> {
  const helperPath = path.join(HELPERS_DIR, "decrypt-artifact.mjs");
  const result = execFileSync(process.execPath, [helperPath, artifactPath, privateKey], {
    encoding: "utf-8",
  });
  return JSON.parse(result) as Record<string, string>;
}

let fixture: TestFixture;
let cache: SecretsCache;
let handle: AgentServerHandle;

beforeAll(async () => {
  fixture = scaffoldFixture(TEST_SECRETS);

  // Decrypt via subprocess and load into cache
  const secrets = decryptArtifact(fixture.artifactPath, fixture.keys.privateKey);
  cache = new SecretsCache();
  cache.swap({ default: secrets }, "rev-001");

  handle = await startAgentServer({ port: TEST_PORT, token: TOKEN, cache });
}, 30_000);

afterAll(async () => {
  if (handle) await handle.stop();
  if (fixture) fixture.cleanup();
});

// ── Health & Readiness ────────────────────────────────────────────────────────

describe("health and readiness", () => {
  it("GET /v1/health returns ok with revision", async () => {
    const { status, body } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/health");
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.status).toBe("ok");
    expect(b.revision).toBe("rev-001");
    expect(b.lastRefreshAt).toEqual(expect.any(Number));
    expect(b.expired).toBe(false);
  });

  it("GET /v1/ready returns 200 when cache is loaded", async () => {
    const { status, body } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/ready");
    expect(status).toBe(200);
    expect(body).toEqual({ ready: true });
  });

  it("health and ready are unauthenticated", async () => {
    const health = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/health");
    expect(health.status).toBe(200);

    const ready = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/ready");
    expect(ready.status).toBe(200);
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("authentication", () => {
  it("GET /v1/secrets returns 401 without token", async () => {
    const { status } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/secrets");
    expect(status).toBe(401);
  });

  it("GET /v1/secrets returns 401 with wrong token", async () => {
    const { status } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets",
      "wrong-token",
    );
    expect(status).toBe(401);
  });

  it("GET /v1/keys returns 401 without token", async () => {
    const { status } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/keys");
    expect(status).toBe(401);
  });
});

// ── Secrets Retrieval ─────────────────────────────────────────────────────────

describe("secrets retrieval", () => {
  it("GET /v1/secrets returns all decrypted secrets", async () => {
    const { status, body } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets",
      TOKEN,
    );
    expect(status).toBe(200);
    expect(body).toEqual({ default: TEST_SECRETS });
  });

  it("GET /v1/secrets/:key route is removed (returns 404)", async () => {
    const { status } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets/DATABASE_URL",
      TOKEN,
    );
    expect(status).toBe(404);
  });

  it("GET /v1/keys returns key names", async () => {
    const { status, body } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/keys", TOKEN);
    expect(status).toBe(200);
    expect(new Set(body as string[])).toEqual(
      new Set(Object.keys(TEST_SECRETS).map((k) => `default__${k}`)),
    );
  });
});

// ── Security Headers ──────────────────────────────────────────────────────────

describe("security headers", () => {
  it("GET /v1/secrets includes Cache-Control: no-store", async () => {
    const { headers } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/secrets", TOKEN);
    expect(headers["cache-control"]).toBe("no-store");
  });

  it("rejects requests with invalid Host header", async () => {
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
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

// ── Cache Refresh ─────────────────────────────────────────────────────────────

describe("cache refresh", () => {
  it("serves updated secrets after cache swap", async () => {
    // Create a new artifact with additional secrets
    const newSecrets = { ...TEST_SECRETS, NEW_KEY: "new_value" };
    const newArtifact = createArtifact(fixture.keys.publicKey, newSecrets, {
      revision: "rev-002",
    });

    // Write and decrypt
    fs.writeFileSync(fixture.artifactPath, newArtifact);
    const decrypted = decryptArtifact(fixture.artifactPath, fixture.keys.privateKey);
    cache.swap({ default: decrypted }, "rev-002");

    const { status, body } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets",
      TOKEN,
    );
    expect(status).toBe(200);
    expect(body).toEqual({ default: newSecrets });

    const { body: healthBody } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/health");
    expect((healthBody as Record<string, unknown>).revision).toBe("rev-002");
  });
});

// ── Cache Wipe (Revocation Simulation) ────────────────────────────────────────

describe("cache wipe", () => {
  it("returns 503 after cache is wiped", async () => {
    // Restore cache first
    cache.swap({ default: TEST_SECRETS }, "rev-003");

    // Verify serving
    const { status: before } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets",
      TOKEN,
    );
    expect(before).toBe(200);

    // Wipe cache (simulates revocation)
    cache.wipe();

    // Ready should be false
    const { status: readyStatus } = await agentFetch(`http://127.0.0.1:${TEST_PORT}`, "/v1/ready");
    expect(readyStatus).toBe(503);

    // Secrets should be 503
    const { status: after } = await agentFetch(
      `http://127.0.0.1:${TEST_PORT}`,
      "/v1/secrets",
      TOKEN,
    );
    expect(after).toBe(503);

    // Restore for subsequent tests
    cache.swap({ default: TEST_SECRETS }, "rev-004");
  });
});

// ── Cache TTL ─────────────────────────────────────────────────────────────────

describe("cache TTL guard", () => {
  const TTL_PORT = 29780;
  let ttlHandle: AgentServerHandle;
  let ttlCache: SecretsCache;

  beforeEach(async () => {
    ttlCache = new SecretsCache();
    ttlHandle = await startAgentServer({
      port: TTL_PORT,
      token: TOKEN,
      cache: ttlCache,
      cacheTtl: 10,
    });
  });

  afterEach(async () => {
    if (ttlHandle) await ttlHandle.stop();
  });

  it("returns 503 when cache has not been loaded", async () => {
    const { status, body } = await agentFetch(`http://127.0.0.1:${TTL_PORT}`, "/v1/secrets", TOKEN);
    expect(status).toBe(503);
    expect(body).toEqual({ error: "Secrets not yet loaded" });
  });

  it("returns 200 when cache is fresh", async () => {
    ttlCache.swap({ default: { KEY: "val" } }, "rev-ttl");
    const { status } = await agentFetch(`http://127.0.0.1:${TTL_PORT}`, "/v1/secrets", TOKEN);
    expect(status).toBe(200);
  });

  it("ready returns not_loaded before first swap", async () => {
    const { status, body } = await agentFetch(`http://127.0.0.1:${TTL_PORT}`, "/v1/ready");
    expect(status).toBe(503);
    expect(body).toEqual({ ready: false, reason: "not_loaded" });
  });
});
