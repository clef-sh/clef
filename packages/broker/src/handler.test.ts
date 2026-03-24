import { createHandler } from "./handler";
import type { BrokerHandler, LogFn } from "./types";

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

function mockHandler(overrides?: Partial<BrokerHandler>): BrokerHandler {
  return {
    create: jest.fn().mockResolvedValue({
      data: { TOKEN: "secret-token" },
      ttl: 900,
      entityId: "entity-1",
    }),
    ...overrides,
  };
}

describe("createHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEnv();
  });

  afterEach(clearEnv);

  it("returns a BrokerInvoker with invoke and shutdown", () => {
    const broker = createHandler(mockHandler());
    expect(typeof broker.invoke).toBe("function");
    expect(typeof broker.shutdown).toBe("function");
  });

  it("invoke() returns a valid envelope response", async () => {
    const broker = createHandler(mockHandler());
    const res = await broker.invoke();

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Cache-Control"]).toBe("no-store");

    const artifact = JSON.parse(res.body);
    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("test-svc");
    expect(artifact.environment).toBe("test");
    expect(artifact.ciphertext).toBeTruthy();
    expect(artifact.envelope).toBeDefined();
    expect(artifact.keys).toEqual(["TOKEN"]);
    expect(artifact.expiresAt).toBeTruthy();
  });

  it("caches the envelope — create called once for rapid invocations", async () => {
    const handler = mockHandler();
    const broker = createHandler(handler);

    await broker.invoke();
    await broker.invoke();

    expect(handler.create).toHaveBeenCalledTimes(1);
  });

  it("refreshes cache after 80% of TTL", async () => {
    const handler = mockHandler();
    const broker = createHandler(handler);

    await broker.invoke();
    expect(handler.create).toHaveBeenCalledTimes(1);

    const origNow = Date.now;
    Date.now = jest.fn().mockReturnValue(origNow() + 721_000);
    try {
      await broker.invoke();
      expect(handler.create).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = origNow;
    }
  });

  it("calls revoke on cache refresh when handler supports it", async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const handler = mockHandler({ revoke });
    const broker = createHandler(handler);

    await broker.invoke();
    expect(revoke).not.toHaveBeenCalled();

    const origNow = Date.now;
    Date.now = jest.fn().mockReturnValue(origNow() + 721_000);
    try {
      await broker.invoke();
      expect(revoke).toHaveBeenCalledWith("entity-1", expect.any(Object));
    } finally {
      Date.now = origNow;
    }
  });

  it("returns 500 when handler.create throws", async () => {
    const handler = mockHandler({
      create: jest.fn().mockRejectedValue(new Error("credential generation failed")),
    });
    const broker = createHandler(handler);

    const res = await broker.invoke();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain("credential generation failed");
  });

  it("concurrent invocations share a single create() call", async () => {
    let resolveCreate: ((v: { data: Record<string, string>; ttl: number }) => void) | undefined;
    const handler = mockHandler({
      create: jest.fn().mockImplementation(
        () =>
          new Promise((res) => {
            resolveCreate = res;
          }),
      ),
    });
    const broker = createHandler(handler);

    const p1 = broker.invoke();
    const p2 = broker.invoke();

    await new Promise((r) => setTimeout(r, 10));
    resolveCreate!({ data: { KEY: "val" }, ttl: 900 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(handler.create).toHaveBeenCalledTimes(1);
  });

  it("calls validateConnection on first invocation only", async () => {
    const validateConnection = jest.fn().mockResolvedValue(true);
    const handler = mockHandler({ validateConnection });
    const broker = createHandler(handler);

    await broker.invoke();
    expect(validateConnection).toHaveBeenCalledTimes(1);

    await broker.invoke();
    expect(validateConnection).toHaveBeenCalledTimes(1);
  });

  it("returns 500 if validateConnection returns false", async () => {
    const handler = mockHandler({
      validateConnection: jest.fn().mockResolvedValue(false),
    });
    const broker = createHandler(handler);

    const res = await broker.invoke();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain("validateConnection");
  });

  it("accepts explicit options overriding env vars", async () => {
    const broker = createHandler(mockHandler(), {
      identity: "custom-svc",
      environment: "staging",
    });

    const res = await broker.invoke();
    const artifact = JSON.parse(res.body);
    expect(artifact.identity).toBe("custom-svc");
    expect(artifact.environment).toBe("staging");
  });

  it("passes handlerConfig from CLEF_BROKER_HANDLER_* env vars", async () => {
    process.env.CLEF_BROKER_HANDLER_DB_HOST = "rds.example.com";
    const handler = mockHandler();
    const broker = createHandler(handler);

    await broker.invoke();
    expect(handler.create).toHaveBeenCalledWith(
      expect.objectContaining({ DB_HOST: "rds.example.com" }),
    );

    delete process.env.CLEF_BROKER_HANDLER_DB_HOST;
  });

  it("swallows revoke errors without affecting the response", async () => {
    const revoke = jest.fn().mockRejectedValue(new Error("revoke failed"));
    const handler = mockHandler({ revoke });
    const broker = createHandler(handler);

    await broker.invoke();

    const origNow = Date.now;
    Date.now = jest.fn().mockReturnValue(origNow() + 721_000);
    try {
      const res = await broker.invoke();
      expect(res.statusCode).toBe(200);
      expect(revoke).toHaveBeenCalled();
    } finally {
      Date.now = origNow;
    }
  });

  // ── shutdown() ───────────────────────────────────────────────────────────

  describe("shutdown", () => {
    it("calls revoke on the active credential", async () => {
      const revoke = jest.fn().mockResolvedValue(undefined);
      const handler = mockHandler({ revoke });
      const broker = createHandler(handler);

      await broker.invoke();
      await broker.shutdown();

      expect(revoke).toHaveBeenCalledWith("entity-1", expect.any(Object));
    });

    it("does not call revoke when no credential has been generated", async () => {
      const revoke = jest.fn().mockResolvedValue(undefined);
      const handler = mockHandler({ revoke });
      const broker = createHandler(handler);

      await broker.shutdown();
      expect(revoke).not.toHaveBeenCalled();
    });

    it("does not call revoke when handler has no revoke method", async () => {
      const handler = mockHandler();
      const broker = createHandler(handler);

      await broker.invoke();
      await broker.shutdown(); // should not throw
    });

    it("swallows revoke errors during shutdown", async () => {
      const revoke = jest.fn().mockRejectedValue(new Error("revoke failed"));
      const handler = mockHandler({ revoke });
      const broker = createHandler(handler);

      await broker.invoke();
      await broker.shutdown(); // should not throw
      expect(revoke).toHaveBeenCalled();
    });
  });

  // ── onLog ────────────────────────────────────────────────────────────────

  describe("onLog structured logging", () => {
    it("calls onLog with level, message, and context on revoke", async () => {
      const onLog = jest.fn() as jest.MockedFunction<LogFn>;
      const revoke = jest.fn().mockResolvedValue(undefined);
      const handler = mockHandler({ revoke });
      const broker = createHandler(handler, { onLog });

      await broker.invoke();
      await broker.shutdown();

      expect(onLog).toHaveBeenCalledWith(
        "info",
        expect.stringContaining("Revoked credential"),
        expect.objectContaining({ entityId: "entity-1" }),
      );
    });

    it("calls onLog with error level on create failure", async () => {
      const onLog = jest.fn() as jest.MockedFunction<LogFn>;
      const handler = mockHandler({
        create: jest.fn().mockRejectedValue(new Error("boom")),
      });
      const broker = createHandler(handler, { onLog });

      await broker.invoke();

      expect(onLog).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Envelope generation failed"),
        expect.objectContaining({ error: "boom" }),
      );
    });

    it("calls onLog with warn level on revoke failure", async () => {
      const onLog = jest.fn() as jest.MockedFunction<LogFn>;
      const revoke = jest.fn().mockRejectedValue(new Error("revoke broke"));
      const handler = mockHandler({ revoke });
      const broker = createHandler(handler, { onLog });

      await broker.invoke();

      const origNow = Date.now;
      Date.now = jest.fn().mockReturnValue(origNow() + 721_000);
      try {
        await broker.invoke();
        expect(onLog).toHaveBeenCalledWith(
          "warn",
          expect.stringContaining("Revoke failed"),
          expect.objectContaining({ entityId: "entity-1", error: "revoke broke" }),
        );
      } finally {
        Date.now = origNow;
      }
    });
  });
});
