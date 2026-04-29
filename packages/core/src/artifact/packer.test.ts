import * as fs from "fs";
import { ArtifactPacker } from "./packer";
import { ClefManifest, EncryptionBackend, DecryptedFile } from "../types";
import { KmsProvider, KmsWrapResult } from "../kms";
import { MatrixManager } from "../matrix/manager";
import { PackConfig, PackedArtifact } from "./types";
import { generateSigningKeyPair, buildSigningPayload, verifySignature } from "./signer";

jest.mock("fs");

// Mock age-encryption (only used for age-only path; KMS path uses Node crypto)
jest.mock(
  "age-encryption",
  () => ({
    Encrypter: jest.fn().mockImplementation(() => ({
      addRecipient: jest.fn(),
      encrypt: jest
        .fn()
        .mockResolvedValue(
          "-----BEGIN AGE ENCRYPTED FILE-----\nencrypted\n-----END AGE ENCRYPTED FILE-----",
        ),
    })),
  }),
  { virtual: true },
);

const mockFs = fs as jest.Mocked<typeof fs>;

function baseManifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "staging", description: "Staging" },
    ],
    namespaces: [
      { name: "api", description: "API secrets" },
      { name: "database", description: "DB config" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    service_identities: [
      {
        name: "api-gateway",
        description: "API gateway service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1devkey" },
          staging: { recipient: "age1stgkey" },
        },
      },
      {
        name: "multi-svc",
        description: "Multi-namespace service",
        namespaces: ["api", "database"],
        environments: {
          dev: { recipient: "age1multidev" },
        },
      },
    ],
  };
}

function mockEncryption(): jest.Mocked<EncryptionBackend> {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
  };
}

