import * as fs from "fs";
import * as path from "path";
import express from "express";
import request from "supertest";
import { createApiRouter } from "./api";
import { SubprocessRunner } from "@clef-sh/core";
import type { PackedArtifact } from "@clef-sh/core";

// ──────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────

// The UI server resolves @clef-sh/core from source (jest config). We mock
// `fs` just like api.test.ts — the manifest loader reads it synchronously
// and we short-circuit that with validManifestYaml below. For envelope
// tests, fs is only touched by (a) manifest load and (b) envelope/config
// reading ~/.aws/credentials — both handled explicitly.
jest.mock("fs");

// Control the age Decrypter per test. `mockAgeDecrypt` returns the
// plaintext JSON for the decrypt path; `mockAddIdentity` lets tests assert
// which private key was handed to the decrypter (used by the precedence
// regression test — we need to know whether env or deps won).
const mockAgeDecrypt = jest.fn<Promise<string>, [Uint8Array, string]>();
const mockAddIdentity = jest.fn<void, [string]>();
jest.mock("age-encryption", () => ({
  Decrypter: jest.fn().mockImplementation(() => ({
    addIdentity: (identity: string) => mockAddIdentity(identity),
    decrypt: (ciphertext: Uint8Array, _format: string) => mockAgeDecrypt(ciphertext, _format),
  })),
  Encrypter: jest.fn(),
  generateIdentity: jest.fn(),
  identityToRecipient: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// Minimal manifest so the rest of createApiRouter does not blow up when
// it wires unrelated routes. Envelope tests never hit those.
const validManifestYaml = `version: 1
environments:
  - { name: dev }
namespaces:
  - { name: database }
sops:
  default_backend: age
file_pattern: "{namespace}/{environment}.enc.yaml"
`;

function makeRunner(): SubprocessRunner {
  return { run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }) };
}

function createApp(opts?: { ageKeyFile?: string; ageKey?: string }): express.Express {
  // Default fs behavior: manifest loads, AWS credentials file absent.
  mockFs.readFileSync.mockImplementation((p) => {
    if (String(p).endsWith("clef.yaml")) return validManifestYaml;
    throw new Error(`unexpected readFileSync(${String(p)})`);
  });
  mockFs.existsSync.mockImplementation(() => false);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api",
    createApiRouter({
      runner: makeRunner(),
      repoRoot: "/repo",
      sopsPath: "sops",
      ageKeyFile: opts?.ageKeyFile,
      ageKey: opts?.ageKey,
    }),
  );
  return app;
}

// ──────────────────────────────────────────────────────────────────────
// Test fixtures — reuse the same base artifact the core parity tests use.
// ──────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();
const CIPHERTEXT = "ZmFrZS1hZ2UtY2lwaGVydGV4dC1mb3ItdGVzdGluZw==";
const CIPHERTEXT_HASH = "b555077dd41b180ebae2c2fc96665cebe1b9c164ca418c2b132786fdbec267fb";

function baseArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "aws-lambda",
    environment: "dev",
    packedAt: "2026-04-23T06:00:00.000Z",
    revision: "1776880279983-24310ee5",
    ciphertext: CIPHERTEXT,
    ciphertextHash: CIPHERTEXT_HASH,
    ...overrides,
  };
}

const FIXTURE_DIR = path.join(
  __dirname,
  "../../../core/src/envelope-debug/__fixtures__/envelope-snapshots",
);

