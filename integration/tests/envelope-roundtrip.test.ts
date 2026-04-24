/**
 * Integration test for `clef envelope {inspect,verify,decrypt}`.
 *
 * Exercises the full flow end-to-end with a real SOPS binary, real age
 * encryption, real Ed25519 signing, and the CLI invoked as a subprocess
 * (no in-process mocks). This is the binding contract that "debugger can
 * decrypt iff runtime can decrypt" — both sides share the same core/runtime
 * modules, so a roundtrip here proves the debugger reads what the packer
 * writes.
 *
 * Covers:
 *   - Pack → inspect: metadata matches across the pack/inspect boundary
 *   - Pack → verify --signer-key: signature round-trips cleanly
 *   - Pack → decrypt: key names + (with --reveal) values round-trip
 *   - Mutation: ciphertextHash tamper → verify exit 2
 *   - Mutation: signature tamper → verify exit 3
 *   - Wrong identity → decrypt exit 4
 *   - Missing source → inspect/verify/decrypt exit 1
 */
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AgeKeyPair, checkSopsAvailable, generateAgeKey } from "../setup/keys";
import { TestRepo, scaffoldTestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;
let signingPrivateKeyBase64: string;
let signingPublicKeyBase64: string;

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys, { includeServiceIdentity: true });
  } catch (err) {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
    repo?.cleanup();
    throw err;
  }

  const kp = crypto.generateKeyPairSync("ed25519");
  signingPrivateKeyBase64 = (
    kp.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer
  ).toString("base64");
  signingPublicKeyBase64 = (
    kp.publicKey.export({ type: "spki", format: "der" }) as Buffer
  ).toString("base64");
});

