import { ImportRunner } from "./index";
import { ClefManifest, DecryptedFile } from "../types";
import { TransactionManager } from "../tx";

const mockDecrypt = jest.fn();
const mockEncrypt = jest.fn();

// Create a fake SopsClient with mocked methods
const fakeSopsClient = {
  decrypt: mockDecrypt,
  encrypt: mockEncrypt,
};

const manifest: ClefManifest = {
  version: 1,
  environments: [{ name: "staging", description: "Staging" }],
  namespaces: [{ name: "database", description: "Database" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const defaultDecrypted: DecryptedFile = {
  values: { EXISTING_KEY: "existing_value" },
  metadata: { backend: "age", recipients: ["age1test"], lastModified: new Date() },
};

/** Stub TransactionManager that just runs the mutate callback inline. */
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

function makeRunner(): ImportRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ImportRunner(fakeSopsClient as any, makeStubTx());
}

describe("ImportRunner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDecrypt.mockResolvedValue(defaultDecrypted);
    mockEncrypt.mockResolvedValue(undefined);
  });

  describe("basic import", () => {
    it("imports all keys from dotenv content", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\nDB_PORT=5432\n",
        manifest,
        "/repo",
        {},
      );

      expect(result.imported).toContain("DB_HOST");
      expect(result.imported).toContain("DB_PORT");
      expect(result.skipped).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.dryRun).toBe(false);
    });

    it("encrypts the file once with all imported keys merged", async () => {
      const runner = makeRunner();
      await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\nDB_PORT=5432\n",
        manifest,
        "/repo",
        {},
      );

      // After the migration, the runner merges all candidates in memory and
      // does a SINGLE encrypt instead of N encrypts. Cuts SOPS subprocess
      // overhead from O(N) to O(1) and makes the import atomic.
      expect(mockEncrypt).toHaveBeenCalledTimes(1);
      const lastCall = mockEncrypt.mock.calls[0];
      expect(lastCall[1]).toMatchObject({
        EXISTING_KEY: "existing_value",
        DB_HOST: "localhost",
        DB_PORT: "5432",
      });
    });

    it("uses correct file path from manifest pattern", async () => {
      const runner = makeRunner();
      await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\n",
        manifest,
        "/my/repo",
        {},
      );

      expect(mockDecrypt).toHaveBeenCalledWith(
        expect.stringContaining("database/staging.enc.yaml"),
      );
    });
  });

  describe("prefix filter", () => {
    it("imports only keys matching prefix", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\nDB_PORT=5432\nSTRIPE_KEY=sk_test\n",
        manifest,
        "/repo",
        { prefix: "DB_" },
      );

      expect(result.imported).toContain("DB_HOST");
      expect(result.imported).toContain("DB_PORT");
      expect(result.imported).not.toContain("STRIPE_KEY");
    });

    it("returns empty imported when no keys match prefix", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "STRIPE_KEY=sk_test\n",
        manifest,
        "/repo",
        { prefix: "DB_" },
      );

      expect(result.imported).toEqual([]);
    });
  });

  describe("keys filter", () => {
    it("imports only specified keys", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\nDB_PORT=5432\nDB_PASSWORD=secret\n",
        manifest,
        "/repo",
        { keys: ["DB_HOST", "DB_PASSWORD"] },
      );

      expect(result.imported).toContain("DB_HOST");
      expect(result.imported).toContain("DB_PASSWORD");
      expect(result.imported).not.toContain("DB_PORT");
    });
  });

  describe("overwrite behavior", () => {
    it("skips existing keys without --overwrite", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "EXISTING_KEY=new_value\nNEW_KEY=value\n",
        manifest,
        "/repo",
        { overwrite: false },
      );

      expect(result.skipped).toContain("EXISTING_KEY");
      expect(result.imported).toContain("NEW_KEY");
    });

    it("overwrites existing keys with --overwrite", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "EXISTING_KEY=new_value\n",
        manifest,
        "/repo",
        { overwrite: true },
      );

      expect(result.imported).toContain("EXISTING_KEY");
      expect(result.skipped).not.toContain("EXISTING_KEY");
    });
  });

  describe("dry run", () => {
    it("does not call sopsClient.encrypt in dry run mode", async () => {
      const runner = makeRunner();
      await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\nDB_PORT=5432\n",
        manifest,
        "/repo",
        { dryRun: true },
      );

      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it("returns dryRun: true in result", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "DB_HOST=localhost\n",
        manifest,
        "/repo",
        { dryRun: true },
      );

      expect(result.dryRun).toBe(true);
    });

    it("shows existing keys as would-skip in dry run without overwrite", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "EXISTING_KEY=new_value\nNEW_KEY=value\n",
        manifest,
        "/repo",
        { dryRun: true, overwrite: false },
      );

      expect(result.skipped).toContain("EXISTING_KEY");
      expect(result.imported).toContain("NEW_KEY");
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it("shows existing keys as would-import in dry run with overwrite", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "EXISTING_KEY=new_value\n",
        manifest,
        "/repo",
        { dryRun: true, overwrite: true },
      );

      expect(result.imported).toContain("EXISTING_KEY");
      expect(result.skipped).not.toContain("EXISTING_KEY");
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it("treats decrypt failure as empty existing keys in dry run", async () => {
      mockDecrypt.mockRejectedValueOnce(new Error("decrypt failed"));
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "NEW_KEY=value\n",
        manifest,
        "/repo",
        { dryRun: true },
      );

      // If decrypt fails, new keys are still shown as would-import
      expect(result.imported).toContain("NEW_KEY");
      expect(mockEncrypt).not.toHaveBeenCalled();
    });
  });

  describe("encrypt failure", () => {
    it("propagates the encrypt error so the transaction can roll back", async () => {
      mockEncrypt.mockRejectedValueOnce(new Error("encryption failed"));

      const runner = makeRunner();

      // Import is now atomic — there is no per-key partial state. A failure
      // during the single merged encrypt aborts the whole import and the
      // error propagates so TransactionManager can `git reset --hard`.
      await expect(
        runner.import(
          "database/staging",
          null,
          "FIRST_KEY=value1\nSECOND_KEY=value2\n",
          manifest,
          "/repo",
          {},
        ),
      ).rejects.toThrow("encryption failed");
    });
  });

  describe("warnings propagation", () => {
    it("propagates parser warnings to result", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        '{"STRING_KEY": "value", "NUMBER_KEY": 42}',
        manifest,
        "/repo",
        { format: "json" },
      );

      expect(result.warnings).toEqual(
        expect.arrayContaining(["NUMBER_KEY: skipped — value is number, not string"]),
      );
    });
  });

  describe("format options", () => {
    it("parses JSON content with json format", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        '{"DB_HOST": "localhost"}',
        manifest,
        "/repo",
        { format: "json" },
      );

      expect(result.imported).toContain("DB_HOST");
    });

    it("parses YAML content with yaml format", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        null,
        "DB_HOST: localhost\n",
        manifest,
        "/repo",
        { format: "yaml" },
      );

      expect(result.imported).toContain("DB_HOST");
    });

    it("auto-detects format from source path", async () => {
      const runner = makeRunner();
      const result = await runner.import(
        "database/staging",
        "/project/.env",
        "DB_HOST=localhost\n",
        manifest,
        "/repo",
        {},
      );

      expect(result.imported).toContain("DB_HOST");
    });
  });

  describe("propagate decrypt error in non-dry-run", () => {
    it("propagates decrypt error when not dry run", async () => {
      mockDecrypt.mockRejectedValueOnce(new Error("no key"));
      const runner = makeRunner();

      await expect(
        runner.import("database/staging", null, "KEY=value\n", manifest, "/repo", {}),
      ).rejects.toThrow("no key");
    });
  });
});
