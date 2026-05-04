import * as fs from "fs";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { ServiceIdentityManager } from "./manager";
import {
  ClefManifest,
  FileEncryptionBackend,
  ServiceIdentityDefinition,
  SopsMetadata,
} from "../types";
import { MatrixManager } from "../matrix/manager";
import { TransactionManager } from "../tx";

jest.mock("fs");
jest.mock("../age/keygen");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockFs = fs as jest.Mocked<typeof fs>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock
const { generateAgeIdentity } = require("../age/keygen") as {
  generateAgeIdentity: jest.Mock;
};

/**
 * Distinct, bech32-valid mock age public keys. The new manifest writer
 * validates recipients with `validateAgePublicKey`, so test fixtures must
 * use real bech32 chars (no b/i/o/1 after the `age1` prefix). Length ≥ 10.
 *
 * Each generator call (driven by `generateAgeIdentity` below) returns the
 * next entry, so tests that assert the first generated key get
 * MOCK_AGE_KEYS[0], etc.
 */
const MOCK_AGE_KEYS = [
  "age1devkeyq",
  "age1devkeyp",
  "age1devkeyz",
  "age1devkeyr",
  "age1devkeyy",
  "age1devkeyx",
  "age1devkey9",
  "age1devkey8",
];

/** Bech32-valid stand-ins for placeholder strings used in fixtures. */
const MOCK_OLD_DEV_KEY = "age1newdevkey";
const MOCK_OLD_STG_KEY = "age1newstgkey";
const MOCK_OLD_PRD_KEY = "age1newprdkey";
const MOCK_PLACEHOLDER_KEY = "age1freshkey7";

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

function mockEncryption(): jest.Mocked<FileEncryptionBackend> {
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

/**
 * Stub TransactionManager that just runs the mutate callback inline. The
 * real transaction-manager.test.ts covers locking, preflight, and rollback.
 */
function makeStubTx(): TransactionManager {
  return {
    run: jest
      .fn()
      .mockImplementation(
        async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
          await opts.mutate();
          return { sha: null, paths: opts.paths, startedDirty: false };
        },
      ),
  } as unknown as TransactionManager;
}

