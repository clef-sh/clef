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
    it("GET /v1/health should return ok", async () => {
      const { status, body } = await getJson("/v1/health");
      expect(status).toBe(200);
      expect(body).toEqual({ status: "ok", revision: null });
    });

    it("GET /v1/health should include revision when cache loaded", async () => {
      cache.swap({ KEY: "val" }, ["KEY"], "rev42");
      const { body } = await getJson("/v1/health");
      expect(body).toEqual({ status: "ok", revision: "rev42" });
    });

    it("GET /v1/ready should return 503 when cache not loaded", async () => {
      const { status, body } = await getJson("/v1/ready");
      expect(status).toBe(503);
      expect(body).toEqual({ ready: false });
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

    it("GET /v1/secrets/:key should return single secret", async () => {
      const { status, body } = await getJson("/v1/secrets/DB_URL", TOKEN);
      expect(status).toBe(200);
      expect(body).toEqual({ value: "postgres://..." });
    });

    it("GET /v1/secrets/:key should include Cache-Control: no-store", async () => {
      const { headers } = await getJson("/v1/secrets/DB_URL", TOKEN);
      expect(headers.get("cache-control")).toBe("no-store");
    });

    it("GET /v1/secrets/:key should return 404 for missing key", async () => {
      const { status } = await getJson("/v1/secrets/NOPE", TOKEN);
      expect(status).toBe(404);
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
  });
});
