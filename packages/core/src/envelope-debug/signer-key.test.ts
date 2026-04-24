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

describe("parseSignerKey (default: PEM or base64 only, no file reads)", () => {
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

  it("does NOT read from disk when given a valid path (UI path: allowFilePaths omitted)", () => {
    // The security boundary: without opt-in, a path on disk must not be
    // followed. Validates the UI server's D4 paste-only invariant.
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

  it("does not mention file paths in the error message when allowFilePaths is off", () => {
    expect(() => parseSignerKey("not-a-real-key")).toThrow(
      /could not be parsed as PEM or a base64 DER SPKI key/,
    );
  });
});

describe("parseSignerKey with { allowFilePaths: true } (CLI path)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-signer-key-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a PEM file when given an existing path", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    const pemPath = path.join(tmpDir, "signer.pub.pem");
    fs.writeFileSync(pemPath, publicPem);
    expect(parseSignerKey(pemPath, { allowFilePaths: true })).toBe(publicBase64Der);
  });

  it("reads a base64 file when given an existing path", () => {
    const { publicBase64Der } = generateEd25519();
    const keyPath = path.join(tmpDir, "signer.pub.b64");
    fs.writeFileSync(keyPath, publicBase64Der);
    expect(parseSignerKey(keyPath, { allowFilePaths: true })).toBe(publicBase64Der);
  });

  it("prefers PEM parsing over file lookup when the input is PEM-shaped", () => {
    // Edge case: a file named "-----BEGIN..." would trigger the PEM branch
    // first. The key property: a PEM-looking string is never treated as a path.
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicPem, { allowFilePaths: true })).toBe(publicBase64Der);
  });

  it("prefers file lookup over base64 when the input is a valid path", () => {
    const { publicBase64Der } = generateEd25519();
    const keyPath = path.join(tmpDir, "ambiguous.key");
    fs.writeFileSync(keyPath, publicBase64Der);
    // `ambiguous.key` is not valid base64 DER — if file lookup were skipped,
    // we'd fall through to base64 parsing and fail.
    expect(parseSignerKey(keyPath, { allowFilePaths: true })).toBe(publicBase64Der);
  });

  it("mentions file paths in the error message when allowFilePaths is on", () => {
    expect(() => parseSignerKey("not-a-real-key", { allowFilePaths: true })).toThrow(
      /could not be parsed as PEM, a readable file path, or a base64 DER SPKI key/,
    );
  });
});
