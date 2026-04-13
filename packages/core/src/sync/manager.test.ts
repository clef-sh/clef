import { SyncManager } from "./manager";
import { ClefManifest, EncryptionBackend, MatrixCell } from "../types";
import { TransactionManager } from "../tx";
import { readSopsKeyNames } from "../sops/keys";
import { markPendingWithRetry } from "../pending/metadata";

jest.mock("../sops/keys");
jest.mock("../pending/metadata", () => ({
  markPendingWithRetry: jest.fn().mockResolvedValue(undefined),
  generateRandomValue: jest.fn().mockReturnValue("r".repeat(64)),
}));

const mockReadSopsKeyNames = readSopsKeyNames as jest.MockedFunction<typeof readSopsKeyNames>;
const mockMarkPending = markPendingWithRetry as jest.Mock;

const repoRoot = "/repo";

function makeStubTx(): TransactionManager {
  return {
    run: jest
      .fn()
      .mockImplementation(
        async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
          await opts.mutate();
          return { sha: "abc123", paths: opts.paths, startedDirty: false };
        },
      ),
  } as unknown as TransactionManager;
}

const baseManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [
    { name: "payments", description: "Payments" },
    { name: "auth", description: "Auth" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

function makeCells(): MatrixCell[] {
  return [
    { namespace: "payments", environment: "dev", filePath: "/repo/payments/dev.enc.yaml", exists: true },
    { namespace: "payments", environment: "staging", filePath: "/repo/payments/staging.enc.yaml", exists: true },
    { namespace: "payments", environment: "production", filePath: "/repo/payments/production.enc.yaml", exists: true },
    { namespace: "auth", environment: "dev", filePath: "/repo/auth/dev.enc.yaml", exists: true },
    { namespace: "auth", environment: "staging", filePath: "/repo/auth/staging.enc.yaml", exists: true },
    { namespace: "auth", environment: "production", filePath: "/repo/auth/production.enc.yaml", exists: true },
  ];
}

function makeMatrixManager(cells: MatrixCell[] = makeCells()) {
  return {
    resolveMatrix: jest.fn().mockReturnValue(cells),
    isProtectedEnvironment: jest.fn().mockImplementation((_m: ClefManifest, env: string) => env === "production"),
  };
}

function makeEncryption(): jest.Mocked<EncryptionBackend> {
  return {
    decrypt: jest.fn().mockResolvedValue({ values: {}, metadata: {} }),
    encrypt: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EncryptionBackend>;
}

describe("SyncManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("plan()", () => {
    it("computes union and identifies missing keys", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "API_KEY", "WEBHOOK_SECRET"];
        if (fp.includes("staging")) return ["DB_URL", "API_KEY"];
        if (fp.includes("production")) return ["DB_URL"];
        return [];
      });

      const plan = await sync.plan(baseManifest, repoRoot, { namespace: "payments" });

      expect(plan.totalKeys).toBe(3); // staging missing 1, production missing 2
      expect(plan.cells).toHaveLength(2);

      const staging = plan.cells.find((c) => c.environment === "staging")!;
      expect(staging.missingKeys).toEqual(["WEBHOOK_SECRET"]);

      const prod = plan.cells.find((c) => c.environment === "production")!;
      expect(prod.missingKeys).toEqual(["API_KEY", "WEBHOOK_SECRET"]);
    });

    it("returns empty when all environments have the same keys", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockReturnValue(["DB_URL", "API_KEY"]);

      const plan = await sync.plan(baseManifest, repoRoot, { namespace: "payments" });
      expect(plan.totalKeys).toBe(0);
      expect(plan.cells).toHaveLength(0);
    });

    it("filters to a single namespace", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      // payments: dev has extra key, auth: dev has extra key
      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("payments/dev")) return ["DB_URL", "EXTRA"];
        if (fp.includes("auth/dev")) return ["TOKEN", "SECRET"];
        return ["DB_URL"]; // all other cells
      });

      const plan = await sync.plan(baseManifest, repoRoot, { namespace: "payments" });

      // Only payments cells should appear
      for (const cell of plan.cells) {
        expect(cell.namespace).toBe("payments");
      }
    });

    it("flags protected environments", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "SECRET"];
        return ["DB_URL"];
      });

      const plan = await sync.plan(baseManifest, repoRoot, { namespace: "payments" });
      expect(plan.hasProtectedEnvs).toBe(true);

      const prod = plan.cells.find((c) => c.environment === "production")!;
      expect(prod.isProtected).toBe(true);

      const staging = plan.cells.find((c) => c.environment === "staging")!;
      expect(staging.isProtected).toBe(false);
    });

    it("skips non-existing cells", async () => {
      const cells = makeCells();
      // Mark production as not existing
      cells.find((c) => c.namespace === "payments" && c.environment === "production")!.exists = false;
      const mm = makeMatrixManager(cells);
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "SECRET"];
        return ["DB_URL"];
      });

      const plan = await sync.plan(baseManifest, repoRoot, { namespace: "payments" });

      // Only staging should appear (production doesn't exist)
      expect(plan.cells).toHaveLength(1);
      expect(plan.cells[0].environment).toBe("staging");
    });

    it("throws for unknown namespace", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      await expect(sync.plan(baseManifest, repoRoot, { namespace: "nope" })).rejects.toThrow(
        "Namespace 'nope' not found in manifest.",
      );
    });

    it("plans all namespaces when namespace is omitted", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["KEY_A", "KEY_B"];
        return ["KEY_A"];
      });

      const plan = await sync.plan(baseManifest, repoRoot, {});

      // Both payments and auth should have gaps
      const namespaces = new Set(plan.cells.map((c) => c.namespace));
      expect(namespaces).toEqual(new Set(["payments", "auth"]));
    });
  });

  describe("sync()", () => {
    it("returns no-op when dryRun is set", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "SECRET"];
        return ["DB_URL"];
      });

      const result = await sync.sync(baseManifest, repoRoot, { namespace: "payments", dryRun: true });

      expect(result.totalKeysScaffolded).toBe(0);
      expect(result.modifiedCells).toHaveLength(0);
      expect((tx.run as jest.Mock)).not.toHaveBeenCalled();
    });

    it("returns no-op when plan has 0 keys", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockReturnValue(["DB_URL"]);

      const result = await sync.sync(baseManifest, repoRoot, { namespace: "payments" });

      expect(result.totalKeysScaffolded).toBe(0);
      expect((tx.run as jest.Mock)).not.toHaveBeenCalled();
    });

    it("decrypts, merges random values, encrypts, and marks pending for each gap cell", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "SECRET"];
        if (fp.includes("staging")) return ["DB_URL"];
        if (fp.includes("production")) return ["DB_URL"];
        return [];
      });

      enc.decrypt.mockResolvedValue({ values: { DB_URL: "existing" }, metadata: {} as never });

      const result = await sync.sync(baseManifest, repoRoot, { namespace: "payments" });

      expect(result.totalKeysScaffolded).toBe(2); // staging + production each missing SECRET
      expect(result.modifiedCells).toEqual(["payments/staging", "payments/production"]);

      // decrypt called for staging and production
      expect(enc.decrypt).toHaveBeenCalledTimes(2);

      // encrypt called with merged values (existing + random)
      expect(enc.encrypt).toHaveBeenCalledTimes(2);
      const encryptCall = enc.encrypt.mock.calls[0];
      expect(encryptCall[1]).toHaveProperty("DB_URL", "existing");
      expect(encryptCall[1]).toHaveProperty("SECRET", "r".repeat(64));

      // markPendingWithRetry called for each cell
      expect(mockMarkPending).toHaveBeenCalledTimes(2);
      expect(mockMarkPending).toHaveBeenCalledWith(
        expect.stringContaining("staging.enc.yaml"),
        ["SECRET"],
        "clef sync",
      );
    });

    it("does not overwrite existing keys", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["A", "B"];
        if (fp.includes("staging")) return ["A"];
        return ["A"];
      });

      enc.decrypt.mockResolvedValue({ values: { A: "real-value" }, metadata: {} as never });

      await sync.sync(baseManifest, repoRoot, { namespace: "payments" });

      // The existing key A should not be overwritten
      const encryptCall = enc.encrypt.mock.calls[0];
      expect(encryptCall[1].A).toBe("real-value");
      expect(encryptCall[1].B).toBe("r".repeat(64));
    });

    it("creates a single transaction with enc + meta paths", async () => {
      const mm = makeMatrixManager();
      const enc = makeEncryption();
      const tx = makeStubTx();
      const sync = new SyncManager(mm as never, enc, tx);

      mockReadSopsKeyNames.mockImplementation((fp: string) => {
        if (fp.includes("dev")) return ["DB_URL", "SECRET"];
        return ["DB_URL"];
      });

      enc.decrypt.mockResolvedValue({ values: { DB_URL: "x" }, metadata: {} as never });

      await sync.sync(baseManifest, repoRoot, { namespace: "payments" });

      expect((tx.run as jest.Mock)).toHaveBeenCalledTimes(1);
      const txCall = (tx.run as jest.Mock).mock.calls[0];
      const paths: string[] = txCall[1].paths;

      // Should have both .enc.yaml and .clef-meta.yaml for staging + production
      expect(paths).toContain("payments/staging.enc.yaml");
      expect(paths).toContain("payments/staging.clef-meta.yaml");
      expect(paths).toContain("payments/production.enc.yaml");
      expect(paths).toContain("payments/production.clef-meta.yaml");
    });
  });
});
