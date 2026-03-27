import * as crypto from "crypto";
import { buildSigningPayload, verifySignature } from "./signature";

function makeArtifact(
  overrides: Partial<{
    version: number;
    identity: string;
    environment: string;
    revision: string;
    packedAt: string;
    ciphertextHash: string;
    keys: string[];
    expiresAt: string;
    envelope: {
      provider: string;
      keyId: string;
      wrappedKey: string;
      algorithm: string;
      iv?: string;
      authTag?: string;
    };
  }> = {},
) {
  return {
    version: overrides.version ?? 1,
    identity: overrides.identity ?? "api-gateway",
    environment: overrides.environment ?? "production",
    revision: overrides.revision ?? "1711101600000-a1b2c3d4",
    packedAt: overrides.packedAt ?? "2026-03-22T10:00:00.000Z",
    ciphertextHash:
      overrides.ciphertextHash ??
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    keys: overrides.keys ?? ["DB_URL", "API_KEY"],
    expiresAt: overrides.expiresAt,
    envelope: overrides.envelope,
  };
}

describe("buildSigningPayload (runtime)", () => {
  it("should produce the same payload as core for identical artifacts", () => {
    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact);

    expect(payload.toString("utf-8")).toContain("clef-sig-v2");
    expect(payload.toString("utf-8")).toContain("api-gateway");
    expect(payload.toString("utf-8")).toContain("production");
  });

  it("should sort keys deterministically", () => {
    const a1 = makeArtifact({ keys: ["Z", "A"] });
    const a2 = makeArtifact({ keys: ["A", "Z"] });
    expect(buildSigningPayload(a1).equals(buildSigningPayload(a2))).toBe(true);
  });

  it("should include envelope fields when present", () => {
    const artifact = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:test",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
      },
    });
    const payload = buildSigningPayload(artifact).toString("utf-8");
    expect(payload).toContain("aws");
    expect(payload).toContain("arn:aws:kms:test");
  });
});

describe("verifySignature (runtime)", () => {
  it("should verify a valid Ed25519 signature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign(null, payload, privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(true);
  });

  it("should reject an invalid Ed25519 signature", () => {
    const kp1 = crypto.generateKeyPairSync("ed25519");
    const kp2 = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (kp2.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign(null, payload, kp1.privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(false);
  });

  it("should verify a valid ECDSA_SHA256 signature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());
    const signature = crypto.sign("sha256", payload, privateKey).toString("base64");

    expect(verifySignature(payload, signature, pubBase64)).toBe(true);
  });

  it("should reject a tampered payload", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const original = buildSigningPayload(makeArtifact({ revision: "original" }));
    const signature = crypto.sign(null, original, privateKey).toString("base64");

    const tampered = buildSigningPayload(makeArtifact({ revision: "tampered" }));
    expect(verifySignature(tampered, signature, pubBase64)).toBe(false);
  });

  it("should throw for unsupported key types", () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    const payload = buildSigningPayload(makeArtifact());

    expect(() => verifySignature(payload, "dGVzdA==", pubBase64)).toThrow("Unsupported key type");
  });
});

describe("cross-package payload contract", () => {
  it("produces canonical payload matching core signer specification", () => {
    // Uses the EXACT same artifact and expected output as
    // core/src/artifact/signer.test.ts "produces canonical payload matching runtime specification".
    // If either implementation drifts, both this test and the core test will fail.
    const artifact = makeArtifact({
      keys: ["DB_URL", "API_KEY", "STRIPE_SECRET"],
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
      "clef-sig-v2",
      "1",
      "api-gateway",
      "production",
      "1711101600000-a1b2c3d4",
      "2026-03-22T10:00:00.000Z",
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "API_KEY,DB_URL,STRIPE_SECRET",
      "2026-03-22T12:00:00.000Z",
      "aws",
      "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
      "d3JhcHBlZC1hZ2Uta2V5LWhlcmU=",
      "SYMMETRIC_DEFAULT",
      "dGVzdC1pdi0xMjM0",
      "dGVzdC1hdXRoLXRhZy0xMjM0NTY=",
    ].join("\n");

    expect(payload).toBe(expected);
    expect(payload.split("\n")).toHaveLength(15);
  });
});
