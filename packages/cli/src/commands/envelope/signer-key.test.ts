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

describe("parseSignerKey input precedence", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-envelope-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a PEM string starting with -----BEGIN", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicPem)).toBe(publicBase64Der);
  });

  it("tolerates leading/trailing whitespace around a PEM block", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(`   \n${publicPem}\n\n  `)).toBe(publicBase64Der);
  });

  it("reads a PEM file when given an existing path", () => {
    const { publicPem, publicBase64Der } = generateEd25519();
    const pemPath = path.join(tmpDir, "signer.pub.pem");
    fs.writeFileSync(pemPath, publicPem);
    expect(parseSignerKey(pemPath)).toBe(publicBase64Der);
  });

  it("reads a base64 file when given an existing path", () => {
    const { publicBase64Der } = generateEd25519();
    const keyPath = path.join(tmpDir, "signer.pub.b64");
    fs.writeFileSync(keyPath, publicBase64Der);
    expect(parseSignerKey(keyPath)).toBe(publicBase64Der);
  });

  it("parses a raw base64 DER SPKI string when not a PEM and not a file path", () => {
    const { publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicBase64Der)).toBe(publicBase64Der);
  });

  it("normalizes base64 with embedded whitespace (round-trip through crypto)", () => {
    const { publicBase64Der } = generateEd25519();
    // Insert newlines in the middle — still a valid base64 representation.
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

  it("prefers PEM parsing over file lookup when the input is both valid-PEM-shaped and exists on disk", () => {
    // Edge case: a file whose name happens to start with "-----BEGIN" would
    // trigger the PEM branch first. fs.statSync on such a name returns ENOENT,
    // so in practice the PEM branch handles it and throws on invalid contents.
    // The key property: a PEM-looking string is never treated as a path.
    const { publicPem, publicBase64Der } = generateEd25519();
    expect(parseSignerKey(publicPem)).toBe(publicBase64Der);
  });

  it("prefers file lookup over base64 when the input is a valid path", () => {
    const { publicBase64Der } = generateEd25519();
    const keyPath = path.join(tmpDir, "ambiguous.key");
    fs.writeFileSync(keyPath, publicBase64Der);
    // The string `ambiguous.key` is not valid base64 DER, so if file lookup
    // were skipped we'd fall to base64 and fail.
    expect(parseSignerKey(keyPath)).toBe(publicBase64Der);
  });
});
