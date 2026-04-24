/**
 * Security-invariant: the --reveal warning must emit ONLY AFTER all validation
 * passes (hash, expiry, key resolution, decryption) AND strictly BEFORE the
 * first stdout byte of a revealed value.
 *
 * Two regressions this test protects against:
 *
 *   (1) Warning-without-output: a user runs `--reveal` on an expired envelope,
 *       sees the warning, then the command exits 5 with no value on stdout.
 *       Confusing UX and a training signal that warnings are decorative.
 *
 *   (2) Output-before-warning: if stdout is flushed before stderr, a user who
 *       Ctrl-C's on the warning has already leaked the plaintext. This is the
 *       core reason the warning exists.
 *
 * The test asserts ordering directly via the interleaved spy-call-log technique
 * — it does NOT just check "warning appears somewhere in stderr."
 */

import { Command } from "commander";
import type { PackedArtifact } from "@clef-sh/core";
import { computeCiphertextHash } from "@clef-sh/core";
import { registerDecryptCommand } from "./decrypt";

// ── Mocks (formatter mock NOT called for .print — we spy process.stdout directly) ──
jest.mock("../../output/formatter", () => {
  const mockPrint = jest.fn((s: string) => {
    // Mirror real formatter.print behavior so ordering spy captures it.
    process.stdout.write(s + "\n");
  });
  const mockJson = jest.fn((d: unknown) => {
    process.stdout.write(JSON.stringify(d) + "\n");
  });
  const mockError = jest.fn((msg: string) => {
    process.stderr.write(`error: ${msg}\n`);
  });
  return {
    formatter: {
      print: mockPrint,
      json: mockJson,
      error: mockError,
      success: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      hint: jest.fn(),
      raw: jest.fn(),
      table: jest.fn(),
      confirm: jest.fn(),
      secretPrompt: jest.fn(),
      formatDependencyError: jest.fn(),
    },
    isJsonMode: jest.fn().mockReturnValue(false),
    setJsonMode: jest.fn(),
    setYesMode: jest.fn(),
  };
});

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

const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

// Interleaved call log — every stdout/stderr write lands here in order.
const writeLog: Array<{ stream: "stdout" | "stderr"; payload: string }> = [];
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  jest.clearAllMocks();
  writeLog.length = 0;
  mockAgeResolveKey.mockReturnValue("resolved-key");
  mockAgeDecrypt.mockResolvedValue(JSON.stringify({ DB_URL: "postgres://prod" }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test spy replaces process.std{out,err}.write
  (process.stdout.write as any) = jest.fn((chunk: string | Uint8Array) => {
    writeLog.push({ stream: "stdout", payload: chunk.toString() });
    return true;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test spy
  (process.stderr.write as any) = jest.fn((chunk: string | Uint8Array) => {
    writeLog.push({ stream: "stderr", payload: chunk.toString() });
    return true;
  });
});

afterEach(() => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
});

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  const ciphertext = Buffer.from("ordering-test-ciphertext").toString("base64");
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

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const envelopeCmd = program.command("envelope").description("envelope root");
  registerDecryptCommand(envelopeCmd);
  return program;
}

describe("reveal-warning ordering invariant", () => {
  it("(1) does NOT emit the warning when decryption fails validation (expired + --reveal)", async () => {
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
      "--reveal",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(5);
    const stderrContent = writeLog
      .filter((w) => w.stream === "stderr")
      .map((w) => w.payload)
      .join("");
    expect(stderrContent).not.toContain("WARNING: plaintext");
    // The error itself is allowed and expected on stderr.
    expect(stderrContent).toContain("expired");
  });

  it("(1a) does NOT emit the warning on hash mismatch + --reveal", async () => {
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
      "--reveal",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(2);
    const stderrContent = writeLog
      .filter((w) => w.stream === "stderr")
      .map((w) => w.payload)
      .join("");
    expect(stderrContent).not.toContain("WARNING: plaintext");
  });

  it("(1b) does NOT emit the warning when age decryption fails + --reveal", async () => {
    mockAgeDecrypt.mockRejectedValue(new Error("no identity matched"));
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

    expect(mockExit).toHaveBeenCalledWith(4);
    const stderrContent = writeLog
      .filter((w) => w.stream === "stderr")
      .map((w) => w.payload)
      .join("");
    expect(stderrContent).not.toContain("WARNING: plaintext");
  });

  it("(2) emits the warning STRICTLY BEFORE the first stdout byte on the happy path", async () => {
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

    const firstWarningIdx = writeLog.findIndex(
      (w) => w.stream === "stderr" && w.payload.includes("WARNING: plaintext"),
    );
    const firstStdoutIdx = writeLog.findIndex((w) => w.stream === "stdout" && w.payload.length > 0);

    expect(firstWarningIdx).toBeGreaterThanOrEqual(0);
    expect(firstStdoutIdx).toBeGreaterThanOrEqual(0);
    expect(firstWarningIdx).toBeLessThan(firstStdoutIdx);
  });

  it("(3) does NOT emit the warning when --reveal is absent", async () => {
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
    const stderrContent = writeLog
      .filter((w) => w.stream === "stderr")
      .map((w) => w.payload)
      .join("");
    expect(stderrContent).not.toContain("WARNING");
  });
});
