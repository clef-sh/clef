import * as crypto from "crypto";
import { ArtifactDecryptor } from "./artifact-decryptor";
import type { PackedArtifact } from "@clef-sh/core";
import { TelemetryEmitter } from "./telemetry";

jest.mock(
  "age-encryption",
  () => ({
    Decrypter: jest.fn().mockImplementation(() => ({
      addIdentity: jest.fn(),
      decrypt: jest.fn().mockResolvedValue('{"DB_URL":"postgres://...","API_KEY":"secret"}'),
    })),
  }),
  { virtual: true },
);

jest.mock("./kms", () => {
  const unwrapFn = jest.fn();
  return {
    createKmsProvider: jest.fn().mockReturnValue({
      wrap: jest.fn(),
      unwrap: unwrapFn,
    }),
    __mockUnwrap: unwrapFn,
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports -- access mock fn
const { __mockUnwrap: mockKmsUnwrap } = require("./kms") as { __mockUnwrap: jest.Mock };

/** Build a minimal age-only artifact envelope. */
function makeAgeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  const ciphertext =
    overrides.ciphertext ??
    "-----BEGIN AGE ENCRYPTED FILE-----\nmock\n-----END AGE ENCRYPTED FILE-----";
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision: overrides.revision ?? "age-rev-1",
    ciphertextHash: crypto.createHash("sha256").update(ciphertext).digest("hex"),
    ciphertext,
    ...overrides,
  };
}

/**
 * Build a KMS envelope artifact with real AES-256-GCM encryption.
 * Returns the artifact and the DEK for mock setup.
 */
function makeKmsArtifact(
  testDek: Buffer,
  values: Record<string, string>,
  overrides: Partial<PackedArtifact> = {},
): PackedArtifact {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", testDek, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(values), "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = ct.toString("base64");

  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision: overrides.revision ?? "kms-rev",
    ciphertextHash: crypto.createHash("sha256").update(ciphertext).digest("hex"),
    ciphertext,
    envelope: {
      provider: "aws",
      keyId: "arn:aws:kms:us-east-1:111:key/test",
      wrappedKey: Buffer.from("wrapped-key").toString("base64"),
      algorithm: "SYMMETRIC_DEFAULT",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    },
    ...overrides,
  };
}

function makeTelemetry(): {
  artifactRefreshed: jest.Mock;
  fetchFailed: jest.Mock;
  artifactRevoked: jest.Mock;
  artifactExpired: jest.Mock;
  cacheExpired: jest.Mock;
  artifactInvalid: jest.Mock;
} {
  return {
    artifactRefreshed: jest.fn(),
    fetchFailed: jest.fn(),
    artifactRevoked: jest.fn(),
    artifactExpired: jest.fn(),
    cacheExpired: jest.fn(),
    artifactInvalid: jest.fn(),
  };
}

