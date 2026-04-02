import * as fs from "fs";
import * as YAML from "yaml";
import { BackendMigrator, MigrationTarget } from "./backend";
import { ClefManifest, EncryptionBackend, SopsMetadata } from "../types";

jest.mock("fs");

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

const repoRoot = "/repo";

const baseManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [{ name: "database", description: "Database" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

function makeManifestYaml(overrides?: Partial<ClefManifest>): string {
  return YAML.stringify({ ...baseManifest, ...overrides });
}

function ageMeta(): SopsMetadata {
  return { backend: "age", recipients: ["age1abc..."], lastModified: new Date() };
}

function kmsMeta(arn = "arn:aws:kms:us-east-1:123:key/old"): SopsMetadata {
  return { backend: "awskms", recipients: [arn], lastModified: new Date() };
}

function makeEncryption(overrides?: Partial<EncryptionBackend>): EncryptionBackend {
  return {
    decrypt: jest
      .fn()
      .mockResolvedValue({ values: { DB_URL: "postgres://..." }, metadata: ageMeta() }),
    encrypt: jest.fn().mockResolvedValue(undefined),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn().mockResolvedValue(ageMeta()),
    ...overrides,
  };
}

const bothFiles = ["/repo/database/staging.enc.yaml", "/repo/database/production.enc.yaml"];

function makeMatrixManager(existingFiles: string[] = bothFiles) {
  return {
    resolveMatrix: jest.fn().mockReturnValue([
      {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: existingFiles.includes("/repo/database/staging.enc.yaml"),
      },
      {
        namespace: "database",
        environment: "production",
        filePath: "/repo/database/production.enc.yaml",
        exists: existingFiles.includes("/repo/database/production.enc.yaml"),
      },
    ]),
    isProtectedEnvironment: jest.fn(),
  };
}

function setupFsMocks(manifestYaml?: string): void {
  const yaml = manifestYaml ?? makeManifestYaml();
  mockExistsSync.mockImplementation((p) => {
    const ps = String(p);
    if (ps.endsWith(".enc.yaml")) return true;
    return false;
  });
  mockReadFileSync.mockImplementation((p) => {
    const ps = String(p);
    if (ps.endsWith("clef.yaml")) return yaml;
    if (ps.endsWith(".enc.yaml")) return "encrypted: content";
    return "";
  });
}

const awsTarget: MigrationTarget = { backend: "awskms", key: "arn:aws:kms:us-east-1:123:key/new" };

describe("BackendMigrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should migrate all files from age to awskms", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.rolledBack).toBe(false);
    expect(result.migratedFiles).toHaveLength(2);
    expect(result.skippedFiles).toHaveLength(0);
    // 2 migration decrypts + 2 verification decrypts
    expect(enc.decrypt).toHaveBeenCalledTimes(4);
    expect(enc.encrypt).toHaveBeenCalledTimes(2);

    // Verify manifest was updated
    const writeCalls = mockWriteFileSync.mock.calls;
    const manifestWrite = writeCalls.find((c) => String(c[0]).endsWith("clef.yaml"));
    expect(manifestWrite).toBeDefined();
    const written = YAML.parse(manifestWrite![1] as string) as ClefManifest;
    expect(written.sops.default_backend).toBe("awskms");
    expect(written.sops.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/new");
  });

  it("should migrate a single environment with per-env override", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, {
      target: awsTarget,
      environment: "production",
    });

    expect(result.rolledBack).toBe(false);
    expect(result.migratedFiles).toHaveLength(1);
    expect(result.migratedFiles[0]).toContain("production");
    // 1 migration decrypt + 1 verification decrypt
    expect(enc.decrypt).toHaveBeenCalledTimes(2);
    expect(enc.encrypt).toHaveBeenCalledTimes(1);

    // Verify per-env override in manifest
    const manifestWrite = mockWriteFileSync.mock.calls.find((c) =>
      String(c[0]).endsWith("clef.yaml"),
    );
    const written = YAML.parse(manifestWrite![1] as string);
    const prodEnv = written.environments.find((e: { name: string }) => e.name === "production");
    expect(prodEnv.sops.backend).toBe("awskms");
    expect(prodEnv.sops.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/new");

    // Staging should be unchanged
    const stagingEnv = written.environments.find((e: { name: string }) => e.name === "staging");
    expect(stagingEnv.sops).toBeUndefined();
  });

  it("should handle KMS key rotation (same backend, different key)", async () => {
    const manifest: ClefManifest = {
      ...baseManifest,
      sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/old" },
    };
    const enc = makeEncryption({ getMetadata: jest.fn().mockResolvedValue(kmsMeta()) });
    const mm = makeMatrixManager();
    setupFsMocks(makeManifestYaml(manifest));

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(manifest, repoRoot, { target: awsTarget });

    expect(result.rolledBack).toBe(false);
    expect(result.migratedFiles).toHaveLength(2);
  });

  it("should skip files already on the target backend+key", async () => {
    const targetMeta = kmsMeta("arn:aws:kms:us-east-1:123:key/new");
    const enc = makeEncryption({ getMetadata: jest.fn().mockResolvedValue(targetMeta) });
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.migratedFiles).toHaveLength(0);
    expect(result.skippedFiles).toHaveLength(2);
    expect(enc.decrypt).not.toHaveBeenCalled();
    expect(enc.encrypt).not.toHaveBeenCalled();
  });

  it("should not modify files in dry-run mode", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, {
      target: awsTarget,
      dryRun: true,
    });

    expect(result.migratedFiles).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(enc.decrypt).not.toHaveBeenCalled();
    expect(enc.encrypt).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("should rollback all changes on decrypt failure", async () => {
    const enc = makeEncryption({
      decrypt: jest
        .fn()
        .mockResolvedValueOnce({ values: { KEY: "val" }, metadata: ageMeta() })
        .mockRejectedValueOnce(new Error("Decryption failed: missing key")),
    });
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.rolledBack).toBe(true);
    expect(result.error).toContain("Decryption failed");
    expect(result.migratedFiles).toHaveLength(0);

    // Verify rollback writes happened (manifest + sops.yaml + file)
    const restoreWrites = mockWriteFileSync.mock.calls.filter(
      (c) => mockWriteFileSync.mock.calls.indexOf(c) > 0,
    );
    expect(restoreWrites.length).toBeGreaterThan(0);
  });

  it("should rollback all changes on encrypt failure", async () => {
    const enc = makeEncryption({
      encrypt: jest.fn().mockRejectedValue(new Error("KMS access denied")),
    });
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.rolledBack).toBe(true);
    expect(result.error).toContain("KMS access denied");
  });

  it("should verify migrated files and report failures as warnings", async () => {
    const enc = makeEncryption({
      decrypt: jest
        .fn()
        // First two calls: migration decrypt
        .mockResolvedValueOnce({ values: { K: "v" }, metadata: ageMeta() })
        .mockResolvedValueOnce({ values: { K: "v" }, metadata: ageMeta() })
        // Third call: verification succeeds
        .mockResolvedValueOnce({ values: { K: "v" }, metadata: kmsMeta() })
        // Fourth call: verification fails
        .mockRejectedValueOnce(new Error("Verify failed")),
    });
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.rolledBack).toBe(false);
    expect(result.migratedFiles).toHaveLength(2);
    expect(result.verifiedFiles).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("Verify failed"))).toBe(true);
  });

  it("should throw on invalid environment name", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager();

    const migrator = new BackendMigrator(enc, mm as never);
    await expect(
      migrator.migrate(baseManifest, repoRoot, { target: awsTarget, environment: "nonexistent" }),
    ).rejects.toThrow("Environment 'nonexistent' not found");
  });

  it("should return early when no files exist", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager([]);
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, { target: awsTarget });

    expect(result.migratedFiles).toHaveLength(0);
    expect(result.warnings).toContain("No encrypted files found to migrate.");
  });

  it("should warn about age recipients when migrating away from age", async () => {
    const manifestWithRecipients: ClefManifest = {
      ...baseManifest,
      environments: [
        { name: "staging", description: "Staging", recipients: ["age1abc..."] },
        { name: "production", description: "Production", protected: true },
      ],
    };
    const enc = makeEncryption();
    const mm = makeMatrixManager();
    setupFsMocks(makeManifestYaml(manifestWithRecipients));

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(manifestWithRecipients, repoRoot, { target: awsTarget });

    expect(result.warnings.some((w) => w.includes("age recipients"))).toBe(true);
  });

  it("should skip verification when --skip-verify is set", async () => {
    const enc = makeEncryption();
    const mm = makeMatrixManager();
    setupFsMocks();

    const migrator = new BackendMigrator(enc, mm as never);
    const result = await migrator.migrate(baseManifest, repoRoot, {
      target: awsTarget,
      skipVerify: true,
    });

    expect(result.migratedFiles).toHaveLength(2);
    expect(result.verifiedFiles).toHaveLength(0);
    // decrypt called only for migration (2), not verification
    expect(enc.decrypt).toHaveBeenCalledTimes(2);
  });
});
