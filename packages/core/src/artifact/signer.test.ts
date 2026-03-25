import * as crypto from "crypto";
import {
  buildSigningPayload,
  generateSigningKeyPair,
  signEd25519,
  signKms,
  verifySignature,
  detectAlgorithm,
} from "./signer";
import type { PackedArtifact } from "./types";
import type { KmsProvider } from "../kms";

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2026-03-22T10:00:00.000Z",
    revision: "1711101600000-a1b2c3d4",
    ciphertextHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ciphertext: "base64-encoded-ciphertext",
    keys: ["DB_URL", "API_KEY", "STRIPE_SECRET"],
    ...overrides,
  };
}

describe("buildSigningPayload", () => {
  it("should produce a deterministic payload", () => {
    const artifact = makeArtifact();
    const p1 = buildSigningPayload(artifact);
    const p2 = buildSigningPayload(artifact);
    expect(p1.equals(p2)).toBe(true);
  });

  it("should sort keys to ensure determinism", () => {
    const a1 = makeArtifact({ keys: ["Z_KEY", "A_KEY", "M_KEY"] });
    const a2 = makeArtifact({ keys: ["A_KEY", "M_KEY", "Z_KEY"] });
    expect(buildSigningPayload(a1).equals(buildSigningPayload(a2))).toBe(true);
  });

  it("should include all security-relevant fields", () => {
    const artifact = makeArtifact({ expiresAt: "2026-03-22T11:00:00.000Z" });
    const payload = buildSigningPayload(artifact).toString("utf-8");

    expect(payload).toContain("clef-sig-v1");
    expect(payload).toContain("1");
    expect(payload).toContain("api-gateway");
    expect(payload).toContain("production");
    expect(payload).toContain("1711101600000-a1b2c3d4");
    expect(payload).toContain("2026-03-22T10:00:00.000Z");
    expect(payload).toContain(artifact.ciphertextHash);
    expect(payload).toContain("API_KEY,DB_URL,STRIPE_SECRET");
    expect(payload).toContain("2026-03-22T11:00:00.000Z");
  });

  it("should produce different payloads for different revisions", () => {
    const a1 = makeArtifact({ revision: "rev-1" });
    const a2 = makeArtifact({ revision: "rev-2" });
    expect(buildSigningPayload(a1).equals(buildSigningPayload(a2))).toBe(false);
  });

  it("should include envelope fields when present", () => {
    const artifact = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:111:key/test",
        wrappedKey: "d3JhcHBlZC1rZXk=",
        algorithm: "SYMMETRIC_DEFAULT",
      },
    });
    const payload = buildSigningPayload(artifact).toString("utf-8");
    expect(payload).toContain("aws");
    expect(payload).toContain("arn:aws:kms:us-east-1:111:key/test");
    expect(payload).toContain("d3JhcHBlZC1rZXk=");
    expect(payload).toContain("SYMMETRIC_DEFAULT");
  });

  it("should use empty strings for missing optional fields", () => {
    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact).toString("utf-8");
    const lines = payload.split("\n");
    // expiresAt and envelope fields should be empty strings
    expect(lines[8]).toBe(""); // expiresAt
    expect(lines[9]).toBe(""); // envelope.provider
    expect(lines[10]).toBe(""); // envelope.keyId
    expect(lines[11]).toBe(""); // envelope.wrappedKey
    expect(lines[12]).toBe(""); // envelope.algorithm
  });

  it("produces canonical payload matching runtime specification", () => {
    // Construct an artifact with ALL fields populated, including envelope and expiresAt.
    // This hardcoded expected value acts as a cross-package contract test: if either
    // the core signer or the runtime signature module drifts, this test will catch it.
    const artifact = makeArtifact({
      expiresAt: "2026-03-22T12:00:00.000Z",
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        wrappedKey: "d3JhcHBlZC1hZ2Uta2V5LWhlcmU=",
        algorithm: "SYMMETRIC_DEFAULT",
      },
    });

    const payload = buildSigningPayload(artifact).toString("utf-8");

    // The canonical format is: domain prefix, then each field on its own line,
    // keys sorted lexicographically and comma-joined, missing optionals as "".
    const expected = [
      "clef-sig-v1",
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
    ].join("\n");

    expect(payload).toBe(expected);

    // Verify exact line count (13 lines = domain prefix + 12 fields)
    expect(payload.split("\n")).toHaveLength(13);
  });
});

