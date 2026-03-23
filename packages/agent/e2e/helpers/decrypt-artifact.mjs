/**
 * Standalone ESM helper that decrypts an age-encrypted packed artifact.
 *
 * Usage: node decrypt-artifact.mjs <artifactPath> <privateKey>
 *
 * Outputs the decrypted secrets JSON to stdout.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { Decrypter } from "age-encryption";

const [, , artifactPath, privateKey] = process.argv;

if (!artifactPath || !privateKey) {
  process.stderr.write("Usage: decrypt-artifact.mjs <artifactPath> <privateKey>\n");
  process.exit(1);
}

const raw = readFileSync(artifactPath, "utf-8");
const artifact = JSON.parse(raw);

// Verify integrity
const hash = createHash("sha256").update(artifact.ciphertext).digest("hex");
if (hash !== artifact.ciphertextHash) {
  process.stderr.write(
    `Integrity check failed: expected ${artifact.ciphertextHash}, got ${hash}\n`,
  );
  process.exit(1);
}

// Decrypt — ciphertext is base64-encoded binary age format
const decrypter = new Decrypter();
decrypter.addIdentity(privateKey);
const plaintext = await decrypter.decrypt(Buffer.from(artifact.ciphertext, "base64"), "text");

// Output the decrypted secrets
process.stdout.write(plaintext);
