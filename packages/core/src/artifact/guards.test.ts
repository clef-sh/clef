import {
  assertPackedArtifact,
  InvalidArtifactError,
  isKmsEnvelope,
  isPackedArtifact,
  validatePackedArtifact,
} from "./guards";
import { ClefError } from "../types";
import type { KmsEnvelope, PackedArtifact } from "./types";

function baseArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2026-03-22T10:00:00.000Z",
    revision: "1711101600000-a1b2c3d4",
    ciphertextHash: "abc123",
    ciphertext: "dGVzdA==",
    ...overrides,
  };
}

function baseEnvelope(overrides: Partial<KmsEnvelope> = {}): KmsEnvelope {
  return {
    provider: "aws",
    keyId: "arn:aws:kms:us-east-1:123:key/abc",
    wrappedKey: "d3JhcHBlZA==",
    algorithm: "SYMMETRIC_DEFAULT",
    iv: "dGVzdC1pdg==",
    authTag: "dGVzdC1hdXRo",
    ...overrides,
  };
}

describe("isKmsEnvelope", () => {
  it("accepts a complete envelope", () => {
    expect(isKmsEnvelope(baseEnvelope())).toBe(true);
  });

  it("rejects null", () => {
    expect(isKmsEnvelope(null)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isKmsEnvelope("string")).toBe(false);
    expect(isKmsEnvelope(42)).toBe(false);
    expect(isKmsEnvelope(undefined)).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { iv: _iv, ...withoutIv } = baseEnvelope();
    expect(isKmsEnvelope(withoutIv)).toBe(false);

    const { authTag: _at, ...withoutAuth } = baseEnvelope();
    expect(isKmsEnvelope(withoutAuth)).toBe(false);

    const { provider: _p, ...withoutProvider } = baseEnvelope();
    expect(isKmsEnvelope(withoutProvider)).toBe(false);
  });

  it("rejects wrong field types", () => {
    expect(isKmsEnvelope({ ...baseEnvelope(), provider: 42 })).toBe(false);
    expect(isKmsEnvelope({ ...baseEnvelope(), iv: null })).toBe(false);
  });
});

