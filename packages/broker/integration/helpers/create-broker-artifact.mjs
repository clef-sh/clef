/**
 * Standalone ESM helper that creates a broker artifact with real age-encryption.
 *
 * Usage: node create-broker-artifact.mjs <secretsJson> <identity> <environment> <ttl> <symmetricKeyHex>
 *
 * Uses a symmetric AES key (passed as hex) to simulate KMS wrapping.
 * Outputs the full artifact JSON to stdout.
 */
import { createHash, randomBytes, createCipheriv } from "crypto";
import { generateIdentity, identityToRecipient, Encrypter } from "age-encryption";

const [, , secretsJson, identity, environment, ttlStr, symmetricKeyHex] = process.argv;

if (!secretsJson || !identity || !environment || !ttlStr || !symmetricKeyHex) {
  process.stderr.write(
    "Usage: create-broker-artifact.mjs <secretsJson> <identity> <environment> <ttl> <symmetricKeyHex>\n",
  );
  process.exit(1);
}

const ttl = parseInt(ttlStr, 10);
const symmetricKey = Buffer.from(symmetricKeyHex, "hex");

// Generate ephemeral age key pair
const ephemeralPrivateKey = await generateIdentity();
const ephemeralPublicKey = await identityToRecipient(ephemeralPrivateKey);

// age-encrypt plaintext to ephemeral public key
const encrypter = new Encrypter();
encrypter.addRecipient(ephemeralPublicKey);
const encrypted = await encrypter.encrypt(secretsJson);
const ciphertext = Buffer.from(encrypted).toString("base64");

// Wrap the ephemeral private key with symmetric AES (simulating KMS)
const iv = randomBytes(16);
const cipher = createCipheriv("aes-256-cbc", symmetricKey, iv);
const wrappedKey = Buffer.concat([
  iv,
  cipher.update(Buffer.from(ephemeralPrivateKey)),
  cipher.final(),
]);

const revision = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");
const packedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

const artifact = {
  version: 1,
  identity,
  environment,
  packedAt,
  revision,
  ciphertextHash,
  ciphertext,
  keys: Object.keys(JSON.parse(secretsJson)),
  envelope: {
    provider: "test",
    keyId: "test-key",
    wrappedKey: wrappedKey.toString("base64"),
    algorithm: "AES-256-CBC",
  },
  expiresAt,
};

process.stdout.write(JSON.stringify(artifact, null, 2));
