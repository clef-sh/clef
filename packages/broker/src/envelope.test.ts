import * as crypto from "crypto";
import { packEnvelope } from "./envelope";
import type { PackedArtifact } from "@clef-sh/core";
import type { KmsProvider, KmsWrapResult } from "@clef-sh/runtime";

function mockKms(): jest.Mocked<KmsProvider> {
  return {
    wrap: jest.fn().mockResolvedValue({
      wrappedKey: Buffer.from("wrapped-dek-key"),
      algorithm: "SYMMETRIC_DEFAULT",
    } as KmsWrapResult),
    unwrap: jest.fn(),
  };
}

function baseOptions(kms: KmsProvider) {
  return {
    identity: "rds-primary",
    environment: "production",
    data: { DB_TOKEN: "token-value-123", DB_HOST: "rds.example.com" },
    ttl: 900,
    kmsProvider: kms,
    kmsProviderName: "aws",
    kmsKeyId: "arn:aws:kms:us-east-1:123:key/abc",
  };
}

describe("packEnvelope", () => {
  let kms: jest.Mocked<KmsProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    kms = mockKms();
  });

  it("produces valid JSON with all required fields", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("rds-primary");
    expect(artifact.environment).toBe("production");
    expect(artifact.packedAt).toBeTruthy();
    expect(artifact.revision).toBeTruthy();
    expect(artifact.ciphertextHash).toBeTruthy();
    expect(artifact.ciphertext).toBeTruthy();
    expect(artifact.envelope).toBeDefined();
    expect(artifact.expiresAt).toBeTruthy();
  });

  it("ciphertextHash matches SHA-256 of ciphertext", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    const expected = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    expect(artifact.ciphertextHash).toBe(expected);
  });

  it("expiresAt is ttl seconds after packedAt", async () => {
    const before = Date.now();
    const json = await packEnvelope(baseOptions(kms));
    const after = Date.now();
    const artifact: PackedArtifact = JSON.parse(json);

    const expiresAt = new Date(artifact.expiresAt!).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 900_000);
  });

  it("envelope contains correct KMS metadata", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    expect(artifact.envelope!.provider).toBe("aws");
    expect(artifact.envelope!.keyId).toBe("arn:aws:kms:us-east-1:123:key/abc");
    expect(artifact.envelope!.algorithm).toBe("SYMMETRIC_DEFAULT");
  });

  it("wrappedKey is base64-encoded", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    const decoded = Buffer.from(artifact.envelope!.wrappedKey, "base64");
    expect(decoded.toString()).toBe("wrapped-dek-key");
  });

  it("envelope contains iv and authTag with correct sizes", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    expect(artifact.envelope!.iv).toBeTruthy();
    expect(Buffer.from(artifact.envelope!.iv, "base64")).toHaveLength(12);
    expect(artifact.envelope!.authTag).toBeTruthy();
    expect(Buffer.from(artifact.envelope!.authTag, "base64")).toHaveLength(16);
  });

  it("does not include keys in the envelope", async () => {
    const json = await packEnvelope({
      ...baseOptions(kms),
      data: { A: "1", B: "2", C: "3" },
    });
    const raw = JSON.parse(json);
    expect(raw.keys).toBeUndefined();
  });

  it("revision has timestamp-hex format", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);
    expect(artifact.revision).toMatch(/^\d+-[0-9a-f]{8}$/);
  });

  it("ciphertext is base64-encoded", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: PackedArtifact = JSON.parse(json);

    // Should not throw on base64 decode
    const decoded = Buffer.from(artifact.ciphertext, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("calls kms.wrap with the key ID and a 32-byte DEK", async () => {
    await packEnvelope(baseOptions(kms));

    expect(kms.wrap).toHaveBeenCalledTimes(1);
    expect(kms.wrap).toHaveBeenCalledWith("arn:aws:kms:us-east-1:123:key/abc", expect.any(Buffer));
    // DEK should be 32 bytes (AES-256)
    const wrappedDek = kms.wrap.mock.calls[0][1] as Buffer;
    expect(wrappedDek).toHaveLength(32);
  });

  it("propagates KMS wrap errors", async () => {
    kms.wrap.mockRejectedValueOnce(new Error("KMS unavailable"));

    await expect(packEnvelope(baseOptions(kms))).rejects.toThrow("KMS unavailable");
  });

  it("zeroes the DEK even when kms.wrap() throws", async () => {
    let capturedDek: Buffer | null = null;
    kms.wrap.mockImplementation((_keyId: string, dek: Buffer) => {
      capturedDek = dek; // Capture the actual buffer reference (not a copy)
      return Promise.reject(new Error("KMS wrap failure"));
    });

    await expect(packEnvelope(baseOptions(kms))).rejects.toThrow("KMS wrap failure");

    // The DEK buffer should have been zeroed in the finally block
    expect(capturedDek).not.toBeNull();
    expect(Buffer.alloc(32).equals(capturedDek!)).toBe(true);
  });

  it("produces AES-256-GCM ciphertext that can be round-tripped", async () => {
    let capturedDek: Buffer | null = null;
    kms.wrap.mockImplementation((_keyId: string, dek: Buffer) => {
      capturedDek = Buffer.from(dek); // copy before zeroed
      return Promise.resolve({
        wrappedKey: Buffer.from("wrapped-dek-key"),
        algorithm: "SYMMETRIC_DEFAULT",
      } as KmsWrapResult);
    });

    const json = await packEnvelope({
      ...baseOptions(kms),
      data: { ROUND_TRIP: "success" },
    });
    const artifact: PackedArtifact = JSON.parse(json);

    expect(capturedDek).not.toBeNull();
    const iv = Buffer.from(artifact.envelope!.iv, "base64");
    const authTag = Buffer.from(artifact.envelope!.authTag, "base64");
    const ciphertextBuf = Buffer.from(artifact.ciphertext, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", capturedDek!, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]).toString(
      "utf-8",
    );
    expect(JSON.parse(plaintext)).toEqual({ ROUND_TRIP: "success" });
  });

  it("does not contain plaintext data values in the output", async () => {
    const json = await packEnvelope(baseOptions(kms));
    expect(json).not.toContain("token-value-123");
    expect(json).not.toContain("rds.example.com");
  });
});