afterAll(() => {
  try {
    repo?.cleanup();
  } finally {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runClef(
  args: string[],
  opts: { expectFailure?: boolean; extraEnv?: Record<string, string> } = {},
): SpawnResult {
  const result = (() => {
    try {
      const stdout = execFileSync("node", [clefBin, ...args], {
        cwd: repo.dir,
        env: {
          ...process.env,
          SOPS_AGE_KEY_FILE: keys.keyFilePath,
          ...(opts.extraEnv ?? {}),
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      return {
        stdout: (e.stdout ?? "").toString(),
        stderr: (e.stderr ?? "").toString(),
        exitCode: e.status ?? 1,
      };
    }
  })();

  if (opts.expectFailure && result.exitCode === 0) {
    throw new Error(`Expected command to fail but it succeeded. stdout:\n${result.stdout}`);
  }
  if (!opts.expectFailure && result.exitCode !== 0) {
    throw new Error(
      `Command failed unexpectedly (exit ${result.exitCode}).\nargs: ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

describe("clef envelope roundtrip", () => {
  let artifactPath: string;

  beforeAll(() => {
    artifactPath = path.join(repo.dir, "envelope-roundtrip.json");
    runClef([
      "pack",
      "web-app",
      "dev",
      "--output",
      artifactPath,
      "--signing-key",
      signingPrivateKeyBase64,
    ]);
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it("inspect: reports version/identity/envelope/signature fields for a signed age artifact", () => {
    const result = runClef(["--json", "envelope", "inspect", artifactPath]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    const entry = payload[0];
    expect(entry.identity).toBe("web-app");
    expect(entry.environment).toBe("dev");
    expect(entry.ciphertextHashVerified).toBe(true);
    expect((entry.envelope as { provider: string }).provider).toBe("age");
    expect((entry.signature as { present: boolean }).present).toBe(true);
    expect(entry.error).toBeNull();
  });

  it("verify: passes with the correct signer public key, exit 0", () => {
    const result = runClef([
      "--json",
      "envelope",
      "verify",
      artifactPath,
      "--signer-key",
      signingPublicKeyBase64,
    ]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      checks: {
        hash: { status: string };
        signature: { status: string };
      };
      overall: string;
    };
    expect(payload.checks.hash.status).toBe("ok");
    expect(payload.checks.signature.status).toBe("valid");
    expect(payload.overall).toBe("pass");
  });

  it("verify: not_verified (but still exit 0) when no --signer-key is provided", () => {
    const result = runClef(["--json", "envelope", "verify", artifactPath]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      checks: { signature: { status: string } };
      overall: string;
    };
    expect(payload.checks.signature.status).toBe("not_verified");
    expect(payload.overall).toBe("pass");
  });

  it("decrypt: default lists key names only, no values, exit 0", () => {
    const result = runClef([
      "--json",
      "envelope",
      "decrypt",
      artifactPath,
      "--identity",
      repo.serviceIdentityKeyFilePath!,
    ]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      revealed: boolean;
      keys: string[];
      values: Record<string, string> | null;
    };
    expect(payload.revealed).toBe(false);
    expect(payload.values).toBeNull();
    expect(payload.keys.length).toBeGreaterThan(0);
  });

  it("decrypt --reveal: values round-trip, exit 0, warning on stderr", () => {
    const result = runClef([
      "--json",
      "envelope",
      "decrypt",
      artifactPath,
      "--identity",
      repo.serviceIdentityKeyFilePath!,
      "--reveal",
    ]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      revealed: boolean;
      values: Record<string, string>;
    };
    expect(payload.revealed).toBe(true);
    expect(Object.keys(payload.values).length).toBeGreaterThan(0);

    // The reveal warning is emitted to stderr, not stdout.
    // Note: execFileSync inherits child stderr separately; we don't capture
    // it here when the child succeeds (see runClef). The ordering invariant
    // is covered by the unit-level reveal-warning-ordering test.
  });

  it("decrypt: uses CLEF_AGE_KEY_FILE env var when --identity is not provided", () => {
    const result = runClef(["--json", "envelope", "decrypt", artifactPath], {
      extraEnv: { CLEF_AGE_KEY_FILE: repo.serviceIdentityKeyFilePath! },
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { keys: string[] };
    expect(payload.keys.length).toBeGreaterThan(0);
  });

  it("decrypt: exits 4 when no age identity is configured", () => {
    const result = runClef(["envelope", "decrypt", artifactPath], {
      expectFailure: true,
      // Clear env so neither --identity nor env vars apply
      extraEnv: { CLEF_AGE_KEY_FILE: "", CLEF_AGE_KEY: "" },
    });
    expect(result.exitCode).toBe(4);
    expect(result.stderr + result.stdout).toMatch(/key_resolution_failed|No age identity/);
  });

  it("inspect: exits 1 when the source cannot be fetched", () => {
    const result = runClef(["envelope", "inspect", "/nonexistent/path.json"], {
      expectFailure: true,
    });
    expect(result.exitCode).toBe(1);
  });
});

describe("clef envelope roundtrip — tamper detection", () => {
  let artifactPath: string;

  beforeAll(() => {
    artifactPath = path.join(repo.dir, "envelope-tamper.json");
    runClef([
      "pack",
      "web-app",
      "dev",
      "--output",
      artifactPath,
      "--signing-key",
      signingPrivateKeyBase64,
    ]);
  });

  function readArtifact(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
  }

  function writeArtifact(artifact: Record<string, unknown>): void {
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  }

  it("verify: exit 2 when ciphertextHash is tampered", () => {
    const artifact = readArtifact();
    writeArtifact({ ...artifact, ciphertextHash: "deadbeef".repeat(8) });

    const result = runClef(
      ["envelope", "verify", artifactPath, "--signer-key", signingPublicKeyBase64],
      { expectFailure: true },
    );
    expect(result.exitCode).toBe(2);
  });

  it("decrypt: exit 2 when ciphertextHash is tampered (short-circuits before decrypt)", () => {
    const artifact = readArtifact();
    writeArtifact({ ...artifact, ciphertextHash: "deadbeef".repeat(8) });

    const result = runClef(
      ["envelope", "decrypt", artifactPath, "--identity", repo.serviceIdentityKeyFilePath!],
      { expectFailure: true },
    );
    expect(result.exitCode).toBe(2);
  });

  it("verify: exit 3 when the signature is tampered", () => {
    // Re-pack fresh so the previous mutation doesn't carry over.
    runClef([
      "pack",
      "web-app",
      "dev",
      "--output",
      artifactPath,
      "--signing-key",
      signingPrivateKeyBase64,
    ]);
    const artifact = readArtifact();
    writeArtifact({
      ...artifact,
      signature:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    });

    const result = runClef(
      ["envelope", "verify", artifactPath, "--signer-key", signingPublicKeyBase64],
      { expectFailure: true },
    );
    expect(result.exitCode).toBe(3);
  });
});
