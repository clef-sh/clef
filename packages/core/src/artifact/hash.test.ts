import * as crypto from "crypto";
import { computeCiphertextHash } from "./hash";

describe("computeCiphertextHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = computeCiphertextHash("any-ciphertext");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const ciphertext = "some-base64-encoded-ciphertext";
    expect(computeCiphertextHash(ciphertext)).toBe(computeCiphertextHash(ciphertext));
  });

  it("produces different hashes for different inputs", () => {
    expect(computeCiphertextHash("a")).not.toBe(computeCiphertextHash("b"));
  });

  it("matches a direct sha256 hex digest (canonical formula)", () => {
    const ciphertext = "aGVsbG8td29ybGQ=";
    const expected = crypto.createHash("sha256").update(ciphertext).digest("hex");
    expect(computeCiphertextHash(ciphertext)).toBe(expected);
  });

  it("handles empty string", () => {
    expect(computeCiphertextHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