describe("ServiceIdentityManager", () => {
  let encryption: jest.Mocked<FileEncryptionBackend>;
  let matrixManager: MatrixManager;
  let manager: ServiceIdentityManager;

  beforeEach(() => {
    jest.clearAllMocks();
    encryption = mockEncryption();
    matrixManager = new MatrixManager();
    manager = new ServiceIdentityManager(encryption, matrixManager, makeStubTx());

    let callCount = 0;
    generateAgeIdentity.mockImplementation(async () => {
      const idx = callCount++;
      return {
        privateKey: `AGE-SECRET-KEY-${idx + 1}`,
        publicKey: MOCK_AGE_KEYS[idx],
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
      expect(result.identity.environments.dev.recipient).toMatch(/^age1devkey/);
      // Manifest is written via write-file-atomic
      expect(mockWriteFileAtomicSync).toHaveBeenCalled();
    });

    it("should throw if identity name already exists", async () => {
      const manifest = baseManifest({
        service_identities: [
          {
            name: "existing",
            description: "Existing",
            namespaces: ["api"],
            environments: { dev: { recipient: MOCK_PLACEHOLDER_KEY } },
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
        expect.stringMatching(/^age1devkey/),
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
        dev: { provider: "aws" as const, keyId: "arn:aws:kms:us-east-1:111111111111:key/dev" },
        staging: { provider: "aws" as const, keyId: "arn:aws:kms:us-east-1:222222222222:key/stg" },
        production: {
          provider: "aws" as const,
          keyId: "arn:aws:kms:us-west-2:333333333333:key/prd",
        },
      };

      const result = await manager.create("kms-svc", ["api"], "KMS service", manifest, "/repo", {
        kmsEnvConfigs,
      });

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
        production: {
          provider: "aws" as const,
          keyId: "arn:aws:kms:us-west-2:333333333333:key/prd",
        },
      };

      const result = await manager.create(
        "mixed-svc",
        ["api"],
        "Mixed service",
        manifest,
        "/repo",
        { kmsEnvConfigs },
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
        expect.stringMatching(/^age1devkey/),
      );
    });

    it("should reuse one age key for all environments with sharedRecipient", async () => {
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
        "shared-svc",
        ["api"],
        "Shared-key service",
        manifest,
        "/repo",
        { sharedRecipient: true },
      );

      // generateAgeIdentity should be called exactly once regardless of env count
      expect(generateAgeIdentity).toHaveBeenCalledTimes(1);

      // All environments should have the same public key as recipient
      const recipients = Object.values(result.identity.environments).map((e) => e.recipient);
      expect(new Set(recipients).size).toBe(1);
      expect(recipients[0]).toBe(MOCK_AGE_KEYS[0]);

      // All private key entries should be the same value
      const keys = Object.values(result.privateKeys);
      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe("AGE-SECRET-KEY-1");

      // sharedRecipient flag is reflected in the result
      expect(result.sharedRecipient).toBe(true);
    });

    it("should return sharedRecipient: false for per-env key generation", async () => {
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

      const result = await manager.create("per-env-svc", ["api"], "Per-env", manifest, "/repo");

      expect(result.sharedRecipient).toBe(false);
      expect(generateAgeIdentity).toHaveBeenCalledTimes(3);
    });

    it("should not register recipients when packOnly is true", async () => {
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

      const result = await manager.create(
        "runtime-svc",
        ["api"],
        "Runtime service",
        manifest,
        "/repo",
        { packOnly: true },
      );

      // Should still generate keys (runtime needs them for artifact decryption)
      expect(Object.keys(result.privateKeys)).toHaveLength(3);
      // But should NOT register recipients on SOPS files
      expect(encryption.addRecipient).not.toHaveBeenCalled();
      // pack_only flag should be set on the definition
      expect(result.identity.pack_only).toBe(true);
    });

    it("should support packOnly with sharedRecipient together", async () => {
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
        "runtime-shared",
        ["api"],
        "Runtime shared",
        manifest,
        "/repo",
        { packOnly: true, sharedRecipient: true },
      );

      expect(generateAgeIdentity).toHaveBeenCalledTimes(1);
      expect(encryption.addRecipient).not.toHaveBeenCalled();
      expect(result.identity.pack_only).toBe(true);
      expect(result.sharedRecipient).toBe(true);
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
        environments: { dev: { recipient: MOCK_PLACEHOLDER_KEY } },
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
        environments: { dev: { recipient: MOCK_PLACEHOLDER_KEY } },
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
          dev: { recipient: MOCK_OLD_DEV_KEY },
          staging: { recipient: MOCK_OLD_STG_KEY },
          production: { recipient: MOCK_OLD_PRD_KEY },
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
      // Manifest is written via write-file-atomic
      expect(mockWriteFileAtomicSync).toHaveBeenCalled();

      // Verify old recipients were removed and new ones added
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1newd/),
      );
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        expect.stringContaining("api/"),
        expect.stringMatching(/^age1devkey/),
      );
    });

    it("should rotate a single environment", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: MOCK_OLD_DEV_KEY },
          staging: { recipient: MOCK_OLD_STG_KEY },
          production: { recipient: MOCK_OLD_PRD_KEY },
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
          dev: { recipient: MOCK_OLD_DEV_KEY },
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

    it("should detect missing environment and emit a fix command", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1devkeyq" },
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

      // Each issue points at the explicit fix command users can run.
      const stagingIssue = missingEnvIssues.find((i) => i.environment === "staging")!;
      expect(stagingIssue.fixCommand).toBe("clef service add-env svc staging");
      expect(stagingIssue.message).toContain("no config for environment 'staging'");
    });

    it("should detect unknown namespace reference", async () => {
      const si: ServiceIdentityDefinition = {
        name: "svc",
        description: "Service",
        namespaces: ["nonexistent"],
        environments: {
          dev: { recipient: "age1devkeyq" },
          staging: { recipient: "age1stgkeyq" },
          production: { recipient: "age1prdkeyq" },
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
        recipients: ["age1freshkey7"],
        lastModified: new Date(),
        lastModifiedPresent: true,
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
        lastModifiedPresent: true,
      };
      encryption.getMetadata.mockResolvedValue(metadata);

      const issues = await manager.validate(manifest, "/repo");
      const mismatch = issues.filter((i) => i.type === "scope_mismatch");
      expect(mismatch).toHaveLength(1);
    });

    it("should skip recipient checks for pack-only identities", async () => {
      const si: ServiceIdentityDefinition = {
        name: "runtime-svc",
        description: "Runtime",
        namespaces: ["api"],
        pack_only: true,
        environments: {
          dev: { recipient: "age1svcdev" },
          staging: { recipient: "age1svcstg" },
          production: { recipient: "age1svcprd" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockImplementation((p) => String(p).includes("api/dev"));

      // Recipient is NOT on the file — but pack-only should not report this
      const metadata: SopsMetadata = {
        backend: "age",
        recipients: ["age1freshkey7"],
        lastModified: new Date(),
        lastModifiedPresent: true,
      };
      encryption.getMetadata.mockResolvedValue(metadata);

      const issues = await manager.validate(manifest, "/repo");
      const recipientIssues = issues.filter(
        (i) => i.type === "recipient_not_registered" || i.type === "scope_mismatch",
      );
      expect(recipientIssues).toHaveLength(0);
    });

    it("should still detect namespace_not_found for pack-only identities", async () => {
      const si: ServiceIdentityDefinition = {
        name: "runtime-svc",
        description: "Runtime",
        namespaces: ["nonexistent"],
        pack_only: true,
        environments: {
          dev: { recipient: "age1devkeyq" },
          staging: { recipient: "age1stgkeyq" },
          production: { recipient: "age1prdkeyq" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockReturnValue(false);

      const issues = await manager.validate(manifest, "/repo");
      expect(issues.some((i) => i.type === "namespace_not_found")).toBe(true);
    });

    it("should warn when pack-only identity has shared recipients", async () => {
      const si: ServiceIdentityDefinition = {
        name: "runtime-shared",
        description: "Runtime shared",
        namespaces: ["api"],
        pack_only: true,
        environments: {
          dev: { recipient: "age1samekeyq" },
          staging: { recipient: "age1samekeyq" },
          production: { recipient: "age1samekeyq" },
        },
      };
      const manifest = baseManifest({ service_identities: [si] });
      mockFs.existsSync.mockReturnValue(false);

      const issues = await manager.validate(manifest, "/repo");
      const shared = issues.filter((i) => i.type === "runtime_shared_recipient");
      expect(shared).toHaveLength(1);
      expect(shared[0].message).toContain("shared recipient");
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
              staging: { recipient: "age1stagekey" },
              production: {
                kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:123456789012:key/prod" },
              },
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
        "age1stagekey",
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

      // Manifest is written via write-file-atomic
      const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
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
      expect(mockWriteFileAtomicSync).not.toHaveBeenCalled();
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
              staging: { recipient: "age1stagekey" },
              production: {
                kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:123456789012:key/prod" },
              },
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
        "age1stagekey",
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

      // Manifest is written via write-file-atomic
      const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
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

  describe("addEnvironmentToScope", () => {
    function setupFs(manifest: ClefManifest): void {
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
      mockFs.writeFileSync.mockImplementation(() => {});
      // Pretend every cell exists
      mockFs.existsSync.mockReturnValue(true);
    }

    /**
     * The SI here is scoped to `database` and has dev + production envs but
     * NOT staging. We add a new `staging` env entry, generating a fresh
     * age key and registering its recipient on the existing staging cell
     * in the SI's scoped namespaces.
     */
    function manifestWithMissingEnv(): ClefManifest {
      return baseManifest({
        service_identities: [
          {
            name: "web-app",
            description: "Web app",
            namespaces: ["database"],
            // Note: only dev + production. staging is in baseManifest.environments
            // but the SI doesn't have a config for it — that's the gap this method fills.
            environments: {
              dev: { recipient: "age1xstdevkey" },
              production: { recipient: "age1xstprdkey" },
            },
          },
        ],
      });
    }

    it("generates an age key by default and registers its recipient on scoped cells", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);

      const result = await manager.addEnvironmentToScope("web-app", "staging", manifest, "/repo");

      // The new private key is returned to the caller
      expect(result.privateKey).toMatch(/^AGE-SECRET-KEY-/);

      // The new recipient was registered on the scoped staging cell only
      // (database/staging.enc.yaml — api/staging is out of scope)
      expect(encryption.addRecipient).toHaveBeenCalledTimes(1);
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        "/repo/database/staging.enc.yaml",
        expect.stringMatching(/^age1devkey/),
      );

      // Manifest updated with the new staging entry on the SI
      const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
      const written = YAML.parse(writeCall![1] as string) as ClefManifest;
      const si = written.service_identities!.find((s) => s.name === "web-app")!;
      expect(si.environments).toHaveProperty("staging");
      expect((si.environments.staging as { recipient: string }).recipient).toMatch(/^age1devkey/);
    });

    it("uses the supplied KMS config when provided and skips age key generation", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);

      const result = await manager.addEnvironmentToScope("web-app", "staging", manifest, "/repo", {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/new",
      });

      // KMS path: no private key returned, no age key generated
      expect(result.privateKey).toBeUndefined();
      expect(generateAgeIdentity).not.toHaveBeenCalled();
      // KMS envs have no recipient on cells — addRecipient not called
      expect(encryption.addRecipient).not.toHaveBeenCalled();

      const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
      const written = YAML.parse(writeCall![1] as string) as ClefManifest;
      const si = written.service_identities!.find((s) => s.name === "web-app")!;
      expect(si.environments.staging).toEqual({
        kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:123456789012:key/new" },
      });
    });

    it("throws if the service identity does not exist", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);

      await expect(
        manager.addEnvironmentToScope("nonexistent", "staging", manifest, "/repo"),
      ).rejects.toThrow("Service identity 'nonexistent' not found");
    });

    it("throws if the env does not exist in the manifest", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);

      await expect(
        manager.addEnvironmentToScope("web-app", "nonexistent", manifest, "/repo"),
      ).rejects.toThrow("Environment 'nonexistent' not found in manifest");
    });

    it("throws if the env is already configured on the SI", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);

      await expect(
        manager.addEnvironmentToScope("web-app", "dev", manifest, "/repo"),
      ).rejects.toThrow("already has a config for environment 'dev'");
    });

    it("ignores 'already a recipient' errors from SOPS", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);
      encryption.addRecipient.mockRejectedValueOnce(new Error("recipient already in keys"));

      // Should NOT throw
      const result = await manager.addEnvironmentToScope("web-app", "staging", manifest, "/repo");
      expect(result.privateKey).toMatch(/^AGE-SECRET-KEY-/);
    });

    it("re-throws non-duplicate encryption errors", async () => {
      const manifest = manifestWithMissingEnv();
      setupFs(manifest);
      encryption.addRecipient.mockRejectedValueOnce(new Error("KMS access denied"));

      await expect(
        manager.addEnvironmentToScope("web-app", "staging", manifest, "/repo"),
      ).rejects.toThrow("KMS access denied");
    });
  });
});
