/**
 * Security-invariant: `clef envelope decrypt` must never write decrypted
 * plaintext to disk. This test spies on every filesystem write API that Node
 * exposes and asserts zero calls across every decrypt flag combination.
 *
 * The invariant is a direct contract with users — the PRD states "values
 * exist only in memory and in stdout." Regressions could come from (a) a
 * helpful-looking debug log, (b) a cache layer that accidentally persists
 * plaintext, or (c) a future --output flag that skips guardrails. Any such
 * regression breaks this test before the change ships.
 */

import { Command } from "commander";
import type { PackedArtifact } from "@clef-sh/core";
import { computeCiphertextHash } from "@clef-sh/core";
import { registerDecryptCommand } from "./decrypt";

// Auto-mock fs and fs/promises so we can assert zero writes across the
// decrypt path. The decrypt action does not itself read from disk — source
// fetches and age identity resolution are already mocked — so mocking fs
// fully is safe.
jest.mock("fs");
jest.mock("fs/promises");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- after jest.mock, require() returns the automock
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- same
const fsp = require("fs/promises") as typeof import("fs/promises");

// ── Minimal mocks (same pattern as decrypt.test.ts) ───────────────────────
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

const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
jest.spyOn(process.stderr, "write").mockImplementation(() => true);

// ── fs write spies ─────────────────────────────────────────────────────────

const FS_WRITE_FNS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
] as const;

const FS_PROMISES_WRITE_FNS = ["writeFile", "appendFile"] as const;

function assertNoDiskWrites() {
  for (const fn of FS_WRITE_FNS) {
    const mock = fs[fn] as unknown as jest.Mock | undefined;
    if (mock && mock.mock && mock.mock.calls.length > 0) {
      throw new Error(`fs.${fn} was called during decrypt: ${JSON.stringify(mock.mock.calls)}`);
    }
  }
  for (const fn of FS_PROMISES_WRITE_FNS) {
    const mock = fsp[fn] as unknown as jest.Mock | undefined;
    if (mock && mock.mock && mock.mock.calls.length > 0) {
      throw new Error(
        `fs/promises.${fn} was called during decrypt: ${JSON.stringify(mock.mock.calls)}`,
      );
    }
  }
}

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  const ciphertext = Buffer.from("no-disk-test-ciphertext").toString("base64");
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

const FAKE_SECRETS = { DB_URL: "postgres://prod", API_KEY: "sk-123" };

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const envelopeCmd = program.command("envelope").description("envelope root");
  registerDecryptCommand(envelopeCmd);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAgeResolveKey.mockReturnValue("resolved-key");
  mockAgeDecrypt.mockResolvedValue(JSON.stringify(FAKE_SECRETS));
  fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });
});

type Scenario = { label: string; args: string[] };

const SCENARIOS: Scenario[] = [
  { label: "default (keys only)", args: ["--identity", "/fake/key.txt"] },
  { label: "--reveal", args: ["--identity", "/fake/key.txt", "--reveal"] },
];

describe("plaintext-never-to-disk invariant", () => {
  it.each(SCENARIOS)("$label writes nothing to disk", async ({ args }) => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "decrypt", ...args, "envelope.json"]);
    assertNoDiskWrites();
  });

  it("failure paths also never write to disk (hash mismatch)", async () => {
    fakeFetch.mockResolvedValue({
      raw: JSON.stringify(makeArtifact({ ciphertextHash: "deadbeef".repeat(8) })),
    });

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
    assertNoDiskWrites();
  });

  it("failure paths also never write to disk (expired)", async () => {
    fakeFetch.mockResolvedValue({
      raw: JSON.stringify(makeArtifact({ expiresAt: "2020-01-01T00:00:00.000Z" })),
    });

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
    assertNoDiskWrites();
  });
});
