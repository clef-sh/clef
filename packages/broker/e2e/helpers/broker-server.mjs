/**
 * Standalone ESM helper that starts a real broker HTTP server.
 *
 * Usage: node broker-server.mjs <secretsJson> <symmetricKeyHex>
 *
 * Starts a broker serve() with real age-encryption and a test KMS.
 * Prints "BROKER_READY:<url>" to stdout when the server is listening.
 */
import { createHash, randomBytes, createCipheriv } from "crypto";
import http from "http";
import { generateIdentity, identityToRecipient, Encrypter } from "age-encryption";

const [, , secretsJson, symmetricKeyHex] = process.argv;

if (!secretsJson || !symmetricKeyHex) {
  process.stderr.write("Usage: broker-server.mjs <secretsJson> <symmetricKeyHex>\n");
  process.exit(1);
}

const symmetricKey = Buffer.from(symmetricKeyHex, "hex");

// ── In-line packEnvelope (ESM context, real age-encryption) ──────────────────

async function packEnvelope(data, identity, environment, ttl) {
  const plaintext = JSON.stringify(data);

  const ephemeralPrivateKey = await generateIdentity();
  const ephemeralPublicKey = await identityToRecipient(ephemeralPrivateKey);

  const e = new Encrypter();
  e.addRecipient(ephemeralPublicKey);
  const encrypted = await e.encrypt(plaintext);
  const ciphertext = Buffer.from(encrypted).toString("base64");

  // Wrap ephemeral private key with test symmetric KMS
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", symmetricKey, iv);
  const wrappedKey = Buffer.concat([
    iv,
    cipher.update(Buffer.from(ephemeralPrivateKey)),
    cipher.final(),
  ]);

  const revision = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");

  return JSON.stringify(
    {
      version: 1,
      identity,
      environment,
      packedAt: new Date().toISOString(),
      revision,
      ciphertextHash,
      ciphertext,
      envelope: {
        provider: "test",
        keyId: "test-key",
        wrappedKey: wrappedKey.toString("base64"),
        algorithm: "AES-256-CBC",
      },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    },
    null,
    2,
  );
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const secrets = JSON.parse(secretsJson);
let cached = undefined;

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url !== "/" && req.url !== "") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    // Cache for 80% of TTL (720s for 900s TTL)
    if (cached && Date.now() - cached.createdAt < cached.ttl * 0.8 * 1000) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(cached.body);
      return;
    }

    const body = await packEnvelope(secrets, "e2e-broker", "e2e", 900);
    cached = { body, createdAt: Date.now(), ttl: 900 };

    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// Listen on port 0 (OS-assigned) to avoid conflicts
server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;
  process.stdout.write(`BROKER_READY:${url}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});
