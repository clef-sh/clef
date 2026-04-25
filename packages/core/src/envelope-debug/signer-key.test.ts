import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseSignerKey } from "./signer-key";

function generateEd25519(): {
  publicPem: string;
  publicBase64Der: string;
} {
  const kp = crypto.generateKeyPairSync("ed25519");
  const publicPem = kp.publicKey.export({ type: "spki", format: "pem" }) as string;
  const publicBase64Der = (kp.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
    "base64",
  );
  return { publicPem, publicBase64Der };
}

describe("parseSignerKey", () => {
  it("parses a PEM string starting with -----BEGIN", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicPem)).toBe(publicBase64Der);
  });

  it("tolerates leading/trailing whitespace around a PEM block", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(`   \n${publicPem}\n\n  `)).toBe(publicBase64Der);
  });

  it("parses a raw base64 DER SPKI string", () => {
    const { publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicBase64Der)).toBe(publicBase64Der);
  });

  it("normalizes base64 with embedded whitespace (round-trip through crypto)", () => {
    const { publicBase64Der } = generateEd25519();
    const chunked = publicBase64Der.match(/.{1,40}/g)?.join("\n") ?? publicBase64Der;
    expect(parseSignerKey(chunked)).toBe(publicBase64Der);
  });

  it("throws a clear error for unparseable input", () => {
    expect(() => parseSignerKey("not-a-real-key")).toThrow(/could not be parsed/);
  });

  it("throws a clear error for malformed PEM", () => {
    expect(() =>
      parseSignerKey("-----BEGIN PUBLIC KEY-----\nnotbase64\n-----END PUBLIC KEY-----"),
    ).toThrow(/PEM is invalid/);
  });

  it("never reads from the filesystem, even when the input happens to be a real path", () => {
    // Security boundary: file reads must happen at the explicit CLI flag
    // (`--signer-key-file`), not silently inside the parser. A path on disk
    // that doesn't itself contain a valid PEM/base64 key must throw.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-signer-key-test-"));
    try {
      const { publicBase64Der } = generateEd25519();
      const keyPath = path.join(tmpDir, "signer.b64");
      fs.writeFileSync(keyPath, publicBase64Der);
      // `signer.b64` is not valid base64 DER — it must throw rather than
      // silently read the file.
      expect(() => parseSignerKey(keyPath)).toThrow(/could not be parsed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("error message names PEM and base64 DER SPKI as the only accepted forms", () => {
    expect(() => parseSignerKey("not-a-real-key")).toThrow(
      /could not be parsed as PEM or a base64 DER SPKI key/,
    );
  });
});
