import * as http from "http";
import { ClefClient } from "../src/clef-client";
import { CloudKmsProvider } from "../src/cloud-kms-provider";

/**
 * Minimal mock server that fakes both the agent serve endpoint
 * and the Cloud KMS decrypt endpoint.
 */
function createMockServer() {
  const secrets: Record<string, string> = {
    DB_URL: "postgres://localhost:5432/mydb",
    API_KEY: "sk-test-1234567890",
    REDIS_URL: "redis://localhost:6379",
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Auth check
    const auth = req.headers.authorization;
    if (url.pathname !== "/v1/health" && auth !== "Bearer test-service-token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // GET /v1/secrets — flat key-value map (agent format)
    if (req.method === "GET" && url.pathname === "/v1/secrets") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(secrets));
      return;
    }

    // GET /v1/health
    if (req.method === "GET" && url.pathname === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // POST /api/v1/cloud/kms/decrypt — mock KMS decrypt
    if (req.method === "POST" && url.pathname === "/api/v1/cloud/kms/decrypt") {
      let body = "";
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);

        if (!parsed.keyArn || !parsed.ciphertext) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, message: "Missing keyArn or ciphertext" }));
          return;
        }

        // "Decrypt" by just returning the ciphertext as-is (mock identity transform)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: { plaintext: parsed.ciphertext },
            success: true,
            message: "ok",
          }),
        );
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
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

describe("ClefClient integration", () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let endpoint: string;

  beforeAll(async () => {
    mockServer = createMockServer();
    endpoint = await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it("get() returns a secret from the serve endpoint", async () => {
    const client = new ClefClient({ endpoint, token: "test-service-token" });
    const value = await client.get("DB_URL");
    expect(value).toBe("postgres://localhost:5432/mydb");
  });

  it("getAll() returns all secrets", async () => {
    const client = new ClefClient({ endpoint, token: "test-service-token" });
    const all = await client.getAll();
    expect(all).toEqual({
      DB_URL: "postgres://localhost:5432/mydb",
      API_KEY: "sk-test-1234567890",
      REDIS_URL: "redis://localhost:6379",
    });
  });

  it("keys() returns key names", async () => {
    const client = new ClefClient({ endpoint, token: "test-service-token" });
    const keyNames = await client.keys();
    expect(keyNames).toEqual(["DB_URL", "API_KEY", "REDIS_URL"]);
  });

  it("health() returns true for reachable endpoint", async () => {
    const client = new ClefClient({ endpoint, token: "test-service-token" });
    expect(await client.health()).toBe(true);
  });

  it("get() returns undefined for missing key", async () => {
    const client = new ClefClient({
      endpoint,
      token: "test-service-token",
      envFallback: false,
    });
    expect(await client.get("NONEXISTENT")).toBeUndefined();
  });

  it("throws on bad token", async () => {
    const client = new ClefClient({ endpoint, token: "wrong-token" });
    await expect(client.get("DB_URL")).rejects.toThrow("Authentication failed");
  });

  it("caches results within TTL", async () => {
    const client = new ClefClient({
      endpoint,
      token: "test-service-token",
      cacheTtlMs: 5000,
    });
    const first = await client.getAll();
    const second = await client.getAll();
    expect(first).toEqual(second);
  });
});

describe("CloudKmsProvider integration", () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let endpoint: string;

  beforeAll(async () => {
    mockServer = createMockServer();
    endpoint = await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it("unwrap() decrypts via the Cloud KMS API", async () => {
    const provider = new CloudKmsProvider({ endpoint, token: "test-service-token" });
    const encrypted = Buffer.from("my-data-encryption-key");
    const result = await provider.unwrap(
      "arn:aws:kms:us-east-1:123456:key/test-key",
      encrypted,
      "SYMMETRIC_DEFAULT",
    );
    // Mock server returns ciphertext as-is (identity transform)
    expect(result).toEqual(encrypted);
  });

  it("unwrap() sends correct request shape", async () => {
    const provider = new CloudKmsProvider({ endpoint, token: "test-service-token" });
    const dek = Buffer.from("test-dek-bytes");
    const result = await provider.unwrap(
      "arn:aws:kms:us-east-1:123:key/abc",
      dek,
      "SYMMETRIC_DEFAULT",
    );
    expect(result).toEqual(dek);
  });

  it("throws on bad token", async () => {
    const provider = new CloudKmsProvider({ endpoint, token: "wrong-token" });
    await expect(
      provider.unwrap("arn:...", Buffer.from("data"), "SYMMETRIC_DEFAULT"),
    ).rejects.toThrow("Authentication failed");
  });
});
