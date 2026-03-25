/**
 * Broker E2E tests — real HTTP server, real age-encryption, full pipeline.
 *
 * Spawns a broker server subprocess, polls it via HTTP, verifies the
 * response is a valid, decryptable Clef artifact envelope.
 *
 * Uses node:test (not Jest) to avoid ESM import issues and subprocess
 * cleanup problems — same pattern as the agent e2e tests.
 *
 * Run: npm run test:e2e -w packages/broker
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";

const AGENT_HELPERS_DIR = path.resolve(__dirname, "../../agent/e2e/helpers");
const BROKER_SERVER_SCRIPT = path.resolve(__dirname, "helpers/broker-server.mjs");

// ── Helpers ──────────────────────────────────────────────────────────────────

interface AgeKeyPair {
  publicKey: string;
  privateKey: string;
}

function generateAgeKey(): AgeKeyPair {
  const helperPath = path.join(AGENT_HELPERS_DIR, "age-keygen.mjs");
  const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
  return JSON.parse(result) as AgeKeyPair;
}

function decryptArtifact(artifactPath: string, privateKey: string): Record<string, string> {
  const helperPath = path.join(AGENT_HELPERS_DIR, "decrypt-artifact.mjs");
  const result = execFileSync(process.execPath, [helperPath, artifactPath, privateKey], {
    encoding: "utf-8",
  });
  return JSON.parse(result) as Record<string, string>;
}

function unwrapKey(wrappedKeyBase64: string, symmetricKeyHex: string): string {
  const symmetricKey = Buffer.from(symmetricKeyHex, "hex");
  const wrappedKey = Buffer.from(wrappedKeyBase64, "base64");
  const iv = wrappedKey.subarray(0, 16);
  const ciphertext = wrappedKey.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", symmetricKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
}

function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

// ── Setup ────────────────────────────────────────────────────────────────────

let keys: AgeKeyPair;
let symmetricKeyHex: string;
let tmpDir: string;
let brokerProcess: ChildProcess;
let brokerUrl: string;

const TEST_SECRETS = { DB_TOKEN: "e2e-rds-token-xyz", DB_HOST: "e2e-rds.example.com" };

before(async () => {
  keys = generateAgeKey();
  symmetricKeyHex = crypto.createHash("sha256").update(keys.publicKey).digest("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-broker-e2e-"));

  // Start broker server subprocess
  brokerProcess = spawn(
    process.execPath,
    [BROKER_SERVER_SCRIPT, JSON.stringify(TEST_SECRETS), symmetricKeyHex],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );

  // Wait for readiness signal from stdout
  brokerUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Broker did not start. Output: ${output}`)),
      10_000,
    );

    brokerProcess.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/BROKER_READY:(.+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1].trim());
      }
    });

    brokerProcess.stderr!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    brokerProcess.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Broker exited with code ${code}. Output: ${output}`));
    });
  });
});

after(async () => {
  if (brokerProcess) {
    brokerProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        brokerProcess.kill("SIGKILL");
        resolve();
      }, 5_000);
      brokerProcess.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("broker e2e — real HTTP server", () => {
  it("GET / returns a valid artifact envelope", async () => {
    const res = await httpGet(brokerUrl + "/");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/json");
    assert.equal(res.headers["cache-control"], "no-store");

    const artifact = JSON.parse(res.body);
    assert.equal(artifact.version, 1);
    assert.equal(artifact.identity, "e2e-broker");
    assert.equal(artifact.environment, "e2e");
    assert.deepEqual(artifact.keys, ["DB_TOKEN", "DB_HOST"]);
    assert.ok(artifact.expiresAt);
    assert.ok(artifact.envelope);
    assert.ok(artifact.ciphertextHash);
    assert.ok(artifact.revision);
  });

  it("GET /health returns ok", async () => {
    const res = await httpGet(brokerUrl + "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { status: "ok" });
  });

  it("artifact ciphertextHash matches SHA-256 of ciphertext", async () => {
    const res = await httpGet(brokerUrl + "/");
    const artifact = JSON.parse(res.body);
    const expected = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    assert.equal(artifact.ciphertextHash, expected);
  });

  it("artifact can be unwrapped and decrypted to recover original secrets", async () => {
    const res = await httpGet(brokerUrl + "/");
    const artifact = JSON.parse(res.body);

    // Unwrap ephemeral key
    const ephemeralPrivateKey = unwrapKey(artifact.envelope.wrappedKey, symmetricKeyHex);
    assert.match(ephemeralPrivateKey, /^AGE-SECRET-KEY-/);

    // Write artifact to disk and decrypt
    const artifactPath = path.join(tmpDir, `e2e-artifact-${Date.now()}.json`);
    fs.writeFileSync(artifactPath, res.body);
    const decrypted = decryptArtifact(artifactPath, ephemeralPrivateKey);

    assert.deepEqual(decrypted, TEST_SECRETS);
  });

  it("returns cached response on rapid polls", async () => {
    const r1 = await httpGet(brokerUrl + "/");
    const r2 = await httpGet(brokerUrl + "/");

    const a1 = JSON.parse(r1.body);
    const a2 = JSON.parse(r2.body);

    // Same revision means same cached response
    assert.equal(a1.revision, a2.revision);
    assert.equal(a1.ciphertext, a2.ciphertext);
  });

  it("plaintext secrets do not appear in the response body", async () => {
    const res = await httpGet(brokerUrl + "/");
    // Verify plaintext secret VALUES are not in the encrypted envelope
    for (const value of Object.values(TEST_SECRETS)) {
      assert.equal(res.body.indexOf(value), -1, `plaintext value "${value}" leaked into envelope`);
    }
    // Key NAMES should be present (they are listed in the keys array)
    assert.ok(res.body.includes("DB_TOKEN"));
    assert.ok(res.body.includes("DB_HOST"));
  });
});
