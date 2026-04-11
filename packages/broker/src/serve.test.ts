import http from "http";
import { serve } from "./serve";
import type { BrokerHandler, BrokerServerHandle, LogFn } from "./types";

jest.mock(
  "age-encryption",
  () => ({
    Encrypter: jest.fn().mockImplementation(() => ({
      addRecipient: jest.fn(),
      encrypt: jest.fn().mockResolvedValue(new TextEncoder().encode("age-encrypted-data")),
    })),
    generateIdentity: jest.fn().mockResolvedValue("AGE-SECRET-KEY-1EPHEMERAL"),
    identityToRecipient: jest.fn().mockResolvedValue("age1ephemeralrecipient"),
  }),
  { virtual: true },
);

jest.mock("@clef-sh/runtime", () => ({
  createKmsProvider: jest.fn().mockReturnValue({
    wrap: jest.fn().mockResolvedValue({
      wrappedKey: Buffer.from("wrapped-key"),
      algorithm: "SYMMETRIC_DEFAULT",
    }),
    unwrap: jest.fn(),
  }),
}));

function setEnv(): void {
  process.env.CLEF_BROKER_IDENTITY = "test-svc";
  process.env.CLEF_BROKER_ENVIRONMENT = "test";
  process.env.CLEF_BROKER_KMS_PROVIDER = "aws";
  process.env.CLEF_BROKER_KMS_KEY_ID = "arn:aws:kms:us-east-1:123:key/test";
}

function clearEnv(): void {
  delete process.env.CLEF_BROKER_IDENTITY;
  delete process.env.CLEF_BROKER_ENVIRONMENT;
  delete process.env.CLEF_BROKER_KMS_PROVIDER;
  delete process.env.CLEF_BROKER_KMS_KEY_ID;
  delete process.env.CLEF_BROKER_KMS_REGION;
  delete process.env.CLEF_BROKER_PORT;
  delete process.env.CLEF_BROKER_HOST;
}

function mockHandler(): BrokerHandler {
  return {
    create: jest.fn().mockResolvedValue({
      data: { TOKEN: "secret-token" },
      ttl: 900,
      entityId: "entity-1",
    }),
  };
}

function get(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

function request(url: string, method: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("serve", () => {
  let handle: BrokerServerHandle | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    setEnv();
  });

  afterEach(async () => {
    clearEnv();
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it("serves a valid envelope on GET /", async () => {
    handle = await serve(mockHandler(), { port: 0 });

    const res = await get(handle.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");

    const artifact = JSON.parse(res.body);
    expect(artifact.version).toBe(1);
    expect(JSON.parse(res.body).keys).toBeUndefined();
  });

  it("returns 200 on GET /health", async () => {
    handle = await serve(mockHandler(), { port: 0 });

    const res = await get(handle.url + "/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("returns 405 for POST", async () => {
    handle = await serve(mockHandler(), { port: 0 });

    const res = await request(handle.url + "/", "POST");
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown paths", async () => {
    handle = await serve(mockHandler(), { port: 0 });

    const res = await get(handle.url + "/unknown");
    expect(res.status).toBe(404);
  });

  it("stop() closes the server", async () => {
    handle = await serve(mockHandler(), { port: 0 });
    const url = handle.url;

    await handle.stop();
    handle = undefined;

    await expect(get(url + "/")).rejects.toThrow();
  });

  it("stop() calls shutdown on the broker (revokes active credential)", async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const handler: BrokerHandler = {
      create: jest.fn().mockResolvedValue({
        data: { TOKEN: "val" },
        ttl: 900,
        entityId: "entity-1",
      }),
      revoke,
    };
    handle = await serve(handler, { port: 0 });

    await get(handle.url + "/");
    await handle.stop();
    handle = undefined;

    expect(revoke).toHaveBeenCalledWith("entity-1", expect.any(Object));
  });

  describe("bind host logging", () => {
    function captureLogs(): { logs: Array<[string, string]>; onLog: LogFn } {
      const logs: Array<[string, string]> = [];
      const onLog: LogFn = (level, message) => {
        logs.push([level, message]);
      };
      return { logs, onLog };
    }

    it("logs the served URL with the actual bind host, not a hardcoded 127.0.0.1", async () => {
      const { logs, onLog } = captureLogs();
      handle = await serve(mockHandler(), { port: 0, host: "127.0.0.1", onLog });

      const info = logs.find(([level]) => level === "info");
      expect(info).toBeDefined();
      expect(info![1]).toMatch(/^Broker serving at http:\/\/127\.0\.0\.1:\d+$/);
    });

    it("does not warn when bound to 127.0.0.1", async () => {
      const { logs, onLog } = captureLogs();
      handle = await serve(mockHandler(), { port: 0, host: "127.0.0.1", onLog });

      expect(logs.some(([level]) => level === "warn")).toBe(false);
    });

    it("warns when bound to 0.0.0.0", async () => {
      const { logs, onLog } = captureLogs();
      handle = await serve(mockHandler(), { port: 0, host: "0.0.0.0", onLog });

      const warn = logs.find(([level]) => level === "warn");
      expect(warn).toBeDefined();
      expect(warn![1]).toContain("non-loopback");
      expect(warn![1]).toContain("0.0.0.0");
    });

    it("warns when bound to localhost (which may resolve to dual-stack)", async () => {
      const { logs, onLog } = captureLogs();
      handle = await serve(mockHandler(), { port: 0, host: "localhost", onLog });

      expect(logs.some(([level]) => level === "warn")).toBe(true);
    });
  });
});
