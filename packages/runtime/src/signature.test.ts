import * as crypto from "crypto";
import { buildSigningPayload, verifySignature } from "./index";

import type { PackedArtifact } from "@clef-sh/core";

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    revision: "1711101600000-a1b2c3d4",
    packedAt: "2026-03-22T10:00:00.000Z",
    ciphertextHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
    ...overrides,
  };
}

describe("signature helpers re-exported from @clef-sh/core", () => {
  it("buildSigningPayload produces the canonical v3 payload", () => {
    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact).toString("utf-8");

    expect(payload).toContain("clef-sig-v3");
    expect(payload).toContain("api-gateway");
    expect(payload).toContain("production");
  });

  it("buildSigningPayload is deterministic", () => {
    const a1 = makeArtifact();
    const a2 = makeArtifact();
    expect(buildSigningPayload(a1).equals(buildSigningPayload(a2))).toBe(true);
  });

  it("buildSigningPayload includes envelope fields when present", () => {
    const artifact = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:test",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "dGVzdC1pdg==",
        authTag: "dGVzdC1hdXRo",
      },
    });
    const payload = buildSigningPayload(artifact).toString("utf-8");
    expect(payload).toContain("aws");
    expect(payload).toContain("arn:aws:kms:test");
  });

  it("verifySignature accepts a valid Ed25519 signature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign(null, payload, privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(true);
  });

  it("verifySignature rejects a signature from a different key", () => {
    const kp1 = crypto.generateKeyPairSync("ed25519");
    const kp2 = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (kp2.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign(null, payload, kp1.privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(false);
  });

  it("verifySignature accepts a valid ECDSA_SHA256 signature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign("sha256", payload, privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(true);
  });

  it("verifySignature rejects a tampered payload", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const original = buildSigningPayload(makeArtifact({ revision: "original" }));
    const signature = crypto.sign(null, original, privateKey).toString("base64");

    const tampered = buildSigningPayload(makeArtifact({ revision: "tampered" }));
    expect(verifySignature(tampered, signature, pubBase64)).toBe(false);
  });

  it("verifySignature throws for unsupported key types", () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());

    expect(() => verifySignature(payload, "dGVzdA==", pubBase64)).toThrow("Unsupported key type");
  });

  it("produces canonical payload matching the locked v3 format", () => {
    // This test pins the exact byte layout of the signing payload.
    // If core's signer.ts changes this format, both this test and
    // core/src/artifact/signer.test.ts should fail together.
    const artifact = makeArtifact({
      expiresAt: "2026-03-22T12:00:00.000Z",
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        wrappedKey: "d3JhcHBlZC1hZ2Uta2V5LWhlcmU=",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "dGVzdC1pdi0xMjM0",
        authTag: "dGVzdC1hdXRoLXRhZy0xMjM0NTY=",
      },
    });

    const payload = buildSigningPayload(artifact).toString("utf-8");

    const expected = [
      "clef-sig-v3",
      "1",
      "api-gateway",
      "production",
      "1711101600000-a1b2c3d4",
      "2026-03-22T10:00:00.000Z",
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "2026-03-22T12:00:00.000Z",
      "aws",
      "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
      "d3JhcHBlZC1hZ2Uta2V5LWhlcmU=",
      "SYMMETRIC_DEFAULT",
      "dGVzdC1pdi0xMjM0",
      "dGVzdC1hdXRoLXRhZy0xMjM0NTY=",
    ].join("\n");

    expect(payload).toBe(expected);
    expect(payload.split("\n")).toHaveLength(14);
  });
});
