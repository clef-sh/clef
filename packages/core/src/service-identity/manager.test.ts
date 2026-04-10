import * as fs from "fs";
import * as YAML from "yaml";
import { ServiceIdentityManager } from "./manager";
import { ClefManifest, EncryptionBackend, ServiceIdentityDefinition, SopsMetadata } from "../types";
import { MatrixManager } from "../matrix/manager";

jest.mock("fs");
jest.mock("../age/keygen");

const mockFs = fs as jest.Mocked<typeof fs> & { renameSync: jest.Mock };

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock
const { generateAgeIdentity } = require("../age/keygen") as {
  generateAgeIdentity: jest.Mock;
};

function baseManifest(overrides?: Partial<ClefManifest>): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "staging", description: "Staging" },
      { name: "production", description: "Production", protected: true },
    ],
    namespaces: [
      { name: "api", description: "API secrets" },
      { name: "database", description: "DB config" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    ...overrides,
  };
}

function mockEncryption(): jest.Mocked<EncryptionBackend> {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn().mockResolvedValue(undefined),
    removeRecipient: jest.fn().mockResolvedValue(undefined),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
  };
}

describe("ServiceIdentityManager", () => {
  let encryption: jest.Mocked<EncryptionBackend>;
  let matrixManager: MatrixManager;
  let manager: ServiceIdentityManager;

  beforeEach(() => {
    jest.clearAllMocks();
    encryption = mockEncryption();
    matrixManager = new MatrixManager();
    manager = new ServiceIdentityManager(encryption, matrixManager);

    let callCount = 0;
    generateAgeIdentity.mockImplementation(async () => {
      callCount++;
      return {
        privateKey: `AGE-SECRET-KEY-${callCount}`,
        publicKey: `age1pubkey${callCount}`,
      };
    });
  });

  describe("create", () => {
    it("should generate per-env keys and update manifest", async () => {
      const manifest = baseManifest();
      const manifestYaml = YAML.stringify({
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
      });
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(false);

      const result = await manager.create(
        "api-gateway",
        ["api"],
        "API gateway service",
        manifest,
        "/repo",
      );

      expect(result.identity.name).toBe("api-gateway");
      expect(result.identity.namespaces).toEqual(["api"]);
      expect(Object.keys(result.privateKeys)).toHaveLength(3);
      expect(result.privateKeys.dev).toMatch(/^AGE-SECRET-KEY-/);
      expect(result.identity.environments.dev.recipient).toMatch(/^age1pubkey/);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should throw if identity name already exists", async () => {
      const manifest = baseManifest({
        service_identities: [
          {
            name: "existing",
            description: "Existing",
            namespaces: ["api"],
            environments: { dev: { recipient: "age1test" } },
          },
        ],
      });

      await expect(manager.create("existing", ["api"], "dup", manifest, "/repo")).rejects.toThrow(
        "already exists",
      );
    });

    it("should throw if namespace not found", async () => {
      const manifest = baseManifest();

      await expect(
        manager.create("svc", ["nonexistent"], "test", manifest, "/repo"),
      ).rejects.toThrow("not found");
    });

    it("should register recipients on scoped files", async () => {
      const manifest = baseManifest();
      const manifestYaml = YAML.stringify({
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
      });
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      // Only api files exist
      mockFs.existsSync.mockImplementation((p) => {
        return String(p).includes("api/");
      });

      await manager.create("svc", ["api"], "test", manifest, "/repo");

      // Should have called addRecipient for each api env file (dev, staging, production)
      expect(encryption.addRecipient).toHaveBeenCalledTimes(3);
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1pubkey/),
      );
    });

    it("should create KMS identity without generating age keys", async () => {
      const manifest = baseManifest();
      const manifestYaml = YAML.stringify({
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
      });
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(false);

      const kmsEnvConfigs = {
        dev: { provider: "aws" as const, keyId: "arn:aws:kms:us-east-1:111:key/dev" },
        staging: { provider: "aws" as const, keyId: "arn:aws:kms:us-east-1:222:key/stg" },
        production: { provider: "aws" as const, keyId: "arn:aws:kms:us-west-2:333:key/prd" },
      };

      const result = await manager.create(
        "kms-svc",
        ["api"],
        "KMS service",
        manifest,
        "/repo",
        kmsEnvConfigs,
      );

      // No private keys should be generated for KMS environments
      expect(Object.keys(result.privateKeys)).toHaveLength(0);
      expect(generateAgeIdentity).not.toHaveBeenCalled();

      // KMS config should be stored
      expect(result.identity.environments.dev.kms).toEqual(kmsEnvConfigs.dev);
      expect(result.identity.environments.staging.kms).toEqual(kmsEnvConfigs.staging);
      expect(result.identity.environments.production.kms).toEqual(kmsEnvConfigs.production);

      // No recipients should be registered for KMS environments
      expect(encryption.addRecipient).not.toHaveBeenCalled();
    });

    it("should handle mixed age and KMS environments", async () => {
      const manifest = baseManifest();
      const manifestYaml = YAML.stringify({
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
      });
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockImplementation((p) => String(p).includes("api/"));

      const kmsEnvConfigs = {
        production: { provider: "aws" as const, keyId: "arn:aws:kms:us-west-2:333:key/prd" },
      };

      const result = await manager.create(
        "mixed-svc",
        ["api"],
        "Mixed service",
        manifest,
        "/repo",
        kmsEnvConfigs,
      );

      // Only dev and staging should have age keys
      expect(Object.keys(result.privateKeys)).toHaveLength(2);
      expect(result.privateKeys.dev).toBeTruthy();
      expect(result.privateKeys.staging).toBeTruthy();
      expect(result.privateKeys.production).toBeUndefined();

      // Production should have KMS config
      expect(result.identity.environments.production.kms).toEqual(kmsEnvConfigs.production);

      // Only age environments should have recipients registered
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1pubkey/),
      );
    });
  });

  describe("list", () => {
    it("should return empty array when no identities", () => {
      expect(manager.list(baseManifest())).toEqual([]);
    });

    it("should return identities from manifest", () => {
      const si: ServiceIdentityDefinition = {
        name: "test",
        description: "Test",
        namespaces: ["api"],
        environments: { dev: { recipient: "age1abc" } },
      };
      const manifest = baseManifest({ service_identities: [si] });
      expect(manager.list(manifest)).toEqual([si]);
    });
  });

  describe("get", () => {
    it("should return undefined for missing identity", () => {
      expect(manager.get(baseManifest(), "missing")).toBeUndefined();
    });

    it("should return the matching identity", () => {
      const si: ServiceIdentityDefinition = {
        name: "test",
        description: "Test",
        namespaces: ["api"],
        environments: { dev: { recipient: "age1abc" } },
      };
      const manifest = baseManifest({ service_identities: [si] });
      expect(manager.get(manifest, "test")).toEqual(si);
    });
  });

  describe("rotateKey", () => {
    it("should rotate all environments by default", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1olddev" },
          staging: { recipient: "age1oldstg" },
          production: { recipient: "age1oldprd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      const doc = {
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
        service_identities: [{ ...si }],
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(doc));
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockImplementation((p) => String(p).includes("api/"));

      const result = await manager.rotateKey("svc", manifest, "/repo");

      expect(Object.keys(result)).toHaveLength(3);
      expect(result.dev).toMatch(/^AGE-SECRET-KEY-/);
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      // Verify old recipients were removed and new ones added
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1old/),
      );
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1pubkey/),
      );
    });

    it("should rotate a single environment", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1olddev" },
          staging: { recipient: "age1oldstg" },
          production: { recipient: "age1oldprd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      const doc = {
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
        service_identities: [{ ...si }],
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(doc));
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(false);

      const result = await manager.rotateKey("svc", manifest, "/repo", "dev");

      expect(Object.keys(result)).toHaveLength(1);
      expect(result.dev).toBeDefined();
    });

    it("should throw if identity not found", async () => {
      await expect(manager.rotateKey("nope", baseManifest(), "/repo")).rejects.toThrow("not found");
    });

    it("should throw if environment not found on identity", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1olddev" },
        },
      };
      const manifest = baseManifest({
        environments: [{ name: "dev", description: "Dev" }],
        service_identities: [si],
      });
      const doc = {
        version: 1,
        environments: manifest.environments,
        namespaces: manifest.namespaces,
        sops: manifest.sops,
        file_pattern: manifest.file_pattern,
        service_identities: [{ ...si }],
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(doc));
      mockFs.existsSync.mockReturnValue(false);

      await expect(manager.rotateKey("svc", manifest, "/repo", "nonexistent")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("validate", () => {
    it("should return empty array when no identities", async () => {
      const result = await manager.validate(baseManifest(), "/repo");
      expect(result).toEqual([]);
    });

    it("should detect missing environment", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1dev" },
          // missing staging and production
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockReturnValue(false);

      const issues = await manager.validate(manifest, "/repo");

      const missingEnvIssues = issues.filter((i) => i.type === "missing_environment");
      expect(missingEnvIssues.length).toBe(2);
      expect(missingEnvIssues.map((i) => i.environment)).toContain("staging");
      expect(missingEnvIssues.map((i) => i.environment)).toContain("production");
    });

    it("should detect unknown namespace reference", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["nonexistent"],
        environments: {
          dev: { recipient: "age1dev" },
          staging: { recipient: "age1stg" },
          production: { recipient: "age1prd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockReturnValue(false);

      const issues = await manager.validate(manifest, "/repo");
      const nsIssues = issues.filter((i) => i.type === "namespace_not_found");
      expect(nsIssues).toHaveLength(1);
      expect(nsIssues[0].namespace).toBe("nonexistent");
    });

    it("should detect unregistered recipient", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1svcdev" },
          staging: { recipient: "age1svcstg" },
          production: { recipient: "age1svcprd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockImplementation((p) => String(p).includes("api/dev"));

      const metadata: SopsMetadata = {
        backend: "age",
        recipients: ["age1other"],
        lastModified: new Date(),
      };
      encryption.getMetadata.mockResolvedValue(metadata);

      const issues = await manager.validate(manifest, "/repo");
      const unreg = issues.filter((i) => i.type === "recipient_not_registered");
      expect(unreg).toHaveLength(1);
    });

    it("should detect scope mismatch", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1svcdev" },
          staging: { recipient: "age1svcstg" },
          production: { recipient: "age1svcprd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      // database/dev exists (not in scope for this identity)
      mockFs.existsSync.mockImplementation((p) => String(p).includes("database/dev"));

      const metadata: SopsMetadata = {
        backend: "age",
        recipients: ["age1svcdev"], // identity's key found outside scope
        lastModified: new Date(),
      };
      encryption.getMetadata.mockResolvedValue(metadata);

      const issues = await manager.validate(manifest, "/repo");
      const mismatch = issues.filter((i) => i.type === "scope_mismatch");
      expect(mismatch).toHaveLength(1);
    });
  });

  describe("addNamespacesToScope", () => {
    function manifestWithSi(): ClefManifest {
      return baseManifest({
        service_identities: [
          {
            name: "web-app",
            description: "Web app",
            namespaces: ["api"],
            environments: {
              dev: { recipient: "age1devkey" },
              staging: { recipient: "age1stagingkey" },
              production: { kms: { provider: "aws", keyId: "arn:..." } },
            },
          },
        ],
      });
    }

    function setupFs(manifest: ClefManifest): void {
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
      mockFs.writeFileSync.mockImplementation(() => {});
      // Pretend every cell exists
      mockFs.existsSync.mockReturnValue(true);
    }

    it("registers the SI's recipient on cells in newly-scoped namespaces", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      const result = await manager.addNamespacesToScope("web-app", ["database"], manifest, "/repo");

      expect(result.added).toEqual(["database"]);
      // database has 2 age envs (dev, staging) and 1 KMS env (production)
      expect(encryption.addRecipient).toHaveBeenCalledTimes(2);
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("database/dev"),
        "age1devkey",
      );
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("database/staging"),
        "age1stagingkey",
      );
      // KMS env: no recipient registration
      expect(encryption.addRecipient).not.toHaveBeenCalledWith(
        expect.stringContaining("database/production"),
        expect.anything(),
      );
    });

    it("updates the SI's namespaces array in the manifest", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await manager.addNamespacesToScope("web-app", ["database"], manifest, "/repo");

      // The atomic write goes through a temp file (.clef.yaml.tmp.{pid}.{ts})
      const writeCall = mockFs.writeFileSync.mock.calls.find((c) => {
        const p = String(c[0]);
        return p.endsWith("clef.yaml") || p.includes("clef.yaml.tmp.");
      });
      expect(writeCall).toBeDefined();
      const writtenDoc = YAML.parse(writeCall![1] as string) as ClefManifest;
      const si = writtenDoc.service_identities!.find((s) => s.name === "web-app")!;
      expect(si.namespaces).toEqual(["api", "database"]);
    });

    it("is idempotent — namespaces already in scope are silently skipped", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      const result = await manager.addNamespacesToScope("web-app", ["api"], manifest, "/repo");

      expect(result.added).toEqual([]);
      expect(result.affectedFiles).toEqual([]);
      expect(encryption.addRecipient).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("skips already-scoped namespaces but processes new ones in the same call", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      const result = await manager.addNamespacesToScope(
        "web-app",
        ["api", "database"],
        manifest,
        "/repo",
      );

      expect(result.added).toEqual(["database"]);
    });

    it("throws if the identity does not exist", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await expect(
        manager.addNamespacesToScope("nonexistent", ["database"], manifest, "/repo"),
      ).rejects.toThrow("not found");
    });

    it("throws if a requested namespace does not exist in the manifest", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await expect(
        manager.addNamespacesToScope("web-app", ["unknown"], manifest, "/repo"),
      ).rejects.toThrow("Namespace(s) not found in manifest: unknown");
    });

    it("ignores 'already a recipient' errors from SOPS", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);
      // First file errors with "already" — should be swallowed
      encryption.addRecipient.mockImplementationOnce(async () => {
        throw new Error("recipient already present");
      });

      const result = await manager.addNamespacesToScope("web-app", ["database"], manifest, "/repo");

      expect(result.added).toEqual(["database"]);
      // Both calls happen even though the first errored
      expect(encryption.addRecipient).toHaveBeenCalledTimes(2);
    });

    it("re-throws non-duplicate encryption errors", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);
      encryption.addRecipient.mockImplementationOnce(async () => {
        throw new Error("permission denied");
      });

      await expect(
        manager.addNamespacesToScope("web-app", ["database"], manifest, "/repo"),
      ).rejects.toThrow("permission denied");
    });
  });

  describe("removeNamespacesFromScope", () => {
    function manifestWithSi(): ClefManifest {
      return baseManifest({
        service_identities: [
          {
            name: "web-app",
            description: "Web app",
            namespaces: ["api", "database"],
            environments: {
              dev: { recipient: "age1devkey" },
              staging: { recipient: "age1stagingkey" },
              production: { kms: { provider: "aws", keyId: "arn:..." } },
            },
          },
        ],
      });
    }

    function setupFs(manifest: ClefManifest): void {
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);
    }

    it("de-registers the SI's recipient from cells in removed namespaces", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      const result = await manager.removeNamespacesFromScope(
        "web-app",
        ["database"],
        manifest,
        "/repo",
      );

      expect(result.removed).toEqual(["database"]);
      // database has 2 age envs (dev, staging) and 1 KMS env (production)
      expect(encryption.removeRecipient).toHaveBeenCalledTimes(2);
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        expect.stringContaining("database/dev"),
        "age1devkey",
      );
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        expect.stringContaining("database/staging"),
        "age1stagingkey",
      );
      // KMS env: no recipient removal
      expect(encryption.removeRecipient).not.toHaveBeenCalledWith(
        expect.stringContaining("database/production"),
        expect.anything(),
      );
    });

    it("updates the SI's namespaces array in the manifest", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await manager.removeNamespacesFromScope("web-app", ["database"], manifest, "/repo");

      const writeCall = mockFs.writeFileSync.mock.calls.find((c) => {
        const p = String(c[0]);
        return p.endsWith("clef.yaml") || p.includes("clef.yaml.tmp.");
      });
      expect(writeCall).toBeDefined();
      const writtenDoc = YAML.parse(writeCall![1] as string) as ClefManifest;
      const si = writtenDoc.service_identities!.find((s) => s.name === "web-app")!;
      expect(si.namespaces).toEqual(["api"]);
    });

    it("throws if the identity does not exist", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await expect(
        manager.removeNamespacesFromScope("nonexistent", ["api"], manifest, "/repo"),
      ).rejects.toThrow("not found");
    });

    it("throws if a requested namespace is not in scope", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);

      await expect(
        manager.removeNamespacesFromScope("web-app", ["notscoped"], manifest, "/repo"),
      ).rejects.toThrow("Namespace(s) not in scope of 'web-app': notscoped");
    });

    it("refuses to remove the last namespace and points at clef service delete", async () => {
      const manifest = baseManifest({
        service_identities: [
          {
            name: "lonely",
            description: "Only one ns",
            namespaces: ["api"],
            environments: {
              dev: { recipient: "age1devkey" },
            },
          },
        ],
      });
      setupFs(manifest);

      await expect(
        manager.removeNamespacesFromScope("lonely", ["api"], manifest, "/repo"),
      ).rejects.toThrow("Cannot remove the last namespace");
      await expect(
        manager.removeNamespacesFromScope("lonely", ["api"], manifest, "/repo"),
      ).rejects.toThrow("clef service delete lonely");
    });

    it("swallows errors when the recipient is already gone", async () => {
      const manifest = manifestWithSi();
      setupFs(manifest);
      encryption.removeRecipient.mockImplementation(async () => {
        throw new Error("not a current recipient");
      });

      // Should NOT throw
      const result = await manager.removeNamespacesFromScope(
        "web-app",
        ["database"],
        manifest,
        "/repo",
      );

      expect(result.removed).toEqual(["database"]);
    });
  });
});