function readFixture(name: string): Record<string, unknown> {
  const raw = jest
    .requireActual<typeof import("fs")>("fs")
    .readFileSync(path.join(FIXTURE_DIR, name), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// The fixtures pin `source: "envelope.json"` (CLI's label). The UI server
// always emits `source: "paste"` — rebind for parity comparison.
function asPaste(fixture: Record<string, unknown>): Record<string, unknown> {
  return { ...fixture, source: "paste" };
}

// ──────────────────────────────────────────────────────────────────────

describe("envelope UI server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_ROLE_ARN;
    delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  });

  // ── /envelope/inspect ────────────────────────────────────────────────
  describe("POST /api/envelope/inspect", () => {
    it("returns the fixture shape for a valid age-only artifact", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/envelope/inspect")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("inspect.age-only.json")));
    });

    it("returns the fixture shape for a signed KMS artifact", async () => {
      const app = createApp();
      const artifact = baseArtifact({
        expiresAt: "2026-04-30T06:00:00.000Z",
        envelope: {
          provider: "aws",
          keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
          wrappedKey: "d3JhcHBlZA==",
          algorithm: "SYMMETRIC_DEFAULT",
          iv: "dGVzdC1pdg==",
          authTag: "dGVzdC1hdXRo",
        },
        signature: "dGVzdC1zaWc=",
        signatureAlgorithm: "Ed25519",
      });
      const res = await request(app)
        .post("/api/envelope/inspect")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("inspect.kms.json")));
    });

    it("flags a tampered hash in-band", async () => {
      const app = createApp();
      const artifact = baseArtifact({ ciphertextHash: "deadbeef".repeat(8) });
      const res = await request(app)
        .post("/api/envelope/inspect")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body.ciphertextHashVerified).toBe(false);
      expect(res.body).toEqual(asPaste(readFixture("inspect.hash-mismatch.json")));
    });

    it("reports parse_failed for malformed JSON", async () => {
      const app = createApp();
      const res = await request(app).post("/api/envelope/inspect").send({ raw: "not-json{" });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "parse_failed" });
      expect(res.body.source).toBe("paste");
    });

    it("reports invalid_artifact when not an envelope", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/envelope/inspect")
        .send({ raw: JSON.stringify({ hello: "world" }) });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "invalid_artifact" });
    });

    it("returns 400 when raw is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/envelope/inspect").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("sets Cache-Control: no-store", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/envelope/inspect")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // ── /envelope/verify ─────────────────────────────────────────────────
  describe("POST /api/envelope/verify", () => {
    it("reports not_verified when a signed artifact has no signer key", async () => {
      const app = createApp();
      const artifact = baseArtifact({
        signature: "dGVzdC1zaWc=",
        signatureAlgorithm: "Ed25519",
      });
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("verify.no-signer-key.json")));
    });

    it("reports hash ok / signature absent for an unsigned artifact", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.status).toBe(200);
      expect(res.body.checks.hash.status).toBe("ok");
      expect(res.body.checks.signature.status).toBe("absent");
      expect(res.body.overall).toBe("pass");
    });

    it("reports hash mismatch in the verify result", async () => {
      const app = createApp();
      const artifact = baseArtifact({ ciphertextHash: "deadbeef".repeat(8) });
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body.checks.hash.status).toBe("mismatch");
      expect(res.body.overall).toBe("fail");
    });

    it("reports signer_key_invalid when the pasted key is malformed", async () => {
      const app = createApp();
      const artifact = baseArtifact({
        signature: "dGVzdC1zaWc=",
        signatureAlgorithm: "Ed25519",
      });
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(artifact), signerKey: "totally not a key" });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "signer_key_invalid" });
    });

    it("does NOT treat a file path as a signer key (D4: paste-only)", async () => {
      // This path exists on the developer's machine during test runs, but
      // the UI server MUST NOT open it. We assert the error is a parse
      // failure, not a successful file read — plus fs.statSync is never
      // called during the verify handler.
      const statSpy = jest.spyOn(jest.requireActual("fs"), "statSync");
      const app = createApp();
      const artifact = baseArtifact({
        signature: "dGVzdC1zaWc=",
        signatureAlgorithm: "Ed25519",
      });
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(artifact), signerKey: "/etc/hosts" });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "signer_key_invalid" });
      expect(statSpy).not.toHaveBeenCalled();
    });

    it("sets Cache-Control: no-store", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/envelope/verify")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // ── /envelope/decrypt ────────────────────────────────────────────────
  describe("POST /api/envelope/decrypt", () => {
    const DECRYPT_PAYLOAD = JSON.stringify({
      DB_URL: "postgres://prod",
      REDIS_URL: "redis://prod",
      API_KEY: "sk-123",
    });

    it("returns keys-only (values: null) by default", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("decrypt.keys-only.json")));
    });

    it("returns all values when reveal: true", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()), reveal: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("decrypt.revealed.json")));
    });

    it("returns a single value when key is set", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()), key: "DB_URL" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(asPaste(readFixture("decrypt.single-key.json")));
    });

    it("reports unknown_key when key is not in the payload", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()), key: "NOT_THERE" });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "unknown_key" });
    });

    it("rejects reveal + key together (mutually exclusive)", async () => {
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()), reveal: true, key: "DB_URL" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("reports key_resolution_failed when no age identity is configured", async () => {
      const app = createApp(); // no ageKey/ageKeyFile, no env vars
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "key_resolution_failed" });
    });

    // Regression: the CLI's resolveAgeCredential puts the OS keychain ahead
    // of env vars, so an operator who sets CLEF_AGE_KEY to debug a
    // service-identity-packed envelope would get their keychain key instead.
    // The debugger deliberately flips precedence so env vars win over deps.
    it("CLEF_AGE_KEY overrides deps.ageKey (keychain) when both are set", async () => {
      process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-1FROMENV";
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);

      const app = createApp({ ageKey: "AGE-SECRET-KEY-1FROMKEYCHAIN" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()) });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      // The Decrypter was configured with the env-var identity, not the
      // keychain-sourced one — that's the whole point of the override.
      expect(mockAddIdentity).toHaveBeenCalledWith("AGE-SECRET-KEY-1FROMENV");
      expect(mockAddIdentity).not.toHaveBeenCalledWith("AGE-SECRET-KEY-1FROMKEYCHAIN");
    });

    it("reports hash_mismatch on tampered ciphertext hash", async () => {
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const artifact = baseArtifact({ ciphertextHash: "deadbeef".repeat(8) });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "hash_mismatch" });
    });

    it("reports expired on past expiresAt", async () => {
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const artifact = baseArtifact({ expiresAt: "2026-04-01T00:00:00.000Z" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(artifact) });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "expired" });
    });

    it("reports decrypt_failed when the age library throws", async () => {
      mockAgeDecrypt.mockRejectedValue(new Error("bad key"));
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.status).toBe(200);
      expect(res.body.error).toMatchObject({ code: "decrypt_failed" });
    });

    // Server-side analogue of the CLI `plaintext-never-to-disk` invariant.
    it("never writes plaintext to disk during decrypt", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const writeSpy = jest.spyOn(mockFs, "writeFileSync");
      const writeAsyncSpy = jest.spyOn(mockFs, "writeFile");
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()), reveal: true });
      expect(writeSpy).not.toHaveBeenCalled();
      expect(writeAsyncSpy).not.toHaveBeenCalled();
    });

    it("sets Cache-Control: no-store", async () => {
      mockAgeDecrypt.mockResolvedValue(DECRYPT_PAYLOAD);
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1TEST" });
      const res = await request(app)
        .post("/api/envelope/decrypt")
        .send({ raw: JSON.stringify(baseArtifact()) });
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // ── /envelope/config ─────────────────────────────────────────────────
  describe("GET /api/envelope/config", () => {
    it("reports configured: false when nothing is set", async () => {
      const app = createApp();
      const res = await request(app).get("/api/envelope/config");
      expect(res.status).toBe(200);
      expect(res.body.ageIdentity).toEqual({
        configured: false,
        source: null,
        path: null,
      });
      expect(res.body.aws.hasCredentials).toBe(false);
    });

    it("reports CLEF_AGE_KEY_FILE with path when deps.ageKeyFile is set", async () => {
      const app = createApp({ ageKeyFile: "/home/op/.age/key.txt" });
      const res = await request(app).get("/api/envelope/config");
      expect(res.body.ageIdentity).toEqual({
        configured: true,
        source: "CLEF_AGE_KEY_FILE",
        path: "/home/op/.age/key.txt",
      });
    });

    it("reports CLEF_AGE_KEY without path when an inline key is provided", async () => {
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1INLINE" });
      const res = await request(app).get("/api/envelope/config");
      expect(res.body.ageIdentity).toEqual({
        configured: true,
        source: "CLEF_AGE_KEY",
        path: null,
      });
    });

    it("falls back to env vars when deps are not set", async () => {
      process.env.CLEF_AGE_KEY_FILE = "/env/path/key.txt";
      const app = createApp();
      const res = await request(app).get("/api/envelope/config");
      expect(res.body.ageIdentity).toEqual({
        configured: true,
        source: "CLEF_AGE_KEY_FILE",
        path: "/env/path/key.txt",
      });
    });

    it("env vars take precedence over deps so operators can override the keychain", async () => {
      process.env.CLEF_AGE_KEY_FILE = "/env/override.key";
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1FROMKEYCHAIN" });
      const res = await request(app).get("/api/envelope/config");
      expect(res.body.ageIdentity).toEqual({
        configured: true,
        source: "CLEF_AGE_KEY_FILE",
        path: "/env/override.key",
      });
    });

    it("reports AWS_PROFILE when set", async () => {
      process.env.AWS_PROFILE = "prod-admin";
      const app = createApp();
      const res = await request(app).get("/api/envelope/config");
      expect(res.body.aws).toEqual({ hasCredentials: true, profile: "prod-admin" });
    });

    it("never leaks the actual key material", async () => {
      const app = createApp({ ageKey: "AGE-SECRET-KEY-1VERYSECRETKEY" });
      const res = await request(app).get("/api/envelope/config");
      expect(JSON.stringify(res.body)).not.toContain("VERYSECRETKEY");
    });

    it("sets Cache-Control: no-store", async () => {
      const app = createApp();
      const res = await request(app).get("/api/envelope/config");
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });
});
