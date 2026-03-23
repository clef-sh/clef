/**
 * Standalone ESM helper that creates an age-encrypted packed artifact.
 *
 * Usage: node create-artifact.mjs <publicKey> <secretsJson> [revision] [expiresAt] [revokedAt]
 *
 * Outputs the full artifact JSON to stdout.
 */
import { createHash } from "crypto";
import { Encrypter } from "age-encryption";

const [, , publicKey, secretsJson, revision, expiresAt, revokedAt] = process.argv;

if (!publicKey || !secretsJson) {
  process.stderr.write("Usage: create-artifact.mjs <publicKey> <secretsJson> [revision]\n");
  process.exit(1);
}

const encrypter = new Encrypter();
encrypter.addRecipient(publicKey);
const encrypted = await encrypter.encrypt(secretsJson);
// Store as base64 — the binary age format cannot survive JSON string round-trip
const ciphertext = Buffer.from(encrypted).toString("base64");
const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");

const keys = Object.keys(JSON.parse(secretsJson));

const artifact = {
  version: 1,
  identity: "test-svc",
  environment: "production",
  packedAt: new Date().toISOString(),
  revision: revision || "rev-001",
  ciphertextHash,
  ciphertext,
  keys,
};

if (expiresAt) artifact.expiresAt = expiresAt;
if (revokedAt) artifact.revokedAt = revokedAt;

process.stdout.write(JSON.stringify(artifact));
