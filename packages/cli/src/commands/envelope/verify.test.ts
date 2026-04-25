import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Command } from "commander";
import type { PackedArtifact } from "@clef-sh/core";
import { buildSigningPayload, computeCiphertextHash } from "@clef-sh/core";
import { registerVerifyCommand } from "./verify";

// ── Mock formatter and source module ──────────────────────────────────────
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

import { formatter, isJsonMode } from "../../output/formatter";

const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  const ciphertext = Buffer.from("verify-test-ciphertext").toString("base64");
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

function signArtifact(artifact: PackedArtifact): {
  signed: PackedArtifact;
  publicKeyBase64: string;
} {
  const kp = crypto.generateKeyPairSync("ed25519");
  const publicKeyBase64 = (kp.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
    "base64",
  );
  const withAlgo: PackedArtifact = { ...artifact, signatureAlgorithm: "Ed25519" };
  const payload = buildSigningPayload(withAlgo);
  const signature = crypto.sign(null, payload, kp.privateKey).toString("base64");
  return { signed: { ...withAlgo, signature }, publicKeyBase64 };
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const envelopeCmd = program.command("envelope").description("envelope root");
  registerVerifyCommand(envelopeCmd);
  return program;
}

beforeEach(() => {
  jest.clearAllMocks();
  (isJsonMode as jest.Mock).mockReturnValue(false);
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe("clef envelope verify — success cases", () => {
  it("exits 0 and reports PASS for a valid signed artifact", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("overall:");
    expect(prints).toContain("PASS");
    expect(prints).toMatch(/signature:\s+valid/);
  });

  it("exits 0 when signature is present but no --signer-key provided (not_verified)", async () => {
    const { signed } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "verify", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toContain("not verified");
    expect(prints).toContain("PASS");
  });

  it("exits 0 for an unsigned artifact (signature absent)", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(makeArtifact()) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "verify", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const prints = (formatter.print as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n");
    expect(prints).toMatch(/signature:\s+absent/);
  });

  it("emits a full VerifyResult shape in --json mode", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.source).toBe("envelope.json");
    expect(payload.checks.hash.status).toBe("ok");
    expect(payload.checks.signature.status).toBe("valid");
    expect(payload.checks.signature.algorithm).toBe("Ed25519");
    expect(payload.checks.expiry.status).toBe("absent");
    expect(payload.checks.revocation.status).toBe("absent");
    expect(payload.overall).toBe("pass");
    expect(payload.error).toBeNull();
  });

  it("reports expiry but does not fail in v1 (reports-only)", async () => {
    const { signed, publicKeyBase64 } = signArtifact(
      makeArtifact({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.expiry.status).toBe("expired");
    expect(payload.overall).toBe("pass");
  });

  it("reports revocation but does not fail in v1 (reports-only)", async () => {
    const { signed, publicKeyBase64 } = signArtifact(
      makeArtifact({ revokedAt: "2026-04-20T00:00:00.000Z" }),
    );
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.revocation.status).toBe("revoked");
    expect(payload.checks.revocation.revokedAt).toBe("2026-04-20T00:00:00.000Z");
    expect(payload.overall).toBe("pass");
  });
});

// ── Failure paths ─────────────────────────────────────────────────────────

describe("clef envelope verify — failure cases", () => {
  it("exits 2 on ciphertext hash mismatch", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    // Tamper the ciphertext AFTER signing so hash mismatch triggers but signature
    // is still valid for the pre-tamper payload. We ensure hash is the failing check.
    const tampered = { ...signed, ciphertext: "dGFtcGVyZWQ=" };
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(tampered) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(2);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.hash.status).toBe("mismatch");
    expect(payload.overall).toBe("fail");
  });

  it("exits 3 on signature invalid (wrong public key)", async () => {
    const { signed } = signArtifact(makeArtifact());
    const wrongKey = crypto.generateKeyPairSync("ed25519");
    const wrongKeyBase64 = (
      wrongKey.publicKey.export({ type: "spki", format: "der" }) as Buffer
    ).toString("base64");
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      wrongKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(3);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.signature.status).toBe("invalid");
    expect(payload.overall).toBe("fail");
  });

  it("exits 3 on signature invalid (tampered payload)", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    const tampered = { ...signed, revision: "tampered-revision" };
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(tampered) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(3);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.signature.status).toBe("invalid");
  });

  it("prefers hash mismatch exit (2) over signature invalid (3) when both fail", async () => {
    const { signed } = signArtifact(makeArtifact());
    const tampered = { ...signed, ciphertext: "dGFtcGVyZWQ=" }; // changes hash
    const wrongKey = crypto.generateKeyPairSync("ed25519");
    const wrongKeyBase64 = (
      wrongKey.publicKey.export({ type: "spki", format: "der" }) as Buffer
    ).toString("base64");
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(tampered) });

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      wrongKeyBase64,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("exits 1 on source fetch failure", async () => {
    fakeFetch.mockRejectedValue(new Error("404 not found"));

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "verify", "missing.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(formatter.error).toHaveBeenCalled();
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("fetch_failed");
  });

  it("exits 1 on invalid --signer-key", async () => {
    const { signed } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      "completely-bogus-key",
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.error.code).toBe("signer_key_invalid");
  });

  it("exits 1 on malformed JSON", async () => {
    fakeFetch.mockResolvedValue({ raw: "{not-json" });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "verify", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("parse_failed");
  });

  it("exits 1 on non-PackedArtifact JSON", async () => {
    fakeFetch.mockResolvedValue({ raw: JSON.stringify({ nope: true }) });

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "envelope", "verify", "envelope.json"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const msg = (formatter.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain("invalid_artifact");
  });
});

// ── --signer-key-file flag ────────────────────────────────────────────────

describe("clef envelope verify — --signer-key-file", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-verify-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads the public key from a file path and verifies the signature", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    const keyFile = path.join(tmpDir, "signer.b64");
    fs.writeFileSync(keyFile, publicKeyBase64);
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key-file",
      keyFile,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.checks.signature.status).toBe("valid");
  });

  it("exits 1 with signer_key_invalid when the file does not exist", async () => {
    const { signed } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key-file",
      path.join(tmpDir, "does-not-exist.pem"),
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.error.code).toBe("signer_key_invalid");
    expect(payload.error.message).toContain("could not read --signer-key-file");
  });

  it("rejects passing both --signer-key and --signer-key-file", async () => {
    const { signed, publicKeyBase64 } = signArtifact(makeArtifact());
    fakeFetch.mockResolvedValue({ raw: JSON.stringify(signed) });
    const keyFile = path.join(tmpDir, "dup.b64");
    fs.writeFileSync(keyFile, publicKeyBase64);
    (isJsonMode as jest.Mock).mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "envelope",
      "verify",
      "--signer-key",
      publicKeyBase64,
      "--signer-key-file",
      keyFile,
      "envelope.json",
    ]);

    expect(mockExit).toHaveBeenCalledWith(1);
    const payload = (formatter.json as jest.Mock).mock.calls[0][0];
    expect(payload.error.code).toBe("signer_key_invalid");
    expect(payload.error.message).toContain("mutually exclusive");
  });
});
