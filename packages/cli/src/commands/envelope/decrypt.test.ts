import { Command } from "commander";
import type { PackedArtifact } from "@clef-sh/core";
import { computeCiphertextHash } from "@clef-sh/core";
import { registerDecryptCommand } from "./decrypt";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("../../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    hint: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    table: jest.fn(),
    confirm: jest.fn(),
    secretPrompt: jest.fn(),
    formatDependencyError: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const fakeFetch = jest.fn<Promise<{ raw: string }>, []>();
jest.mock("./source", () => ({
  resolveSource: jest.fn(() => ({
    fetch: fakeFetch,
    describe: () => "FakeSource",
  })),
}));

const mockAgeDecrypt = jest.fn<Promise<string>, [string, string]>();
const mockAgeResolveKey = jest.fn<string, [string | undefined, string | undefined]>();
jest.mock("@clef-sh/runtime", () => ({
  AgeDecryptor: jest.fn().mockImplementation(() => ({
    decrypt: mockAgeDecrypt,
    resolveKey: mockAgeResolveKey,
  })),
}));

import { formatter, isJsonMode } from "../../output/formatter";

const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockStderrWrite = jest.spyOn(process.stderr, "write").mockImplementation(() => true);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  const ciphertext = Buffer.from("fake-age-ciphertext-for-decrypt").toString("base64");
  return {
    version: 1,
    identity: "aws-lambda",
    environment: "dev",
    packedAt: "2026-04-23T06:00:00.000Z",
    revision: "1776880279983-24310ee5",
    ciphertext,
    ciphertextHash: computeCiphertextHash(ciphertext),
    ...overrides,
  };
}

const FAKE_SECRETS = { DB_URL: "postgres://prod", REDIS_URL: "redis://prod", API_KEY: "sk-123" };

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const envelopeCmd = program.command("envelope").description("envelope root");
  registerDecryptCommand(envelopeCmd);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  (isJsonMode as jest.Mock).mockReturnValue(false);
  mockAgeDecrypt.mockResolvedValue(JSON.stringify(FAKE_SECRETS));
  mockAgeResolveKey.mockImplementation((inline, file) => {
    if (inline) return inline.trim();
    if (file) return `resolved-from-file:${file}`;
    throw new Error("No age key available. Set CLEF_AGE_KEY or CLEF_AGE_KEY_FILE.");
  });
  delete process.env.CLEF_AGE_KEY;
  delete process.env.CLEF_AGE_KEY_FILE;
});

// ── Default output: keys only, no reveal ──────────────────────────────────

describe("clef envelope decrypt — default (keys only)", () => {
  it("prints sorted key names, never values, exit 0", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    // Sorted
    expect(prints).toMatch(/API_KEY[\s\S]*DB_URL[\s\S]*REDIS_URL/);
    // No values
    expect(prints).not.toContain("postgres://prod");
    expect(prints).not.toContain("sk-123");
  });

  it("does NOT emit a reveal warning when not revealing", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    const stderrWrites = mockStderrWrite.mock.calls.map((c) => c[0]?.toString() ?? "").join("");
    expect(stderrWrites).not.toContain("WARNING");
  });

  it("emits a full DecryptResult in --json mode with values=null", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.revealed).toBe(false);
    expect(payload.values).toBeNull();
    expect(payload.keys).toEqual(["API_KEY", "DB_URL", "REDIS_URL"]);
    expect(payload.status).toBe("ok");
  });
});

// ── --reveal ───────────────────────────────────────────────────────────────

describe("clef envelope decrypt — --reveal", () => {
  it("prints KEY=value lines in human mode", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--reveal",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("DB_URL=postgres://prod");
    expect(prints).toContain("API_KEY=sk-123");
  });

  it("emits the canonical reveal warning to stderr before stdout", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--reveal",
      "envelope.json",
    ]);

    const stderrWrites = mockStderrWrite.mock.calls.map((c) => c[0]?.toString() ?? "").join("");
    expect(stderrWrites).toMatch(/^WARNING: plaintext will be printed/);
  });

  it("emits values in --json mode when --reveal is on", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--reveal",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.revealed).toBe(true);
    expect(payload.values).toEqual(FAKE_SECRETS);
  });

  it("quote-escapes values with special characters in KEY=value output", async () => {
    mockAgeDecrypt.mockResolvedValue(
      JSON.stringify({ SIMPLE: "abc", QUOTED: "has spaces", WITH_EQ: "a=b" }),
    );
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--reveal",
      "envelope.json",
    ]);

    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("SIMPLE=abc");
    expect(prints).toContain('QUOTED="has spaces"');
    expect(prints).toContain('WITH_EQ="a=b"');
  });
});

// ── Key resolution precedence ─────────────────────────────────────────────

describe("clef envelope decrypt — key resolution precedence", () => {
  it("prefers --identity over env vars", async () => {
    process.env.CLEF_AGE_KEY_FILE = "/from/env/file";
    process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-FROMENV";
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/flag/key.txt",
      "envelope.json",
    ]);

    expect(mockAgeResolveKey).toHaveBeenCalledWith(undefined, "/fake/flag/key.txt");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("falls back to CLEF_AGE_KEY_FILE when no --identity", async () => {
    process.env.CLEF_AGE_KEY_FILE = "/from/env/file";
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockAgeResolveKey).toHaveBeenCalledWith(undefined, "/from/env/file");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("falls back to CLEF_AGE_KEY inline when neither flag nor KEY_FILE", async () => {
    process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-FROMENV";
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockAgeResolveKey).toHaveBeenCalledWith("AGE-SECRET-KEY-FROMENV");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 4 when no identity is configured anywhere", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(4);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("key_resolution_failed");
    expect(msg).toContain("CLEF_AGE_KEY");
  });
});

// ── Validation failure exit codes ─────────────────────────────────────────

describe("clef envelope decrypt — validation and failure exit codes", () => {
  it("exits 2 on ciphertext hash mismatch", async () => {
    const bad = makeArtifact({ ciphertextHash: "deadbeef".repeat(8) });
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(bad) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(2);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("hash_mismatch");
  });

  it("exits 5 on expired artifact (hard-fail)", async () => {
    const expired = makeArtifact({ expiresAt: "2020-01-01T00:00:00.000Z" });
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(expired) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(5);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("expired");
  });

  it("exits 5 on revoked artifact", async () => {
    const revoked = makeArtifact({ revokedAt: "2026-04-20T00:00:00.000Z" });
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(revoked) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(5);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("revoked");
  });

  it("exits 4 on decrypt failure (e.g. wrong key)", async () => {
    mockAgeDecrypt.mockRejectedValue(new Error("no identity matched any of the file's recipients"));
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/wrong.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(4);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("decrypt_failed");
  });

  it("exits 1 on source fetch failure", async () => {
    fakeFetch.mockRejectedValue(new Error("connection refused"));

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 on malformed JSON", async () => {
    fakeFetch.mockResolvedValue({ raw: "{not-json" });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 on non-PackedArtifact JSON", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify({ nope: true }) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("refuses KMS envelopes in PR 4 (unsupported_envelope until PR 5)", async () => {
    const kms = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:test",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "aXY=",
        authTag: "YXV0aA==",
      },
    });
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(kms) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("unsupported_envelope");
  });
});
