/**
 * Blackbox E2E test for `clef envelope {inspect,verify,decrypt}`.
 *
 * Runs the SEA binary (or node entry in CLEF_E2E_MODE=node) against a real
 * sops-encrypted test repo. Catches regressions that unit tests miss — SEA
 * bundling issues, missing runtime deps baked into the binary, real crypto
 * paths that only resolve at runtime.
 *
 * Coverage is intentionally narrow: one success path per subcommand. Detailed
 * flag-by-flag behaviour is covered by the unit tests and by the integration
 * test (integration/tests/envelope-roundtrip.test.ts).
 */
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";
import { type AgeKeyPair, generateAgeKey } from "../setup/keys";
import { type TestRepo, scaffoldTestRepo } from "../setup/repo";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SEA_BINARY = path.join(REPO_ROOT, "packages/cli/dist/clef");
const NODE_ENTRY = path.join(REPO_ROOT, "packages/cli/bin/clef.js");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function resolveClefBin(): { command: string; prefixArgs: string[] } {
  const mode = (process.env.CLEF_E2E_MODE ?? "sea") as "sea" | "node";
  if (mode === "node") {
    if (!fs.existsSync(NODE_ENTRY)) {
      throw new Error(
        `CLI entry not found at ${NODE_ENTRY}. Build first: npm run build -w packages/cli`,
      );
    }
    return { command: process.execPath, prefixArgs: [NODE_ENTRY] };
  }
  const bin = process.platform === "win32" ? SEA_BINARY + ".exe" : SEA_BINARY;
  if (!fs.existsSync(bin)) {
    throw new Error(
      `SEA binary not found at ${bin}. Build it first: npm run build:sea -w packages/cli`,
    );
  }
  return { command: bin, prefixArgs: [] };
}

function runClef(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  expectFailure = false,
): SpawnResult {
  const { command, prefixArgs } = resolveClefBin();
  try {
    const stdout = execFileSync(command, [...prefixArgs, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (expectFailure) {
      throw new Error(`Expected failure but command succeeded. stdout:\n${stdout}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      exitCode: e.status ?? 1,
    };
  }
}

let keys: AgeKeyPair;
let siKeys: AgeKeyPair;
let repo: TestRepo;
let signingPrivateKeyBase64: string;
let signingPublicKeyBase64: string;
let artifactPath: string;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  siKeys = await generateAgeKey();
  repo = scaffoldTestRepo(keys, siKeys);

  const kp = crypto.generateKeyPairSync("ed25519");
  signingPrivateKeyBase64 = (
    kp.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer
  ).toString("base64");
  signingPublicKeyBase64 = (
    kp.publicKey.export({ type: "spki", format: "der" }) as Buffer
  ).toString("base64");

  // Produce a signed artifact for the envelope tests to consume.
  artifactPath = path.join(repo.dir, "envelope-e2e.json");
  const pack = runClef(
    repo.dir,
    ["pack", "web-app", "dev", "--output", artifactPath, "--signing-key", signingPrivateKeyBase64],
    { SOPS_AGE_KEY_FILE: keys.keyFilePath },
  );
  if (pack.exitCode !== 0) {
    throw new Error(`Setup: clef pack failed.\nstderr:\n${pack.stderr}`);
  }
});

test.afterAll(() => {
  if (repo) repo.cleanup();
  for (const k of [keys, siKeys]) {
    if (k?.tmpDir) {
      try {
        fs.rmSync(k.tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
});

test("envelope inspect (SEA): reports identity and verified hash", () => {
  const result = runClef(repo.dir, ["--json", "envelope", "inspect", artifactPath]);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
  expect(payload).toHaveLength(1);
  expect(payload[0].identity).toBe("web-app");
  expect(payload[0].ciphertextHashVerified).toBe(true);
});

test("envelope verify (SEA): signature valid with correct public key", () => {
  const result = runClef(repo.dir, [
    "--json",
    "envelope",
    "verify",
    artifactPath,
    "--signer-key",
    signingPublicKeyBase64,
  ]);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    checks: { signature: { status: string } };
    overall: string;
  };
  expect(payload.checks.signature.status).toBe("valid");
  expect(payload.overall).toBe("pass");
});

test("envelope decrypt (SEA): values round-trip with --reveal", () => {
  const result = runClef(repo.dir, [
    "--json",
    "envelope",
    "decrypt",
    artifactPath,
    "--identity",
    siKeys.keyFilePath,
    "--reveal",
  ]);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout) as {
    revealed: boolean;
    values: Record<string, string>;
  };
  expect(payload.revealed).toBe(true);
  expect(payload.values).toMatchObject({
    payments__STRIPE_KEY: "sk_test_abc123",
    payments__STRIPE_WEBHOOK_SECRET: "whsec_xyz789",
  });
});
