import * as crypto from "crypto";
import { packEnvelope, BrokerArtifact } from "./envelope";
import type { KmsProvider, KmsWrapResult } from "@clef-sh/runtime";

jest.mock(
  "age-encryption",
  () => ({
    Encrypter: jest.fn().mockImplementation(() => ({
      addRecipient: jest.fn(),
      encrypt: jest.fn().mockResolvedValue(new TextEncoder().encode("age-encrypted-payload-bytes")),
    })),
    generateIdentity: jest.fn().mockResolvedValue("AGE-SECRET-KEY-1EPHEMERAL"),
    identityToRecipient: jest.fn().mockResolvedValue("age1ephemeralrecipient"),
  }),
  { virtual: true },
);

function mockKms(): jest.Mocked<KmsProvider> {
  return {
    wrap: jest.fn().mockResolvedValue({
      wrappedKey: Buffer.from("wrapped-ephemeral-key"),
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
    const artifact: BrokerArtifact = JSON.parse(json);

    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("rds-primary");
    expect(artifact.environment).toBe("production");
    expect(artifact.packedAt).toBeTruthy();
    expect(artifact.revision).toBeTruthy();
    expect(artifact.ciphertextHash).toBeTruthy();
    expect(artifact.ciphertext).toBeTruthy();
    expect(artifact.keys).toEqual(["DB_TOKEN", "DB_HOST"]);
    expect(artifact.envelope).toBeDefined();
    expect(artifact.expiresAt).toBeTruthy();
  });

  it("ciphertextHash matches SHA-256 of ciphertext", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: BrokerArtifact = JSON.parse(json);

    const expected = crypto.createHash("sha256").update(artifact.ciphertext).digest("hex");
    expect(artifact.ciphertextHash).toBe(expected);
  });

  it("expiresAt is ttl seconds after packedAt", async () => {
    const before = Date.now();
    const json = await packEnvelope(baseOptions(kms));
    const after = Date.now();
    const artifact: BrokerArtifact = JSON.parse(json);

    const expiresAt = new Date(artifact.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 900_000);
  });

  it("envelope contains correct KMS metadata", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: BrokerArtifact = JSON.parse(json);

    expect(artifact.envelope.provider).toBe("aws");
    expect(artifact.envelope.keyId).toBe("arn:aws:kms:us-east-1:123:key/abc");
    expect(artifact.envelope.algorithm).toBe("SYMMETRIC_DEFAULT");
  });

  it("wrappedKey is base64-encoded", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: BrokerArtifact = JSON.parse(json);

    const decoded = Buffer.from(artifact.envelope.wrappedKey, "base64");
    expect(decoded.toString()).toBe("wrapped-ephemeral-key");
  });

  it("keys matches Object.keys(data)", async () => {
    const json = await packEnvelope({
      ...baseOptions(kms),
      data: { A: "1", B: "2", C: "3" },
    });
    const artifact: BrokerArtifact = JSON.parse(json);
    expect(artifact.keys).toEqual(["A", "B", "C"]);
  });

  it("revision has timestamp-hex format", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: BrokerArtifact = JSON.parse(json);
    expect(artifact.revision).toMatch(/^\d+-[0-9a-f]{8}$/);
  });

  it("ciphertext is base64-encoded", async () => {
    const json = await packEnvelope(baseOptions(kms));
    const artifact: BrokerArtifact = JSON.parse(json);

    // Should not throw on base64 decode
    const decoded = Buffer.from(artifact.ciphertext, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("calls kms.wrap with the key ID and ephemeral private key", async () => {
    await packEnvelope(baseOptions(kms));

    expect(kms.wrap).toHaveBeenCalledTimes(1);
    expect(kms.wrap).toHaveBeenCalledWith(
      "arn:aws:kms:us-east-1:123:key/abc",
      Buffer.from("AGE-SECRET-KEY-1EPHEMERAL"),
    );
  });

  it("propagates KMS wrap errors", async () => {
    kms.wrap.mockRejectedValueOnce(new Error("KMS unavailable"));

    await expect(packEnvelope(baseOptions(kms))).rejects.toThrow("KMS unavailable");
  });

  it("propagates age-encryption errors", async () => {
    const ageModule = await import("age-encryption");
    (ageModule.Encrypter as jest.Mock).mockImplementationOnce(() => ({
      addRecipient: jest.fn(),
      encrypt: jest.fn().mockRejectedValue(new Error("encryption failed")),
    }));

    await expect(packEnvelope(baseOptions(kms))).rejects.toThrow("encryption failed");
  });

  it("does not contain plaintext data values in the output", async () => {
    const json = await packEnvelope(baseOptions(kms));
    expect(json).not.toContain("token-value-123");
    expect(json).not.toContain("rds.example.com");
  });
});