describe("ArtifactPacker", () => {
  let encryption: jest.Mocked<EncryptionBackend>;
  let matrixManager: MatrixManager;
  let packer: ArtifactPacker;

  beforeEach(() => {
    jest.clearAllMocks();
    encryption = mockEncryption();
    matrixManager = new MatrixManager();
    packer = new ArtifactPacker(encryption, matrixManager);

    mockFs.existsSync.mockImplementation((p) => {
      return String(p).includes(".enc.yaml");
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
  });

  it("should pack an artifact for a single-namespace identity", async () => {
    const decrypted: DecryptedFile = {
      values: { DATABASE_URL: "postgres://...", API_KEY: "secret123" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    const result = await packer.pack(config, baseManifest(), "/repo");

    expect(result.outputPath).toBe("/output/artifact.json");
    expect(result.namespaceCount).toBe(1);
    expect(result.keyCount).toBe(2);
    expect(result.artifactSize).toBeGreaterThan(0);
    expect(result.revision).toBeTruthy();

    // Verify the written JSON is a valid PackedArtifact
    const writeCall = mockFs.writeFileSync.mock.calls[0];
    const written: PackedArtifact = JSON.parse(String(writeCall[1]));
    expect(written.version).toBe(1);
    expect(written.identity).toBe("api-gateway");
    expect(written.environment).toBe("dev");
    expect(written.ciphertext).toBeTruthy();
    expect((JSON.parse(String(writeCall[1])) as Record<string, unknown>).keys).toBeUndefined();
    expect(written.ciphertextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.packedAt).toBeTruthy();
    expect(written.revision).toBeTruthy();
  });

  it("should embed expiresAt when ttl is set", async () => {
    const decrypted: DecryptedFile = {
      values: { KEY: "val" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/output/artifact.json",
      ttl: 3600,
    };

    const before = Date.now();
    await packer.pack(config, baseManifest(), "/repo");
    const after = Date.now();

    const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
    expect(written.expiresAt).toBeTruthy();
    const expiresAt = new Date(written.expiresAt!).getTime();
    // Should be approximately 1 hour from now
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 3600_000);
  });

  it("should not include expiresAt when ttl is not set", async () => {
    const decrypted: DecryptedFile = {
      values: { KEY: "val" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    await packer.pack(config, baseManifest(), "/repo");

    const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
    expect(written.expiresAt).toBeUndefined();
  });

  it("should create output directory if it does not exist", async () => {
    const decrypted: DecryptedFile = {
      values: { KEY: "val" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === "/new-dir") return false;
      return String(p).includes(".enc.yaml");
    });

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/new-dir/artifact.json",
    };

    await packer.pack(config, baseManifest(), "/repo");

    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/new-dir", { recursive: true });
  });

  it("should throw if identity not found", async () => {
    const config: PackConfig = {
      identity: "nonexistent",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    await expect(packer.pack(config, baseManifest(), "/repo")).rejects.toThrow("not found");
  });

  it("should throw if environment not found on identity", async () => {
    const config: PackConfig = {
      identity: "api-gateway",
      environment: "production",
      outputPath: "/output/artifact.json",
    };

    await expect(packer.pack(config, baseManifest(), "/repo")).rejects.toThrow("not found");
  });

  it("should use namespace-prefixed keys for multi-namespace identity", async () => {
    const apiDecrypted: DecryptedFile = {
      values: { API_KEY: "key1" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    const dbDecrypted: DecryptedFile = {
      values: { DB_HOST: "localhost" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValueOnce(apiDecrypted).mockResolvedValueOnce(dbDecrypted);

    const config: PackConfig = {
      identity: "multi-svc",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    const result = await packer.pack(config, baseManifest(), "/repo");
    expect(result.keyCount).toBe(2);

    const raw = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1])) as Record<
      string,
      unknown
    >;
    expect(raw.keys).toBeUndefined();
  });

  it("should serialize ciphertext as a string when age-encryption returns Uint8Array", async () => {
    // age-encryption >=0.3 returns Uint8Array from encrypt(), not a string.
    // Verify the packer converts it so the artifact JSON has a string field,
    // not a byte-indexed object like {"0":97,"1":103,...}.
    const ageText = "age-encryption.org/v1\n-> X25519 test\nencrypted-data\n";
    const ageModule = await import("age-encryption");
    const origImpl = (ageModule.Encrypter as jest.Mock).getMockImplementation();
    const encryptMock = jest.fn().mockResolvedValue(new TextEncoder().encode(ageText));
    (ageModule.Encrypter as jest.Mock).mockImplementation(() => ({
      addRecipient: jest.fn(),
      encrypt: encryptMock,
    }));

    const decrypted: DecryptedFile = {
      values: { KEY: "val" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    await packer.pack(config, baseManifest(), "/repo");

    const writtenJson = String(mockFs.writeFileSync.mock.calls[0][1]);
    const written: PackedArtifact = JSON.parse(writtenJson);
    expect(typeof written.ciphertext).toBe("string");
    // Uint8Array is base64-encoded for JSON-safe transport
    expect(written.ciphertext).toBe(Buffer.from(ageText).toString("base64"));
    // Must not contain byte-indexed keys from raw Uint8Array serialization
    expect(writtenJson).not.toContain('"0":');

    // Restore original mock for subsequent tests
    if (origImpl) (ageModule.Encrypter as jest.Mock).mockImplementation(origImpl);
  });

  it("should not contain plaintext secret values in the artifact", async () => {
    const decrypted: DecryptedFile = {
      values: { DATABASE_URL: "postgres://secret-host:5432/db", API_KEY: "sk-secret123" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const config: PackConfig = {
      identity: "api-gateway",
      environment: "dev",
      outputPath: "/output/artifact.json",
    };

    await packer.pack(config, baseManifest(), "/repo");

    const writtenJson = String(mockFs.writeFileSync.mock.calls[0][1]);
    expect(writtenJson).not.toContain("postgres://secret-host");
    expect(writtenJson).not.toContain("sk-secret123");
    // Ciphertext should be present (base64-encoded)
    expect(JSON.parse(writtenJson).ciphertext).toBeTruthy();
  });

  describe("KMS envelope encryption", () => {
    function kmsManifest(): ClefManifest {
      return {
        ...baseManifest(),
        service_identities: [
          ...baseManifest().service_identities!,
          {
            name: "kms-svc",
            description: "KMS service",
            namespaces: ["api"],
            environments: {
              dev: {
                kms: {
                  provider: "aws",
                  keyId: "arn:aws:kms:us-east-1:111:key/test-key",
                },
              },
            },
          },
        ],
      };
    }

    function mockKms(): jest.Mocked<KmsProvider> {
      return {
        wrap: jest.fn().mockResolvedValue({
          wrappedKey: Buffer.from("wrapped-ephemeral-key"),
          algorithm: "SYMMETRIC_DEFAULT",
        } as KmsWrapResult),
        unwrap: jest.fn(),
      };
    }

    it("should produce an artifact with envelope for KMS identity", async () => {
      const kms = mockKms();
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const decrypted: DecryptedFile = {
        values: { SECRET: "val" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "kms-svc",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      const result = await kmsPacker.pack(config, kmsManifest(), "/repo");
      expect(result.keyCount).toBe(1);

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.version).toBe(1);
      expect(written.envelope).toBeDefined();
      expect(written.envelope!.provider).toBe("aws");
      expect(written.envelope!.keyId).toBe("arn:aws:kms:us-east-1:111:key/test-key");
      expect(written.envelope!.wrappedKey).toBeTruthy();
      expect(written.envelope!.algorithm).toBe("SYMMETRIC_DEFAULT");
      // AES-GCM IV should be 12 bytes, authTag should be 16 bytes
      expect(written.envelope!.iv).toBeTruthy();
      expect(Buffer.from(written.envelope!.iv, "base64")).toHaveLength(12);
      expect(written.envelope!.authTag).toBeTruthy();
      expect(Buffer.from(written.envelope!.authTag, "base64")).toHaveLength(16);
      expect(kms.wrap).toHaveBeenCalledWith(
        "arn:aws:kms:us-east-1:111:key/test-key",
        expect.any(Buffer),
      );
      // DEK should be 32 bytes (AES-256)
      const wrappedDek = kms.wrap.mock.calls[0][1] as Buffer;
      expect(wrappedDek).toHaveLength(32);
    });

    it("should not import age-encryption in KMS path", async () => {
      const kms = mockKms();
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const decrypted: DecryptedFile = {
        values: { SECRET: "val" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "kms-svc",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      await kmsPacker.pack(config, kmsManifest(), "/repo");

      // Verify age-encryption Encrypter is NOT called for KMS path
      const ageModule = await import("age-encryption");
      expect(ageModule.Encrypter).not.toHaveBeenCalled();
    });

    it("should produce valid AES-256-GCM ciphertext that round-trips", async () => {
      const crypto = await import("crypto");
      let capturedDek: Buffer | null = null;
      const kms: jest.Mocked<KmsProvider> = {
        wrap: jest.fn().mockImplementation((_keyId: string, dek: Buffer) => {
          capturedDek = Buffer.from(dek); // copy before it's zeroed
          return Promise.resolve({
            wrappedKey: Buffer.from("wrapped-key"),
            algorithm: "SYMMETRIC_DEFAULT",
          } as KmsWrapResult);
        }),
        unwrap: jest.fn(),
      };
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const decrypted: DecryptedFile = {
        values: { SECRET: "round-trip-value" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "kms-svc",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      await kmsPacker.pack(config, kmsManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(capturedDek).not.toBeNull();

      // Decrypt with the captured DEK to verify round-trip
      const iv = Buffer.from(written.envelope!.iv, "base64");
      const authTag = Buffer.from(written.envelope!.authTag, "base64");
      const ciphertextBuf = Buffer.from(written.ciphertext, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", capturedDek!, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]).toString(
        "utf-8",
      );
      // Plaintext payload is nested by namespace inside the ciphertext.
      expect(JSON.parse(plaintext)).toEqual({ api: { SECRET: "round-trip-value" } });
    });

    it("should throw when KMS provider is not injected for KMS identity", async () => {
      const noKmsPacker = new ArtifactPacker(encryption, matrixManager);

      const decrypted: DecryptedFile = {
        values: { SECRET: "val" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "kms-svc",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      await expect(noKmsPacker.pack(config, kmsManifest(), "/repo")).rejects.toThrow(
        "KMS provider required",
      );
    });

    it("should persist the resolved key ARN in the envelope when manifest used an alias", async () => {
      // Manifest may carry an alias ARN. KMS Encrypt accepts aliases and
      // returns the resolved key ARN; the envelope must persist that resolved
      // ARN, not the alias, because kms:CreateGrant rejects aliases.
      const aliasArn = "arn:aws:kms:us-east-1:111:alias/clef-quick-start";
      const resolvedArn = "arn:aws:kms:us-east-1:111:key/abc-123";
      const kms: jest.Mocked<KmsProvider> = {
        wrap: jest.fn().mockResolvedValue({
          wrappedKey: Buffer.from("wrapped"),
          algorithm: "SYMMETRIC_DEFAULT",
          resolvedKeyId: resolvedArn,
        } as KmsWrapResult),
        unwrap: jest.fn(),
      };
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const aliasManifest: ClefManifest = {
        ...baseManifest(),
        service_identities: [
          ...baseManifest().service_identities!,
          {
            name: "kms-svc",
            description: "KMS service",
            namespaces: ["api"],
            environments: {
              dev: { kms: { provider: "aws", keyId: aliasArn } },
            },
          },
        ],
      };

      encryption.decrypt.mockResolvedValue({
        values: { SECRET: "val" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      });

      await kmsPacker.pack(
        { identity: "kms-svc", environment: "dev", outputPath: "/output/artifact.json" },
        aliasManifest,
        "/repo",
      );

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.envelope!.keyId).toBe(resolvedArn);
      expect(kms.wrap).toHaveBeenCalledWith(aliasArn, expect.any(Buffer));
    });

    it("should fall back to manifest keyId when provider returns no resolvedKeyId", async () => {
      // Defensive: GCP/Azure providers don't yet populate resolvedKeyId, and
      // older AWS responses may omit KeyId. Either way, the manifest value is
      // the right fallback.
      const kms: jest.Mocked<KmsProvider> = {
        wrap: jest.fn().mockResolvedValue({
          wrappedKey: Buffer.from("wrapped"),
          algorithm: "SYMMETRIC_DEFAULT",
        } as KmsWrapResult),
        unwrap: jest.fn(),
      };
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      encryption.decrypt.mockResolvedValue({
        values: { SECRET: "val" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      });

      await kmsPacker.pack(
        { identity: "kms-svc", environment: "dev", outputPath: "/output/artifact.json" },
        kmsManifest(),
        "/repo",
      );

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.envelope!.keyId).toBe("arn:aws:kms:us-east-1:111:key/test-key");
    });

    it("should produce artifact without envelope for age-only identity when KMS provider is injected", async () => {
      const kms = mockKms();
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      await kmsPacker.pack(config, kmsManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.version).toBe(1);
      expect(written.envelope).toBeUndefined();
      expect(kms.wrap).not.toHaveBeenCalled();
    });
  });

  describe("artifact signing", () => {
    it("should sign artifact with Ed25519 when signingKey is provided", async () => {
      const { publicKey, privateKey } = generateSigningKeyPair();
      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
        signingKey: privateKey,
      };

      await packer.pack(config, baseManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.signature).toBeTruthy();
      expect(written.signatureAlgorithm).toBe("Ed25519");

      // Verify the signature is valid
      const payload = buildSigningPayload(written);
      const valid = verifySignature(payload, written.signature!, publicKey);
      expect(valid).toBe(true);
    });

    it("should not include signature when no signing key is provided", async () => {
      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
      };

      await packer.pack(config, baseManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.signature).toBeUndefined();
      expect(written.signatureAlgorithm).toBeUndefined();
    });

    it("should sign after setting expiresAt so TTL is covered by signature", async () => {
      const { publicKey, privateKey } = generateSigningKeyPair();
      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
        ttl: 3600,
        signingKey: privateKey,
      };

      await packer.pack(config, baseManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.expiresAt).toBeTruthy();
      expect(written.signature).toBeTruthy();

      // Verify the signature covers the expiresAt field
      const payload = buildSigningPayload(written);
      expect(payload.toString("utf-8")).toContain(written.expiresAt!);
      const valid = verifySignature(payload, written.signature!, publicKey);
      expect(valid).toBe(true);
    });

    it("should throw when both signingKey and signingKmsKeyId are provided", async () => {
      const { privateKey } = generateSigningKeyPair();
      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
        signingKey: privateKey,
        signingKmsKeyId: "arn:aws:kms:us-east-1:111:key/sign",
      };

      await expect(packer.pack(config, baseManifest(), "/repo")).rejects.toThrow(
        "Cannot specify both",
      );
    });

    it("should sign artifact with KMS when signingKmsKeyId is provided", async () => {
      const mockSignature = Buffer.from("kms-ecdsa-signature-bytes");
      const kms: jest.Mocked<KmsProvider> = {
        wrap: jest.fn().mockResolvedValue({
          wrappedKey: Buffer.from("wrapped"),
          algorithm: "SYMMETRIC_DEFAULT",
        } as KmsWrapResult),
        unwrap: jest.fn(),
        sign: jest.fn().mockResolvedValue(mockSignature),
      };
      const kmsPacker = new ArtifactPacker(encryption, matrixManager, kms);

      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
        signingKmsKeyId: "arn:aws:kms:us-east-1:111:key/sign",
      };

      await kmsPacker.pack(config, baseManifest(), "/repo");

      const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
      expect(written.signature).toBe(mockSignature.toString("base64"));
      expect(written.signatureAlgorithm).toBe("ECDSA_SHA256");
      expect(kms.sign).toHaveBeenCalledWith(
        "arn:aws:kms:us-east-1:111:key/sign",
        expect.any(Buffer),
      );
    });

    it("should throw when signingKmsKeyId is set but no KMS provider", async () => {
      const decrypted: DecryptedFile = {
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const config: PackConfig = {
        identity: "api-gateway",
        environment: "dev",
        outputPath: "/output/artifact.json",
        signingKmsKeyId: "arn:aws:kms:us-east-1:111:key/sign",
      };

      await expect(packer.pack(config, baseManifest(), "/repo")).rejects.toThrow(
        "KMS provider required for KMS signing",
      );
    });
  });
});
