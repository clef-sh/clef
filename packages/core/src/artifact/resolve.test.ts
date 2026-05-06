import * as fs from "fs";
import { resolveIdentitySecrets } from "./resolve";
import { ClefManifest, DecryptedFile } from "../types";
import { MatrixManager } from "../matrix/manager";
import type { SecretSource } from "../source/types";

jest.mock("fs");

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
          staging: { recipient: "age1multistg" },
        },
      },
    ],
  };
}

/**
 * Source mock with `decrypt` aliased onto `readCell` so the existing
 * `encryption.decrypt.mockResolvedValue(...)` call sites stay valid even
 * though production code now calls `source.readCell(cellRef)`. The
 * production-side path translation is independent of the mock.
 */
interface SourceMock extends SecretSource {
  decrypt: jest.Mock;
  readCell: jest.Mock;
}

function mockEncryption(): SourceMock {
  const stub = jest.fn();
  const readCell = jest.fn();
  return {
    id: "mock",
    description: "mock",
    readCell,
    writeCell: stub,
    deleteCell: stub,
    cellExists: stub,
    listKeys: stub,
    scaffoldCell: stub,
    getCellMetadata: stub,
    getPendingMetadata: stub,
    markPending: stub,
    markResolved: stub,
    recordRotation: stub,
    removeRotation: stub,
    decrypt: readCell,
  } as unknown as SourceMock;
}

describe("resolveIdentitySecrets", () => {
  let encryption: SourceMock;
  let matrixManager: MatrixManager;

  beforeEach(() => {
    jest.clearAllMocks();
    encryption = mockEncryption();
    matrixManager = new MatrixManager();

    mockFs.existsSync.mockImplementation((p) => {
      return String(p).includes(".enc.yaml");
    });
  });

  it("should resolve secrets for a single-namespace identity", async () => {
    const decrypted: DecryptedFile = {
      values: { DATABASE_URL: "postgres://...", API_KEY: "secret123" },
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const result = await resolveIdentitySecrets(
      "api-gateway",
      "dev",
      baseManifest(),
      "/repo",
      encryption,
      matrixManager,
    );

    expect(result.values).toEqual({
      api: { DATABASE_URL: "postgres://...", API_KEY: "secret123" },
    });
    expect(result.identity.name).toBe("api-gateway");
    expect(result.recipient).toBe("age1devkey");
    expect(result.envConfig).toEqual({ recipient: "age1devkey" });
  });

  it("should bucket keys by namespace for multi-namespace identity", async () => {
    const apiDecrypted: DecryptedFile = {
      values: { API_KEY: "key1" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    const dbDecrypted: DecryptedFile = {
      values: { DB_HOST: "localhost" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValueOnce(apiDecrypted).mockResolvedValueOnce(dbDecrypted);

    const result = await resolveIdentitySecrets(
      "multi-svc",
      "dev",
      baseManifest(),
      "/repo",
      encryption,
      matrixManager,
    );

    expect(result.values).toEqual({
      api: { API_KEY: "key1" },
      database: { DB_HOST: "localhost" },
    });
  });

  it("should throw if identity not found", async () => {
    await expect(
      resolveIdentitySecrets(
        "nonexistent",
        "dev",
        baseManifest(),
        "/repo",
        encryption,
        matrixManager,
      ),
    ).rejects.toThrow("not found");
  });

  it("should throw if environment not found on identity", async () => {
    await expect(
      resolveIdentitySecrets(
        "api-gateway",
        "production",
        baseManifest(),
        "/repo",
        encryption,
        matrixManager,
      ),
    ).rejects.toThrow("not found");
  });

  it("should isolate same-named keys across namespaces", async () => {
    const apiDecrypted: DecryptedFile = {
      values: { SAME_KEY: "val_a" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    const dbDecrypted: DecryptedFile = {
      values: { SAME_KEY: "val_b" },
      metadata: { backend: "age", recipients: ["age1multidev"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValueOnce(apiDecrypted).mockResolvedValueOnce(dbDecrypted);

    const result = await resolveIdentitySecrets(
      "multi-svc",
      "dev",
      baseManifest(),
      "/repo",
      encryption,
      matrixManager,
    );

    expect(result.values.api.SAME_KEY).toBe("val_a");
    expect(result.values.database.SAME_KEY).toBe("val_b");
  });

  it("should resolve envConfig for KMS identity", async () => {
    const manifest = baseManifest();
    manifest.service_identities!.push({
      name: "kms-svc",
      description: "KMS service",
      namespaces: ["api"],
      environments: {
        dev: { kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:111:key/test" } },
      },
    });

    const decrypted: DecryptedFile = {
      values: { SECRET: "val" },
      metadata: { backend: "age", recipients: [], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const result = await resolveIdentitySecrets(
      "kms-svc",
      "dev",
      manifest,
      "/repo",
      encryption,
      matrixManager,
    );

    expect(result.recipient).toBeUndefined();
    expect(result.envConfig.kms).toEqual({
      provider: "aws",
      keyId: "arn:aws:kms:us-east-1:111:key/test",
    });
  });

  it("should handle zero keys gracefully", async () => {
    const decrypted: DecryptedFile = {
      values: {},
      metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
    };
    encryption.decrypt.mockResolvedValue(decrypted);

    const result = await resolveIdentitySecrets(
      "api-gateway",
      "dev",
      baseManifest(),
      "/repo",
      encryption,
      matrixManager,
    );

    // Single-namespace identity → one outer bucket, zero keys inside.
    expect(result.values).toEqual({ api: {} });
  });
});
