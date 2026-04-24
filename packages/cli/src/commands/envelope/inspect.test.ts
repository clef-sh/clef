import { Command } from "commander";
import type { PackedArtifact } from "@clef-sh/core";
import { registerInspectCommand } from "./inspect";

// ── Mock the formatter so we can capture calls ─────────────────────────────
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

// ── Mock resolveSource so tests can inject fixture JSON without real I/O ──
const fakeFetch = jest.fn<Promise<{ raw: string }>, []>();
jest.mock("./source", () => ({
  resolveSource: jest.fn(() => ({
    fetch: fakeFetch,
    describe: () => "FakeSource",
  })),
}));

import { formatter, isJsonMode } from "../../output/formatter";
import { resolveSource } from "./source";

const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

// ── Helpers to build a valid PackedArtifact ────────────────────────────────

async function buildAgeOnlyArtifact(
  overrides: Partial<PackedArtifact> = {},
): Promise<PackedArtifact> {
  // Use the real ArtifactPacker so we get a correct ciphertextHash + ciphertext.
  // We stub the age-encryption step by injecting a fake encryption backend that is
  // never actually called: packer delegates age encryption to a dynamic ESM import
  // of age-encryption. Simpler: build the artifact shape ourselves with a known
  // ciphertext and recompute the hash via the canonical helper.
  const { computeCiphertextHash } = await import("@clef-sh/core");
  const ciphertext = Buffer.from("fake-age-ciphertext-for-testing").toString("base64");
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
  registerInspectCommand(envelopeCmd);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  (isJsonMode as jest.Mock).mockReturnValue(false);
});

describe("clef envelope inspect — single source", () => {
  it("prints every documented field and exits 0", async () => {
    const artifact = await buildAgeOnlyArtifact();
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(artifact) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(resolveSource).toHaveBeenCalledWith("envelope.json");
    expect(mockExit).toHaveBeenCalledWith(0);

    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("version:");
    expect(prints).toContain("identity:");
    expect(prints).toContain("aws-lambda");
    expect(prints).toContain("ciphertextHash:");
    expect(prints).toContain("(verified)");
    expect(prints).toContain("age-only (no KMS wrap)");
  });

  it("prints '(MISMATCH)' on hash mismatch but exits 0 (per D2)", async () => {
    const artifact = await buildAgeOnlyArtifact({ ciphertextHash: "deadbeef".repeat(8) });
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(artifact) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("(MISMATCH)");
  });

  it("emits JSON array when --json mode is enabled", async () => {
    const artifact = await buildAgeOnlyArtifact();
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(artifact) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(formatter.json).toHaveBeenCalledTimes(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
    expect(payload[0].identity).toBe("aws-lambda");
    expect(payload[0].ciphertextHashVerified).toBe(true);
  });
});

describe("clef envelope inspect — error paths", () => {
  it("exits 1 on fetch failure and emits an error entry", async () => {
    fakeFetch.mockRejectedValue(new Error("connection refused"));

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(formatter.error).toHaveBeenCalled();
    const errorMsg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(errorMsg).toContain("fetch_failed");
    expect(errorMsg).toContain("connection refused");
  });

  it("exits 1 on malformed JSON", async () => {
    fakeFetch.mockResolvedValue({ raw: "{not-json" });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const errorMsg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(errorMsg).toContain("parse_failed");
  });

  it("exits 1 on JSON that doesn't match the PackedArtifact shape", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify({ not: "an envelope" }) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const errorMsg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(errorMsg).toContain("invalid_artifact");
  });

  it("emits the error in JSON mode as an in-band entry, not via formatter.error", async () => {
    fakeFetch.mockRejectedValue(new Error("connection refused"));
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(formatter.json).toHaveBeenCalledTimes(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload[0].error).toEqual({
      code: "fetch_failed",
      message: "connection refused",
    });
  });
});

describe("clef envelope inspect — multi-source", () => {
  it("processes sources in order and exits 0 when all succeed", async () => {
    const a = await buildAgeOnlyArtifact({ identity: "first" });
    const b = await buildAgeOnlyArtifact({ identity: "second" });
    fakeFetch
      .mockResolvedValueOnce({ raw: JSON.stringify(a) })
      .mockResolvedValueOnce({ raw: JSON.stringify(b) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "a.json", "b.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0].identity).toBe("first");
    expect(payload[1].identity).toBe("second");
  });

  it("exits 1 when any source fails but still reports the successful ones", async () => {
    const good = await buildAgeOnlyArtifact({ identity: "good" });
    fakeFetch
      .mockResolvedValueOnce({ raw: JSON.stringify(good) })
      .mockRejectedValueOnce(new Error("404 not found"));
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "good.json", "missing.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0].error).toBeNull();
    expect(payload[0].identity).toBe("good");
    expect(payload[1].error).toEqual({
      code: "fetch_failed",
      message: "404 not found",
    });
  });

  it("prints a section header per source in human mode", async () => {
    const a = await buildAgeOnlyArtifact({ identity: "first" });
    const b = await buildAgeOnlyArtifact({ identity: "second" });
    fakeFetch
      .mockResolvedValueOnce({ raw: JSON.stringify(a) })
      .mockResolvedValueOnce({ raw: JSON.stringify(b) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "inspect", "a.json", "b.json"]);

    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(prints.some((p) => p.includes("=== a.json ==="))).toBe(true);
    expect(prints.some((p) => p.includes("=== b.json ==="))).toBe(true);
  });
});