describe("validatePackedArtifact", () => {
  it("accepts a minimal valid artifact", () => {
    const result = validatePackedArtifact(baseArtifact());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.identity).toBe("api-gateway");
    }
  });

  it("accepts an artifact with a KMS envelope", () => {
    const artifact = baseArtifact({ envelope: baseEnvelope() });
    expect(validatePackedArtifact(artifact).valid).toBe(true);
  });

  it("accepts an artifact with all optional fields", () => {
    const artifact = baseArtifact({
      envelope: baseEnvelope(),
      expiresAt: "2026-03-22T12:00:00.000Z",
      revokedAt: "2026-03-22T11:00:00.000Z",
      signature: "c2ln",
      signatureAlgorithm: "Ed25519",
    });
    expect(validatePackedArtifact(artifact).valid).toBe(true);
  });

  it("rejects null", () => {
    const result = validatePackedArtifact(null);
    expect(result).toEqual({ valid: false, reason: "expected object" });
  });

  it("rejects non-object", () => {
    expect(validatePackedArtifact("string").valid).toBe(false);
    expect(validatePackedArtifact(42).valid).toBe(false);
  });

  it("rejects unsupported version with field-level reason", () => {
    const result = validatePackedArtifact({ ...baseArtifact(), version: 2 });
    expect(result).toEqual({ valid: false, reason: "unsupported version: 2" });
  });

  it("rejects missing identity with field-level reason", () => {
    const { identity: _id, ...rest } = baseArtifact();
    const result = validatePackedArtifact(rest);
    expect(result).toEqual({
      valid: false,
      reason: "missing or invalid 'identity' (expected string)",
    });
  });

  it.each([
    ["environment", "missing or invalid 'environment' (expected string)"],
    ["packedAt", "missing or invalid 'packedAt' (expected string)"],
    ["revision", "missing or invalid 'revision' (expected string)"],
    ["ciphertextHash", "missing or invalid 'ciphertextHash' (expected string)"],
    ["ciphertext", "missing or invalid 'ciphertext' (expected string)"],
  ])("rejects missing %s", (field, reason) => {
    const artifact: Record<string, unknown> = { ...baseArtifact() };
    delete artifact[field];
    expect(validatePackedArtifact(artifact)).toEqual({ valid: false, reason });
  });

  it("rejects malformed envelope", () => {
    const artifact = { ...baseArtifact(), envelope: { provider: "aws" } };
    const result = validatePackedArtifact(artifact);
    expect(result).toEqual({
      valid: false,
      reason: "invalid 'envelope' (expected KmsEnvelope shape)",
    });
  });

  it("rejects non-string expiresAt", () => {
    const result = validatePackedArtifact({ ...baseArtifact(), expiresAt: 12345 });
    expect(result).toEqual({ valid: false, reason: "invalid 'expiresAt' (expected string)" });
  });

  it("rejects non-string revokedAt", () => {
    const result = validatePackedArtifact({ ...baseArtifact(), revokedAt: true });
    expect(result).toEqual({ valid: false, reason: "invalid 'revokedAt' (expected string)" });
  });

  it("rejects non-string signature", () => {
    const result = validatePackedArtifact({ ...baseArtifact(), signature: {} });
    expect(result).toEqual({ valid: false, reason: "invalid 'signature' (expected string)" });
  });

  it("rejects invalid signatureAlgorithm", () => {
    const result = validatePackedArtifact({ ...baseArtifact(), signatureAlgorithm: "RSA_PKCS1" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/signatureAlgorithm/);
      expect(result.reason).toMatch(/Ed25519/);
      expect(result.reason).toMatch(/ECDSA_SHA256/);
    }
  });

  it("accepts both Ed25519 and ECDSA_SHA256", () => {
    expect(validatePackedArtifact({ ...baseArtifact(), signatureAlgorithm: "Ed25519" }).valid).toBe(
      true,
    );
    expect(
      validatePackedArtifact({ ...baseArtifact(), signatureAlgorithm: "ECDSA_SHA256" }).valid,
    ).toBe(true);
  });
});

describe("isPackedArtifact", () => {
  it("returns true for a valid artifact", () => {
    expect(isPackedArtifact(baseArtifact())).toBe(true);
  });

  it("returns false for an invalid artifact", () => {
    expect(isPackedArtifact({ version: 1 })).toBe(false);
    expect(isPackedArtifact(null)).toBe(false);
  });
});

describe("assertPackedArtifact", () => {
  it("does not throw for a valid artifact", () => {
    expect(() => assertPackedArtifact(baseArtifact())).not.toThrow();
  });

  it("throws InvalidArtifactError when invalid", () => {
    expect(() => assertPackedArtifact(null)).toThrow(InvalidArtifactError);
  });

  it("throws an error that extends ClefError", () => {
    try {
      assertPackedArtifact(null);
    } catch (err) {
      expect(err).toBeInstanceOf(ClefError);
      expect((err as InvalidArtifactError).fix).toMatch(/compatible clef version/);
      return;
    }
    throw new Error("assertPackedArtifact did not throw");
  });

  it("throws with the reason when invalid", () => {
    expect(() => assertPackedArtifact({ ...baseArtifact(), version: 2 })).toThrow(
      /unsupported version: 2/,
    );
  });

  it("prefixes the error with the provided context", () => {
    expect(() => assertPackedArtifact(null, "fetched artifact")).toThrow(
      "fetched artifact: expected object",
    );
  });

  it("omits the prefix when no context is given", () => {
    expect(() => assertPackedArtifact(null)).toThrow("expected object");
  });

  it("narrows the type for TypeScript", () => {
    const unknownValue: unknown = baseArtifact();
    assertPackedArtifact(unknownValue);
    // After the assertion, TypeScript knows unknownValue is PackedArtifact.
    expect(unknownValue.identity).toBe("api-gateway");
  });
});
