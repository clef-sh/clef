import * as http from "http";
import { startAgentServer, AgentServerHandle } from "./server";
import { SecretsCache } from "@clef-sh/runtime";
import type { AddressInfo } from "net";

let handle: AgentServerHandle;
let cache: SecretsCache;
const TOKEN = "test-token-12345";
const TEST_PORT = 19779;

async function getJson(
  path: string,
  token?: string,
  customHost?: string,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = {
    Host: customHost ?? `127.0.0.1:${TEST_PORT}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, { headers });
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

describe("Agent HTTP server", () => {
  beforeEach(async () => {
    cache = new SecretsCache();
    handle = await startAgentServer({ port: TEST_PORT, token: TOKEN, cache });
  });

  afterEach(async () => {
    if (handle) await handle.stop();
  });

  describe("unauthenticated endpoints", () => {
    it("GET /v1/health should return ok with TTL fields", async () => {
      const { status, body } = await getJson("/v1/health");
      expect(status).toBe(200);
      expect(body).toEqual({
        status: "ok",
        mode: "cached",
        revision: null,
        lastRefreshAt: null,
        expired: false,
      });
    });

    it("GET /v1/health should include revision and lastRefreshAt when cache loaded", async () => {
      cache.swap({ KEY: "val" }, ["KEY"], "rev42");
      const { body } = await getJson("/v1/health");
      expect((body as Record<string, unknown>).status).toBe("ok");
      expect((body as Record<string, unknown>).revision).toBe("rev42");
      expect((body as Record<string, unknown>).lastRefreshAt).toEqual(expect.any(Number));
      expect((body as Record<string, unknown>).expired).toBe(false);
    });

    it("GET /v1/ready should return 503 when cache not loaded", async () => {
      const { status, body } = await getJson("/v1/ready");
      expect(status).toBe(503);
      expect(body).toEqual({ ready: false, reason: "not_loaded" });
    });

    it("GET /v1/ready should return 200 when cache loaded", async () => {
      cache.swap({ KEY: "val" }, ["KEY"], "rev1");
      const { status, body } = await getJson("/v1/ready");
      expect(status).toBe(200);
      expect(body).toEqual({ ready: true });
    });
  });

  describe("authenticated endpoints", () => {
    beforeEach(() => {
      cache.swap({ DB_URL: "postgres://...", API_KEY: "secret" }, ["DB_URL", "API_KEY"], "rev1");
    });

    it("GET /v1/secrets should return 401 without token", async () => {
      const { status } = await getJson("/v1/secrets");
      expect(status).toBe(401);
    });

    it("GET /v1/secrets should return 401 with wrong token", async () => {
      const { status } = await getJson("/v1/secrets", "wrong-token");
      expect(status).toBe(401);
    });

    it("GET /v1/secrets should return all secrets with valid token", async () => {
      const { status, body } = await getJson("/v1/secrets", TOKEN);
      expect(status).toBe(200);
      expect(body).toEqual({ DB_URL: "postgres://...", API_KEY: "secret" });
    });

    it("GET /v1/secrets should include Cache-Control: no-store", async () => {
      const { headers } = await getJson("/v1/secrets", TOKEN);
      expect(headers.get("cache-control")).toBe("no-store");
    });

    it("GET /v1/keys should return key names", async () => {
      const { status, body } = await getJson("/v1/keys", TOKEN);
      expect(status).toBe(200);
      expect(body).toEqual(["DB_URL", "API_KEY"]);
    });

    it("GET /v1/keys should return 401 without token", async () => {
      const { status } = await getJson("/v1/keys");
      expect(status).toBe(401);
    });
  });

  describe("secrets not loaded", () => {
    it("GET /v1/secrets should return 503 when cache empty", async () => {
      const { status } = await getJson("/v1/secrets", TOKEN);
      expect(status).toBe(503);
    });
  });

  describe("server binding", () => {
    it("binds to 127.0.0.1", () => {
      const addr = handle.address() as AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
    });
  });

  describe("host header validation", () => {
    it("should return 403 for requests with an invalid Host header", async () => {
      // Use http.request directly — fetch() does not allow overriding the Host header
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

    it("should accept bare 127.0.0.1 without port suffix", async () => {
      const status = await new Promise<number>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: TEST_PORT,
            path: "/v1/health",
            method: "GET",
            headers: { Host: "127.0.0.1" },
          },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.end();
      });
      expect(status).toBe(200);
    });
  });

  describe("cache TTL guard", () => {
    const TTL_PORT = 19780;
    let ttlHandle: AgentServerHandle;
    let ttlCache: SecretsCache;

    async function getTtlJson(
      path: string,
      token?: string,
    ): Promise<{ status: number; body: unknown }> {
      const headers: Record<string, string> = {
        Host: `127.0.0.1:${TTL_PORT}`,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`http://127.0.0.1:${TTL_PORT}${path}`, { headers });
      const body = await res.json();
      return { status: res.status, body };
    }

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

    it("should return 503 on /v1/secrets when cache is expired", async () => {
      // Swap with a timestamp in the past
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 20_000);
      ttlCache.swap({ KEY: "val" }, ["KEY"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);

      const { status, body } = await getTtlJson("/v1/secrets", TOKEN);
      expect(status).toBe(503);
      expect(body).toEqual({ error: "Secrets expired" });
    });

    it("should return 503 on /v1/keys when cache is expired", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 20_000);
      ttlCache.swap({ KEY: "val" }, ["KEY"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);

      const { status, body } = await getTtlJson("/v1/keys", TOKEN);
      expect(status).toBe(503);
      expect(body).toEqual({ error: "Secrets expired" });
    });

    it("should serve secrets normally when cache is fresh", async () => {
      ttlCache.swap({ KEY: "val" }, ["KEY"], "rev1");

      const { status, body } = await getTtlJson("/v1/secrets", TOKEN);
      expect(status).toBe(200);
      expect(body).toEqual({ KEY: "val" });
    });

    it("GET /v1/health should report expired=true when cache is expired", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 20_000);
      ttlCache.swap({ KEY: "val" }, ["KEY"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);

      const { body } = await getTtlJson("/v1/health");
      expect((body as Record<string, unknown>).expired).toBe(true);
    });

    it("GET /v1/ready should return 503 with reason cache_expired", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValueOnce(now - 20_000);
      ttlCache.swap({ KEY: "val" }, ["KEY"], "rev1");
      jest.spyOn(Date, "now").mockReturnValue(now);

      const { status, body } = await getTtlJson("/v1/ready");
      expect(status).toBe(503);
      expect(body).toEqual({ ready: false, reason: "cache_expired" });
    });
  });
});
