import * as fs from "fs";
import { ArtifactPacker } from "./packer";
import { ClefManifest, EncryptionBackend, DecryptedFile } from "../types";
import { KmsProvider, KmsWrapResult } from "../kms";
import { MatrixManager } from "../matrix/manager";
import { PackConfig, PackedArtifact } from "./types";

jest.mock("fs");

// Mock age-encryption
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
    generateIdentity: jest.fn().mockResolvedValue("AGE-SECRET-KEY-1EPHEMERAL"),
    identityToRecipient: jest.fn().mockResolvedValue("age1ephemeralrecipient"),
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
    expect(written.ciphertext).toContain("BEGIN AGE ENCRYPTED FILE");
    expect(written.keys).toEqual(["DATABASE_URL", "API_KEY"]);
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

    const written: PackedArtifact = JSON.parse(String(mockFs.writeFileSync.mock.calls[0][1]));
    expect(written.keys).toContain("api__API_KEY");
    expect(written.keys).toContain("database__DB_HOST");
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
    expect(writtenJson).toContain("BEGIN AGE ENCRYPTED FILE");
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
      expect(kms.wrap).toHaveBeenCalledWith(
        "arn:aws:kms:us-east-1:111:key/test-key",
        expect.any(Buffer),
      );
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
});
