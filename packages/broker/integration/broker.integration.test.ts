/**
 * Broker integration tests — real age-encryption, no mocks.
 *
 * Uses ESM subprocess helpers to generate real age keys and decrypt
 * broker-produced envelopes. The envelope is constructed via a subprocess
 * that imports the broker's packEnvelope() in ESM context.
 *
 * KMS wrapping is simulated with a symmetric key (no real cloud calls).
 *
 * Run: npm run test:integration -w packages/broker
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFileSync } from "child_process";

const HELPERS_DIR = path.resolve(__dirname, "../../agent/e2e/helpers");
const BROKER_HELPER = path.resolve(__dirname, "helpers/create-broker-artifact.mjs");

interface AgeKeyPair {
  publicKey: string;
  privateKey: string;
}

function generateAgeKey(): AgeKeyPair {
  const helperPath = path.join(HELPERS_DIR, "age-keygen.mjs");
  const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
  return JSON.parse(result) as AgeKeyPair;
}

function decryptArtifact(artifactPath: string, privateKey: string): Record<string, string> {
  const helperPath = path.join(HELPERS_DIR, "decrypt-artifact.mjs");
  const result = execFileSync(process.execPath, [helperPath, artifactPath, privateKey], {
    encoding: "utf-8",
  });
  return JSON.parse(result) as Record<string, string>;
}

/**
 * Create a broker artifact via ESM subprocess.
 * Uses real age-encryption (not mocked) and a symmetric test KMS.
 */
function createBrokerArtifact(
  secretsJson: string,
  options: { identity: string; environment: string; ttl: number; symmetricKeyHex: string },
): string {
  const args = [
    BROKER_HELPER,
    secretsJson,
    options.identity,
    options.environment,
    String(options.ttl),
    options.symmetricKeyHex,
  ];
  return execFileSync(process.execPath, args, { encoding: "utf-8" });
}

/**
 * Unwrap an ephemeral key using the same symmetric AES key the helper used.
 */
function unwrapKey(wrappedKeyBase64: string, symmetricKeyHex: string): string {
  const symmetricKey = Buffer.from(symmetricKeyHex, "hex");
  const wrappedKey = Buffer.from(wrappedKeyBase64, "base64");
  const iv = wrappedKey.subarray(0, 16);
  const ciphertext = wrappedKey.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", symmetricKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
}

// ── Setup ────────────────────────────────────────────────────────────────────

const TEST_CREDENTIALS = {
  DB_TOKEN: "rds-iam-token-abc123",
  DB_HOST: "mydb.cluster-xyz.us-east-1.rds.amazonaws.com",
};

let keys: AgeKeyPair;
let symmetricKeyHex: string;
let tmpDir: string;

beforeAll(() => {
  keys = generateAgeKey();
  // Derive a symmetric key from the age public key (for test KMS simulation)
  symmetricKeyHex = crypto.createHash("sha256").update(keys.publicKey).digest("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-broker-int-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("broker integration — real age-encryption", () => {
  it("produces a valid artifact with real age encryption", () => {
    const envelopeJson = createBrokerArtifact(JSON.stringify(TEST_CREDENTIALS), {
      identity: "rds-primary",
      environment: "production",
      ttl: 900,
      symmetricKeyHex,
    });

    const artifact = JSON.parse(envelopeJson);
    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("rds-primary");
    expect(artifact.environment).toBe("production");
    expect(JSON.parse(envelopeJson).keys).toBeUndefined();
    expect(artifact.expiresAt).toBeTruthy();
    expect(artifact.envelope).toBeDefined();
    expect(artifact.envelope.provider).toBe("test");
    expect(artifact.ciphertextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.revision).toMatch(/^\d+-[0-9a-f]{8}$/);
  });

  it("ciphertextHash is a valid SHA-256 of the ciphertext", () => {
    const envelopeJson = createBrokerArtifact(JSON.stringify({ KEY: "value" }), {
      identity: "test-svc",
      environment: "staging",
      ttl: 60,
      symmetricKeyHex,
    });

    const artifact = JSON.parse(envelopeJson);
    const expectedHash = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    expect(artifact.ciphertextHash).toBe(expectedHash);
  });

  it("envelope can be unwrapped and ciphertext decrypted to recover plaintext", () => {
    const envelopeJson = createBrokerArtifact(JSON.stringify(TEST_CREDENTIALS), {
      identity: "rds-primary",
      environment: "production",
      ttl: 900,
      symmetricKeyHex,
    });

    const artifact = JSON.parse(envelopeJson);

    // Step 1: Unwrap the ephemeral age private key
    const ephemeralPrivateKey = unwrapKey(artifact.envelope.wrappedKey, symmetricKeyHex);
    expect(ephemeralPrivateKey).toMatch(/^AGE-SECRET-KEY-/);

    // Step 2: Write artifact to disk and decrypt with ESM helper
    const artifactPath = path.join(tmpDir, `artifact-${Date.now()}.json`);
    fs.writeFileSync(artifactPath, envelopeJson);
    const decrypted = decryptArtifact(artifactPath, ephemeralPrivateKey);

    // Step 3: Verify the decrypted values match
    expect(decrypted).toEqual(TEST_CREDENTIALS);
  });

  it("each invocation produces a unique ephemeral key pair", () => {
    const opts = {
      identity: "test-svc",
      environment: "production",
      ttl: 60,
      symmetricKeyHex,
    };

    const r1 = JSON.parse(createBrokerArtifact(JSON.stringify({ KEY: "val" }), opts));
    const r2 = JSON.parse(createBrokerArtifact(JSON.stringify({ KEY: "val" }), opts));

    // Different ciphertexts (different ephemeral keys)
    expect(r1.ciphertext).not.toBe(r2.ciphertext);
    expect(r1.envelope.wrappedKey).not.toBe(r2.envelope.wrappedKey);

    // Both should decrypt to the same value
    for (const artifact of [r1, r2]) {
      const ephKey = unwrapKey(artifact.envelope.wrappedKey, symmetricKeyHex);
      const p = path.join(tmpDir, `artifact-unique-${Date.now()}-${Math.random()}.json`);
      fs.writeFileSync(p, JSON.stringify(artifact));
      expect(decryptArtifact(p, ephKey)).toEqual({ KEY: "val" });
    }
  });

  it("plaintext values do not appear in the envelope", () => {
    const envelopeJson = createBrokerArtifact(
      JSON.stringify({ SECRET_PASSWORD: "super-secret-p@ssw0rd!" }),
      { identity: "test-svc", environment: "production", ttl: 60, symmetricKeyHex },
    );

    expect(envelopeJson).not.toContain("super-secret-p@ssw0rd!");
    expect(envelopeJson).toContain("SECRET_PASSWORD");
  });

  it("expiresAt timestamp is ttl seconds in the future", () => {
    const before = Date.now();
    const envelopeJson = createBrokerArtifact(JSON.stringify({ K: "v" }), {
      identity: "test-svc",
      environment: "staging",
      ttl: 3600,
      symmetricKeyHex,
    });
    const after = Date.now();

    const artifact = JSON.parse(envelopeJson);
    const expiresAt = new Date(artifact.expiresAt).getTime();

    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 3_600_000);
  });
});