describe("ArtifactDecryptor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("age decryption", () => {
    it("should decrypt an age artifact and return values", async () => {
      const decryptor = new ArtifactDecryptor({ privateKey: "AGE-SECRET-KEY-1TEST" });
      const result = await decryptor.decrypt(makeAgeArtifact());

      expect(result.values).toEqual({ DB_URL: "postgres://...", API_KEY: "secret" });
      expect(result.keys).toEqual(["DB_URL", "API_KEY"]);
      expect(result.revision).toBe("age-rev-1");
    });

    it("should throw when no private key is provided (config error)", async () => {
      const decryptor = new ArtifactDecryptor({});

      await expect(decryptor.decrypt(makeAgeArtifact())).rejects.toThrow(
        "requires an age private key",
      );
    });

    it("should not emit artifact.invalid for missing private key", async () => {
      const telemetry = makeTelemetry();
      const decryptor = new ArtifactDecryptor({
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(decryptor.decrypt(makeAgeArtifact())).rejects.toThrow();
      expect(telemetry.artifactInvalid).not.toHaveBeenCalled();
    });

    it("should emit artifact.invalid with reason decrypt on age failure", async () => {
      const ageModule = await import("age-encryption");
      (ageModule.Decrypter as jest.Mock).mockImplementationOnce(() => ({
        addIdentity: jest.fn(),
        decrypt: jest.fn().mockRejectedValue(new Error("decryption failed")),
      }));

      const telemetry = makeTelemetry();
      const decryptor = new ArtifactDecryptor({
        privateKey: "AGE-SECRET-KEY-1TEST",
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(decryptor.decrypt(makeAgeArtifact())).rejects.toThrow("decryption failed");
      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "decrypt",
        error: "decryption failed",
      });
    });
  });

  describe("KMS envelope decryption", () => {
    it("should unwrap DEK via KMS and decrypt with AES-256-GCM", async () => {
      const testDek = crypto.randomBytes(32);
      mockKmsUnwrap.mockResolvedValue(Buffer.from(testDek));

      const testValues = { DB_URL: "postgres://...", API_KEY: "secret" };
      const artifact = makeKmsArtifact(testDek, testValues);

      const decryptor = new ArtifactDecryptor({});
      const result = await decryptor.decrypt(artifact);

      expect(result.values).toEqual(testValues);
      expect(result.keys).toEqual(["DB_URL", "API_KEY"]);
      expect(result.revision).toBe("kms-rev");
      expect(mockKmsUnwrap).toHaveBeenCalledWith(
        "arn:aws:kms:us-east-1:111:key/test",
        expect.any(Buffer),
        "SYMMETRIC_DEFAULT",
      );
    });

    it("should not require a private key for KMS artifacts", async () => {
      const testDek = crypto.randomBytes(32);
      mockKmsUnwrap.mockResolvedValue(Buffer.from(testDek));

      const artifact = makeKmsArtifact(testDek, { KEY: "val" });
      const decryptor = new ArtifactDecryptor({}); // no privateKey

      const result = await decryptor.decrypt(artifact);
      expect(result.values).toEqual({ KEY: "val" });
    });

    it("should throw on AES-GCM authentication failure (corrupted authTag)", async () => {
      const testDek = crypto.randomBytes(32);
      mockKmsUnwrap.mockResolvedValue(Buffer.from(testDek));

      const artifact = makeKmsArtifact(testDek, { KEY: "val" });
      artifact.envelope!.authTag = Buffer.from("corrupted-tag!!!").toString("base64");

      const decryptor = new ArtifactDecryptor({});
      await expect(decryptor.decrypt(artifact)).rejects.toThrow();
    });

    it("should emit artifact.invalid with reason kms_unwrap on KMS failure", async () => {
      mockKmsUnwrap.mockRejectedValue(new Error("KMS access denied"));

      const testDek = crypto.randomBytes(32);
      const artifact = makeKmsArtifact(testDek, { KEY: "val" });

      const telemetry = makeTelemetry();
      const decryptor = new ArtifactDecryptor({
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(decryptor.decrypt(artifact)).rejects.toThrow("KMS access denied");
      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "kms_unwrap",
        error: "KMS access denied",
      });
    });

    it("should emit artifact.invalid with reason decrypt on AES-GCM failure", async () => {
      const testDek = crypto.randomBytes(32);
      mockKmsUnwrap.mockResolvedValue(Buffer.from(testDek));

      const artifact = makeKmsArtifact(testDek, { KEY: "val" });
      artifact.envelope!.authTag = Buffer.from("corrupted-tag!!!").toString("base64");

      const telemetry = makeTelemetry();
      const decryptor = new ArtifactDecryptor({
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(decryptor.decrypt(artifact)).rejects.toThrow();
      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "decrypt",
        error: expect.any(String),
      });
    });

    it("should zero the DEK even when AES-GCM decrypt fails", async () => {
      const testDek = crypto.randomBytes(32);
      const dekCopy = Buffer.from(testDek);
      mockKmsUnwrap.mockResolvedValue(dekCopy);

      const artifact = makeKmsArtifact(testDek, { KEY: "val" });
      artifact.envelope!.authTag = Buffer.from("corrupted-tag!!!").toString("base64");

      const decryptor = new ArtifactDecryptor({});
      await expect(decryptor.decrypt(artifact)).rejects.toThrow();

      // The DEK buffer should have been zeroed in the finally block
      expect(Buffer.alloc(32).equals(dekCopy)).toBe(true);
    });
  });

  describe("payload parsing", () => {
    it("should emit artifact.invalid with reason payload_parse on malformed JSON", async () => {
      const ageModule = await import("age-encryption");
      (ageModule.Decrypter as jest.Mock).mockImplementationOnce(() => ({
        addIdentity: jest.fn(),
        decrypt: jest.fn().mockResolvedValue("not valid json{{{"),
      }));

      const telemetry = makeTelemetry();
      const decryptor = new ArtifactDecryptor({
        privateKey: "AGE-SECRET-KEY-1TEST",
        telemetry: telemetry as unknown as TelemetryEmitter,
      });

      await expect(decryptor.decrypt(makeAgeArtifact())).rejects.toThrow(SyntaxError);
      expect(telemetry.artifactInvalid).toHaveBeenCalledWith({
        reason: "payload_parse",
        error: expect.any(String),
      });
    });
  });

  describe("telemetry override", () => {
    it("should use overridden telemetry after setTelemetry()", async () => {
      const initial = makeTelemetry();
      const override = makeTelemetry();

      mockKmsUnwrap.mockRejectedValue(new Error("KMS denied"));

      const testDek = crypto.randomBytes(32);
      const artifact = makeKmsArtifact(testDek, { KEY: "val" });

      const decryptor = new ArtifactDecryptor({
        telemetry: initial as unknown as TelemetryEmitter,
      });
      decryptor.setTelemetry(override as unknown as TelemetryEmitter);

      await expect(decryptor.decrypt(artifact)).rejects.toThrow();
      expect(initial.artifactInvalid).not.toHaveBeenCalled();
      expect(override.artifactInvalid).toHaveBeenCalled();
    });
  });
});