describe("generateSigningKeyPair", () => {
  it("should generate a valid Ed25519 key pair", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();

    expect(publicKey).toBeTruthy();
    expect(privateKey).toBeTruthy();

    // Should be valid base64
    expect(() => Buffer.from(publicKey, "base64")).not.toThrow();
    expect(() => Buffer.from(privateKey, "base64")).not.toThrow();

    // Should be importable as DER keys
    const pubKeyObj = crypto.createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    expect(pubKeyObj.asymmetricKeyType).toBe("ed25519");

    const privKeyObj = crypto.createPrivateKey({
      key: Buffer.from(privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    expect(privKeyObj.asymmetricKeyType).toBe("ed25519");
  });

  it("should generate unique key pairs on each call", () => {
    const kp1 = generateSigningKeyPair();
    const kp2 = generateSigningKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });
});

describe("signEd25519 + verifySignature", () => {
  it("should sign and verify successfully with matching key pair", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact);

    const signature = signEd25519(payload, privateKey);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe("string");

    const valid = verifySignature(payload, signature, publicKey);
    expect(valid).toBe(true);
  });

  it("should fail verification with wrong public key", () => {
    const kp1 = generateSigningKeyPair();
    const kp2 = generateSigningKeyPair();
    const payload = buildSigningPayload(makeArtifact());

    const signature = signEd25519(payload, kp1.privateKey);
    const valid = verifySignature(payload, signature, kp2.publicKey);
    expect(valid).toBe(false);
  });

  it("should fail verification with tampered payload", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact);
    const signature = signEd25519(payload, privateKey);

    const tampered = makeArtifact({ revision: "tampered-revision" });
    const tamperedPayload = buildSigningPayload(tampered);

    const valid = verifySignature(tamperedPayload, signature, publicKey);
    expect(valid).toBe(false);
  });

  it("should fail verification with tampered signature", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const payload = buildSigningPayload(makeArtifact());
    const signature = signEd25519(payload, privateKey);

    // Flip a byte in the signature
    const sigBuf = Buffer.from(signature, "base64");
    sigBuf[0] ^= 0xff;
    const tampered = sigBuf.toString("base64");

    const valid = verifySignature(payload, tampered, publicKey);
    expect(valid).toBe(false);
  });
});

describe("signKms", () => {
  it("should call kms.sign with SHA-256 digest of payload", async () => {
    const mockSignature = crypto.randomBytes(64);
    const kms: KmsProvider = {
      wrap: jest.fn(),
      unwrap: jest.fn(),
      sign: jest.fn().mockResolvedValue(mockSignature),
    };

    const payload = buildSigningPayload(makeArtifact());
    const result = await signKms(payload, kms, "arn:aws:kms:us-east-1:111:key/sign-key");

    expect(kms.sign).toHaveBeenCalledWith(
      "arn:aws:kms:us-east-1:111:key/sign-key",
      expect.any(Buffer),
    );

    // Verify the digest passed to kms.sign is SHA-256 of the payload
    const expectedDigest = crypto.createHash("sha256").update(payload).digest();
    expect((kms.sign as jest.Mock).mock.calls[0][1].equals(expectedDigest)).toBe(true);

    expect(result).toBe(mockSignature.toString("base64"));
  });

  it("should throw if kms provider does not support signing", async () => {
    const kms: KmsProvider = {
      wrap: jest.fn(),
      unwrap: jest.fn(),
    };

    const payload = buildSigningPayload(makeArtifact());
    await expect(signKms(payload, kms, "key-id")).rejects.toThrow("does not support signing");
  });
});

describe("detectAlgorithm", () => {
  it("should detect Ed25519 from an Ed25519 public key", () => {
    const { publicKey } = generateSigningKeyPair();
    expect(detectAlgorithm(publicKey)).toBe("Ed25519");
  });

  it("should detect ECDSA_SHA256 from an EC P-256 public key", () => {
    const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );
    expect(detectAlgorithm(pubBase64)).toBe("ECDSA_SHA256");
  });
});

describe("ECDSA sign + verify round-trip", () => {
  it("should verify ECDSA_SHA256 signatures via verifySignature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pubBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );

    const artifact = makeArtifact();
    const payload = buildSigningPayload(artifact);

    // Sign with ECDSA (simulating what KMS would return)
    const signature = crypto.sign("sha256", payload, privateKey);
    const sigBase64 = signature.toString("base64");

    const valid = verifySignature(payload, sigBase64, pubBase64);
    expect(valid).toBe(true);
  });
});
