import * as fs from "fs";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { ResetManager, describeScope, ResetScope } from "./manager";
import { ClefManifest, FileEncryptionBackend, MatrixCell } from "../types";
import { TransactionManager } from "../tx";

jest.mock("fs");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;

const repoRoot = "/repo";

/** Stub TransactionManager that runs the mutate callback inline. */
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

const baseManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [
    { name: "database", description: "Database" },
    { name: "api", description: "API" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

function makeCells(): MatrixCell[] {
  return [
    {
      namespace: "database",
      environment: "staging",
      filePath: "/repo/database/staging.enc.yaml",
      exists: true,
    },
    {
      namespace: "database",
      environment: "production",
      filePath: "/repo/database/production.enc.yaml",
      exists: true,
    },
    {
      namespace: "api",
      environment: "staging",
      filePath: "/repo/api/staging.enc.yaml",
      exists: true,
    },
    {
      namespace: "api",
      environment: "production",
      filePath: "/repo/api/production.enc.yaml",
      exists: true,
    },
  ];
}

function makeMatrixManager(cells: MatrixCell[] = makeCells()) {
  return {
    resolveMatrix: jest.fn().mockReturnValue(cells),
    isProtectedEnvironment: jest.fn(),
  };
}

function makeEncryption(overrides?: Partial<FileEncryptionBackend>): FileEncryptionBackend {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn().mockResolvedValue(undefined),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
    ...overrides,
  };
}

function makeSchemaValidator(loadImpl?: jest.Mock): { loadSchema: jest.Mock; validate: jest.Mock } {
  return {
    loadSchema: loadImpl ?? jest.fn(),
    validate: jest.fn(),
  };
}

function setupFsMocks(manifestYaml?: string): void {
  const yaml = manifestYaml ?? YAML.stringify(baseManifest);
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockImplementation((p) => {
    const ps = String(p);
    if (ps.endsWith("clef.yaml")) return yaml;
    return "";
  });
}

describe("ResetManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFileSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
  });

  describe("scope resolution", () => {
    it("scopes to a single environment across all namespaces", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "env", name: "staging" } },
        baseManifest,
        repoRoot,
      );

      expect(result.affectedEnvironments).toEqual(["staging"]);
      expect(result.scaffoldedCells).toHaveLength(2);
      expect(result.scaffoldedCells).toEqual(
        expect.arrayContaining(["/repo/database/staging.enc.yaml", "/repo/api/staging.enc.yaml"]),
      );
      expect(enc.encrypt).toHaveBeenCalledTimes(2);
      expect(enc.decrypt).not.toHaveBeenCalled();
    });

    it("scopes to a single namespace across all environments", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "namespace", name: "database" } },
        baseManifest,
        repoRoot,
      );

      expect(result.affectedEnvironments).toEqual(["production", "staging"]);
      expect(result.scaffoldedCells).toHaveLength(2);
      expect(result.scaffoldedCells).toEqual(
        expect.arrayContaining([
          "/repo/database/staging.enc.yaml",
          "/repo/database/production.enc.yaml",
        ]),
      );
    });

    it("scopes to a single cell", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "cell", namespace: "database", environment: "staging" } },
        baseManifest,
        repoRoot,
      );

      expect(result.affectedEnvironments).toEqual(["staging"]);
      expect(result.scaffoldedCells).toEqual(["/repo/database/staging.enc.yaml"]);
      expect(enc.encrypt).toHaveBeenCalledTimes(1);
    });

    it("throws when scope matches zero cells", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager([]);
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset({ scope: { kind: "env", name: "staging" } }, baseManifest, repoRoot),
      ).rejects.toThrow("matches zero cells");
    });

    it("throws on unknown environment scope", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset({ scope: { kind: "env", name: "nonexistent" } }, baseManifest, repoRoot),
      ).rejects.toThrow("Environment 'nonexistent' not found");
    });

    it("throws on unknown namespace scope", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          { scope: { kind: "namespace", name: "nonexistent" } },
          baseManifest,
          repoRoot,
        ),
      ).rejects.toThrow("Namespace 'nonexistent' not found");
    });

    it("throws on cell scope with unknown namespace", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          { scope: { kind: "cell", namespace: "nope", environment: "staging" } },
          baseManifest,
          repoRoot,
        ),
      ).rejects.toThrow("Namespace 'nope' not found");
    });

    it("throws on cell scope with unknown environment", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          { scope: { kind: "cell", namespace: "database", environment: "nope" } },
          baseManifest,
          repoRoot,
        ),
      ).rejects.toThrow("Environment 'nope' not found");
    });
  });

  describe("backend override", () => {
    it("writes per-env backend override when --backend is provided", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        {
          scope: { kind: "env", name: "staging" },
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
        },
        baseManifest,
        repoRoot,
      );

      expect(result.backendChanged).toBe(true);
      const manifestWrite = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
      expect(manifestWrite).toBeDefined();
      const written = YAML.parse(manifestWrite![1] as string) as ClefManifest;
      const staging = written.environments.find((e) => e.name === "staging");
      expect(staging?.sops?.backend).toBe("awskms");
      expect(staging?.sops?.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/new");

      // Non-affected env is unchanged
      const production = written.environments.find((e) => e.name === "production");
      expect(production?.sops).toBeUndefined();
    });

    it("scaffold encrypt sees the new backend via updated manifest view", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await manager.reset(
        {
          scope: { kind: "env", name: "staging" },
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
        },
        baseManifest,
        repoRoot,
      );

      // Every encrypt call should receive a manifest whose staging env has the override
      const calls = (enc.encrypt as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const manifestArg = call[2] as ClefManifest;
        const staging = manifestArg.environments.find((e) => e.name === "staging");
        expect(staging?.sops?.backend).toBe("awskms");
      }
    });

    it("leaves manifest untouched when no --backend provided", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "env", name: "staging" } },
        baseManifest,
        repoRoot,
      );

      expect(result.backendChanged).toBe(false);
      const manifestWrite = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
      expect(manifestWrite).toBeUndefined();
    });

    it("rejects --backend awskms without --key", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          { scope: { kind: "env", name: "staging" }, backend: "awskms" },
          baseManifest,
          repoRoot,
        ),
      ).rejects.toThrow("requires a key");
    });

    it("rejects --key for --backend age", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          { scope: { kind: "env", name: "staging" }, backend: "age", key: "ignored" },
          baseManifest,
          repoRoot,
        ),
      ).rejects.toThrow("does not take a key");
    });

    it("allows --backend age without --key", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "env", name: "staging" }, backend: "age" },
        baseManifest,
        repoRoot,
      );

      expect(result.backendChanged).toBe(true);
    });
  });

  describe("placeholder generation", () => {
    it("scaffolds empty cell when namespace has no schema and no explicit keys", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "cell", namespace: "database", environment: "staging" } },
        baseManifest,
        repoRoot,
      );

      expect(enc.encrypt).toHaveBeenCalledWith(
        "/repo/database/staging.enc.yaml",
        {},
        expect.any(Object),
        "staging",
      );
      expect(result.pendingKeysByCell).toEqual({});
    });

    it("scaffolds explicit keys as pending placeholders", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        {
          scope: { kind: "cell", namespace: "database", environment: "staging" },
          keys: ["DB_URL", "DB_PASSWORD"],
        },
        baseManifest,
        repoRoot,
      );

      const encryptCall = (enc.encrypt as jest.Mock).mock.calls[0];
      const placeholders = encryptCall[1] as Record<string, string>;
      expect(Object.keys(placeholders).sort()).toEqual(["DB_PASSWORD", "DB_URL"]);
      expect(placeholders.DB_URL).toMatch(/^[a-f0-9]{64}$/);
      expect(placeholders.DB_PASSWORD).toMatch(/^[a-f0-9]{64}$/);

      expect(result.pendingKeysByCell["/repo/database/staging.enc.yaml"].sort()).toEqual([
        "DB_PASSWORD",
        "DB_URL",
      ]);
    });

    it("scaffolds schema-derived keys when namespace has a schema", async () => {
      const enc = makeEncryption();
      const schemaManifest: ClefManifest = {
        ...baseManifest,
        namespaces: [
          { name: "database", description: "Database", schema: "schemas/database.yaml" },
          { name: "api", description: "API" },
        ],
      };
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator(
        jest.fn().mockReturnValue({
          keys: {
            DB_URL: { type: "string", required: true },
            DB_USER: { type: "string", required: true },
            DB_PORT: { type: "integer", required: false },
          },
        }),
      );
      setupFsMocks(YAML.stringify(schemaManifest));

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      const result = await manager.reset(
        { scope: { kind: "cell", namespace: "database", environment: "staging" } },
        schemaManifest,
        repoRoot,
      );

      const encryptCall = (enc.encrypt as jest.Mock).mock.calls[0];
      const placeholders = encryptCall[1] as Record<string, string>;
      expect(Object.keys(placeholders).sort()).toEqual(["DB_PORT", "DB_URL", "DB_USER"]);
      expect(sv.loadSchema).toHaveBeenCalledWith("/repo/schemas/database.yaml");
      expect(result.pendingKeysByCell["/repo/database/staging.enc.yaml"]).toHaveLength(3);
    });

    it("schema takes precedence over explicit keys when both provided", async () => {
      const enc = makeEncryption();
      const schemaManifest: ClefManifest = {
        ...baseManifest,
        namespaces: [
          { name: "database", description: "Database", schema: "schemas/database.yaml" },
          { name: "api", description: "API" },
        ],
      };
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator(
        jest.fn().mockReturnValue({
          keys: { SCHEMA_KEY: { type: "string", required: true } },
        }),
      );
      setupFsMocks(YAML.stringify(schemaManifest));

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await manager.reset(
        {
          scope: { kind: "cell", namespace: "database", environment: "staging" },
          keys: ["CLI_KEY"],
        },
        schemaManifest,
        repoRoot,
      );

      const encryptCall = (enc.encrypt as jest.Mock).mock.calls[0];
      const placeholders = encryptCall[1] as Record<string, string>;
      expect(Object.keys(placeholders)).toEqual(["SCHEMA_KEY"]);
    });

    it("propagates schema load errors instead of falling back silently", async () => {
      const enc = makeEncryption();
      const schemaManifest: ClefManifest = {
        ...baseManifest,
        namespaces: [
          { name: "database", description: "Database", schema: "schemas/database.yaml" },
          { name: "api", description: "API" },
        ],
      };
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator(
        jest.fn().mockImplementation(() => {
          throw new Error("schema file missing");
        }),
      );
      setupFsMocks(YAML.stringify(schemaManifest));

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await expect(
        manager.reset(
          {
            scope: { kind: "cell", namespace: "database", environment: "staging" },
            keys: ["FALLBACK_KEY"],
          },
          schemaManifest,
          repoRoot,
        ),
      ).rejects.toThrow("schema file missing");

      // Schema errors must surface BEFORE the transaction opens — nothing
      // should have been written.
      expect(enc.encrypt).not.toHaveBeenCalled();
    });

    it("loads schema once per namespace, not once per cell", async () => {
      const enc = makeEncryption();
      const schemaManifest: ClefManifest = {
        ...baseManifest,
        namespaces: [
          { name: "database", description: "Database", schema: "schemas/database.yaml" },
          { name: "api", description: "API" },
        ],
      };
      const mm = makeMatrixManager();
      const loadSchema = jest
        .fn()
        .mockReturnValue({ keys: { K: { type: "string", required: true } } });
      const sv = makeSchemaValidator(loadSchema);
      setupFsMocks(YAML.stringify(schemaManifest));

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await manager.reset(
        { scope: { kind: "namespace", name: "database" } },
        schemaManifest,
        repoRoot,
      );

      // Two cells in the "database" namespace (staging + production) but
      // the schema should only be loaded once.
      expect(loadSchema).toHaveBeenCalledTimes(1);
      expect(enc.encrypt).toHaveBeenCalledTimes(2);
    });
  });

  describe("transaction paths", () => {
    // git add errors on a pathspec that doesn't match anything in the
    // worktree, so txPaths must only list files we will actually create.
    // This block is the regression net for that constraint — an e2e test
    // caught it the first time.

    it("does not include the .clef-meta.yaml sibling when the cell has no pending keys", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      const tx = makeStubTx();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, tx);
      await manager.reset(
        { scope: { kind: "cell", namespace: "database", environment: "staging" } },
        baseManifest,
        repoRoot,
      );

      const txPaths = (tx.run as jest.Mock).mock.calls[0][1].paths as string[];
      expect(txPaths).toContain("database/staging.enc.yaml");
      expect(txPaths).not.toContain("database/staging.clef-meta.yaml");
    });

    it("does not include the manifest path when no backend switch is requested", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      const tx = makeStubTx();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, tx);
      await manager.reset({ scope: { kind: "env", name: "staging" } }, baseManifest, repoRoot);

      const txPaths = (tx.run as jest.Mock).mock.calls[0][1].paths as string[];
      expect(txPaths).not.toContain("clef.yaml");
    });

    it("includes the manifest path when a backend switch is requested", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      const tx = makeStubTx();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, tx);
      await manager.reset(
        {
          scope: { kind: "env", name: "staging" },
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
        },
        baseManifest,
        repoRoot,
      );

      const txPaths = (tx.run as jest.Mock).mock.calls[0][1].paths as string[];
      expect(txPaths).toContain("clef.yaml");
    });

    it("includes the .clef-meta.yaml sibling when explicit keys are provided", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      const tx = makeStubTx();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, tx);
      await manager.reset(
        {
          scope: { kind: "cell", namespace: "database", environment: "staging" },
          keys: ["DB_URL"],
        },
        baseManifest,
        repoRoot,
      );

      const txPaths = (tx.run as jest.Mock).mock.calls[0][1].paths as string[];
      expect(txPaths).toContain("database/staging.enc.yaml");
      expect(txPaths).toContain("database/staging.clef-meta.yaml");
    });

    it("includes the .clef-meta.yaml sibling when the namespace has a schema", async () => {
      const enc = makeEncryption();
      const schemaManifest: ClefManifest = {
        ...baseManifest,
        namespaces: [
          { name: "database", description: "Database", schema: "schemas/database.yaml" },
          { name: "api", description: "API" },
        ],
      };
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator(
        jest.fn().mockReturnValue({ keys: { DB_URL: { type: "string", required: true } } }),
      );
      const tx = makeStubTx();
      setupFsMocks(YAML.stringify(schemaManifest));

      const manager = new ResetManager(mm as never, enc, sv as never, tx);
      await manager.reset(
        { scope: { kind: "cell", namespace: "database", environment: "staging" } },
        schemaManifest,
        repoRoot,
      );

      const txPaths = (tx.run as jest.Mock).mock.calls[0][1].paths as string[];
      expect(txPaths).toContain("database/staging.clef-meta.yaml");
    });
  });

  describe("non-decryption property", () => {
    it("never calls decrypt on any cell", async () => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await manager.reset(
        {
          scope: { kind: "env", name: "staging" },
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
          keys: ["K"],
        },
        baseManifest,
        repoRoot,
      );

      expect(enc.decrypt).not.toHaveBeenCalled();
      expect(enc.getMetadata).not.toHaveBeenCalled();
    });
  });

  describe("describeScope", () => {
    it("formats env scope", () => {
      expect(describeScope({ kind: "env", name: "staging" })).toBe("env staging");
    });

    it("formats namespace scope", () => {
      expect(describeScope({ kind: "namespace", name: "database" })).toBe("namespace database");
    });

    it("formats cell scope", () => {
      const scope: ResetScope = { kind: "cell", namespace: "database", environment: "staging" };
      expect(describeScope(scope)).toBe("database/staging");
    });
  });

  describe("backend override key mapping", () => {
    it.each([
      ["awskms", "aws_kms_arn", "arn:aws:kms:us-east-1:123:key/new"],
      ["gcpkms", "gcp_kms_resource_id", "projects/p/locations/l/keyRings/r/cryptoKeys/k"],
      ["azurekv", "azure_kv_url", "https://vault.vault.azure.net/keys/k/v"],
      ["pgp", "pgp_fingerprint", "ABCD1234"],
    ] as const)("maps %s to the correct key field", async (backend, field, keyValue) => {
      const enc = makeEncryption();
      const mm = makeMatrixManager();
      const sv = makeSchemaValidator();
      setupFsMocks();

      const manager = new ResetManager(mm as never, enc, sv as never, makeStubTx());
      await manager.reset(
        { scope: { kind: "env", name: "staging" }, backend, key: keyValue },
        baseManifest,
        repoRoot,
      );

      const manifestWrite = mockWriteFileAtomicSync.mock.calls.find((c) =>
        String(c[0]).endsWith("clef.yaml"),
      );
      const written = YAML.parse(manifestWrite![1] as string) as ClefManifest;
      const staging = written.environments.find((e) => e.name === "staging");
      expect(staging?.sops?.backend).toBe(backend);
      expect((staging?.sops as unknown as Record<string, string>)?.[field]).toBe(keyValue);
    });
  });
});
