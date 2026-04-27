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

const mockAgeResolveKey = jest.fn<string, [string | undefined, string | undefined]>();
const mockArtifactDecrypt = jest.fn<
  Promise<{
    values: Record<string, Record<string, string>>;
    keys: string[];
    revision: string;
  }>,
  [unknown]
>();
jest.mock("@clef-sh/runtime", () => ({
  AgeDecryptor: jest.fn().mockImplementation(() => ({
    resolveKey: mockAgeResolveKey,
  })),
  ArtifactDecryptor: jest.fn().mockImplementation(() => ({
    decrypt: mockArtifactDecrypt,
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

// Decryptor returns nested namespace → key → value (the on-the-wire payload
// shape). The envelope debugger flattens to `<namespace>__<key>` for display.
const FAKE_NESTED = {
  app: { DB_URL: "postgres://prod", REDIS_URL: "redis://prod", API_KEY: "sk-123" },
};
const FAKE_FLAT_KEYS = ["app__DB_URL", "app__REDIS_URL", "app__API_KEY"];

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
  mockArtifactDecrypt.mockResolvedValue({
    values: FAKE_NESTED,
    keys: FAKE_FLAT_KEYS,
    revision: "test-revision",
  });
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
    // Sorted, qualified-form keys
    expect(prints).toMatch(/app__API_KEY[\s\S]*app__DB_URL[\s\S]*app__REDIS_URL/);
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
    expect(payload.keys).toEqual(["app__API_KEY", "app__DB_URL", "app__REDIS_URL"]);
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
    expect(prints).toContain("app__DB_URL=postgres://prod");
    expect(prints).toContain("app__API_KEY=sk-123");
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
    expect(payload.values).toEqual({
      app__DB_URL: "postgres://prod",
      app__REDIS_URL: "redis://prod",
      app__API_KEY: "sk-123",
    });
  });

  it("quote-escapes values with special characters in KEY=value output", async () => {
    const specials = {
      SIMPLE: "abc",
      QUOTED: "has spaces",
      WITH_EQ: "a=b",
      // Backslashes must double-escape so the output round-trips through a
      // shell-style parser without `\b` etc. being interpreted as escape codes.
      WITH_BACKSLASH: "C:\\path\\to\\thing",
      WITH_QUOTE_AND_BACKSLASH: 'a"b\\c',
    };
    mockArtifactDecrypt.mockResolvedValue({
      values: { app: specials },
      keys: Object.keys(specials).map((k) => `app__${k}`),
      revision: "test-revision",
    });
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
    expect(prints).toContain("app__SIMPLE=abc");
    expect(prints).toContain('app__QUOTED="has spaces"');
    expect(prints).toContain('app__WITH_EQ="a=b"');
    expect(prints).toContain('app__WITH_BACKSLASH="C:\\\\path\\\\to\\\\thing"');
    expect(prints).toContain('app__WITH_QUOTE_AND_BACKSLASH="a\\"b\\\\c"');
  });
});

// ── --key <name> (narrow disclosure) ──────────────────────────────────────

describe("clef envelope decrypt — --key <name>", () => {
  it("emits only the named key's value, in --json mode", async () => {
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
      "--key",
      "app__DB_URL",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.revealed).toBe(true);
    expect(payload.values).toEqual({ app__DB_URL: "postgres://prod" });
    // Other keys are listed but not disclosed
    expect(payload.keys).toContain("app__API_KEY");
    expect(payload.keys).toContain("app__REDIS_URL");
  });

  it("emits only the named key's KEY=value in human mode", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--key",
      "app__DB_URL",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("app__DB_URL=postgres://prod");
    // Other values must NOT leak
    expect(prints).not.toContain("sk-123");
    expect(prints).not.toContain("redis://prod");
  });

  it("emits a key-named reveal warning to stderr", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--key",
      "app__DB_URL",
      "envelope.json",
    ]);

    const stderrWrites = mockStderrWrite.mock.calls.map((c) => c[0]?.toString() ?? "").join("");
    expect(stderrWrites).toContain('value for key "app__DB_URL" will be printed');
    // Should NOT use the all-values phrasing
    expect(stderrWrites).not.toContain("plaintext will be printed to stdout");
  });

  it("exits 4 when --key names a key that isn't in the payload", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "decrypt",
      "--identity",
      "/fake/key.txt",
      "--key",
      "NOT_A_REAL_KEY",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(4);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("unknown_key");
    expect(msg).toContain("NOT_A_REAL_KEY");
  });

  it("exits 1 when --reveal and --key are combined (mutually exclusive)", async () => {
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
      "--key",
      "app__DB_URL",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("mutually exclusive");
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
    mockArtifactDecrypt.mockRejectedValue(
      new Error("no identity matched any of the file's recipients"),
    );
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
});

// ── KMS envelope path ─────────────────────────────────────────────────────

describe("clef envelope decrypt — KMS envelope path", () => {
  function makeKmsArtifact(): PackedArtifact {
    return makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "aXY=",
        authTag: "YXV0aA==",
      },
    });
  }

  it("decrypts KMS envelopes without requiring an age identity", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeKmsArtifact()) });

    const program = makeProgram();
    // No --identity, no CLEF_AGE_* env — should still succeed for KMS
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    // ArtifactDecryptor was invoked with the parsed artifact
    expect(mockArtifactDecrypt).toHaveBeenCalledTimes(1);
    const passed = mockArtifactDecrypt.mock.calls[0][0] as PackedArtifact;
    expect(passed.envelope?.provider).toBe("aws");
    // Age identity resolution was NOT attempted for the KMS path
    expect(mockAgeResolveKey).not.toHaveBeenCalled();
  });

  it("exits 4 on KMS unwrap failure", async () => {
    mockArtifactDecrypt.mockRejectedValue(new Error("kms:Decrypt AccessDenied"));
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeKmsArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(4);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("decrypt_failed");
    expect(msg).toContain("AccessDenied");
  });

  it("still hard-fails on hash mismatch for KMS envelopes (before KMS call)", async () => {
    const bad: PackedArtifact = { ...makeKmsArtifact(), ciphertextHash: "deadbeef".repeat(8) };
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(bad) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(2);
    // KMS decrypt should not have been attempted
    expect(mockArtifactDecrypt).not.toHaveBeenCalled();
  });

  it("revealed values for KMS envelopes still emit the reveal warning", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeKmsArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", "--reveal", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const stderrWrites = mockStderrWrite.mock.calls.map((c) => c[0]?.toString() ?? "").join("");
    expect(stderrWrites).toMatch(/^WARNING: plaintext will be printed/);
  });
});
