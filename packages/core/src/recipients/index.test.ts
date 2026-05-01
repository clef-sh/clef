import * as fs from "fs";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { RecipientManager } from "./index";
import { ClefManifest, EncryptionBackend } from "../types";
import { TransactionManager } from "../tx";

jest.mock("fs");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;

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

const validKey1 = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
const validKey2 = "age1deadgyu9nk64as3xhfmz05u94lef3nym6hvqntrrmyzpq28pjxdqs5gfng";

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production" },
  ],
  namespaces: [{ name: "database", description: "Database" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const repoRoot = "/repo";

function makeManifestYaml(recipients: unknown[] = []): string {
  return YAML.stringify({
    version: 1,
    environments: [
      { name: "staging", description: "Staging" },
      { name: "production", description: "Production" },
    ],
    namespaces: [{ name: "database", description: "Database" }],
    sops: {
      default_backend: "age",
      age: {
        recipients,
      },
    },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  });
}

function makeEncryption(overrides?: Partial<EncryptionBackend>): EncryptionBackend {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn().mockResolvedValue(undefined),
    removeRecipient: jest.fn().mockResolvedValue(undefined),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
    ...overrides,
  };
}

function makeMatrixManager(existingFiles: string[] = []) {
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
  };
}

describe("RecipientManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("list", () => {
    it("reads recipients from manifest YAML", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(makeManifestYaml([{ key: validKey1, label: "Alice" }]));

      const result = await manager.list(manifest, repoRoot);

      expect(result).toEqual([
        {
          key: validKey1,
          preview: `age1\u2026aqmcac8p`,
          label: "Alice",
        },
      ]);
    });

    it("handles plain string recipient form", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(makeManifestYaml([validKey1]));

      const result = await manager.list(manifest, repoRoot);

      expect(result).toEqual([
        {
          key: validKey1,
          preview: `age1\u2026aqmcac8p`,
        },
      ]);
    });

    it("handles mixed string and object forms", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(
        makeManifestYaml([validKey1, { key: validKey2, label: "Bob" }]),
      );

      const result = await manager.list(manifest, repoRoot);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe(validKey1);
      expect(result[0].label).toBeUndefined();
      expect(result[1].key).toBe(validKey2);
      expect(result[1].label).toBe("Bob");
    });

    it("returns empty array when no recipients section", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(
        YAML.stringify({
          version: 1,
          sops: { default_backend: "age" },
        }),
      );

      const result = await manager.list(manifest, repoRoot);

      expect(result).toEqual([]);
    });

    it("returns empty array when no age section", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(
        YAML.stringify({
          version: 1,
          sops: { default_backend: "age" },
        }),
      );

      const result = await manager.list(manifest, repoRoot);

      expect(result).toEqual([]);
    });
  });

  describe("add", () => {
    it("validates key before adding", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      await expect(manager.add("not-a-valid-key", undefined, manifest, repoRoot)).rejects.toThrow(
        "must start with 'age1'",
      );
    });

    it("rejects duplicate key", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(makeManifestYaml([validKey1]));

      await expect(manager.add(validKey1, undefined, manifest, repoRoot)).rejects.toThrow(
        "already present",
      );
    });

    it("updates clef.yaml and re-encrypts all existing files", async () => {
      const encryption = makeEncryption();
      const existingFiles = [
        "/repo/database/staging.enc.yaml",
        "/repo/database/production.enc.yaml",
      ];
      const mm = makeMatrixManager(existingFiles);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount <= 2) {
          return makeManifestYaml([]);
        }
        if (readCallCount <= 4) {
          return "encrypted-file-content";
        }
        // Final read of updated manifest
        return makeManifestYaml([validKey1]);
      });

      mockExistsSync.mockReturnValue(true);

      const result = await manager.add(validKey1, "Alice", manifest, repoRoot);

      expect(result.added).toBeDefined();
      expect(result.added!.key).toBe(validKey1);
      expect(result.added!.label).toBe("Alice");
      expect(result.reEncryptedFiles).toHaveLength(2);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);

      // Check that addRecipient was called for each file
      expect(encryption.addRecipient).toHaveBeenCalledTimes(2);
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        "/repo/database/staging.enc.yaml",
        validKey1,
      );
      expect(encryption.addRecipient).toHaveBeenCalledWith(
        "/repo/database/production.enc.yaml",
        validKey1,
      );

      // Check that manifest was written (via write-file-atomic)
      expect(mockWriteFileAtomicSync).toHaveBeenCalled();
    });

    it("adds key as plain string when no label", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      const result = await manager.add(validKey1, undefined, manifest, repoRoot);

      expect(result.added!.key).toBe(validKey1);
      expect(result.added!.label).toBeUndefined();

      // Verify what was written to manifest (via write-file-atomic)
      const writeCall = mockWriteFileAtomicSync.mock.calls[0];
      const writtenYaml = YAML.parse(writeCall[1] as string) as Record<string, unknown>;
      const sops = writtenYaml.sops as Record<string, unknown>;
      const age = sops.age as Record<string, unknown>;
      const recipients = age.recipients as unknown[];
      expect(recipients[0]).toBe(validKey1);
    });

    it("adds key as object when label provided", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      await manager.add(validKey1, "Alice", manifest, repoRoot);

      const writeCall = mockWriteFileAtomicSync.mock.calls[0];
      const writtenYaml = YAML.parse(writeCall[1] as string) as Record<string, unknown>;
      const sops = writtenYaml.sops as Record<string, unknown>;
      const age = sops.age as Record<string, unknown>;
      const recipients = age.recipients as Array<Record<string, string>>;
      expect(recipients[0]).toEqual({ key: validKey1, label: "Alice" });
    });

    it("propagates re-encryption failures so the transaction can roll back", async () => {
      const existingFiles = [
        "/repo/database/staging.enc.yaml",
        "/repo/database/production.enc.yaml",
      ];
      const mm = makeMatrixManager(existingFiles);

      let addCallCount = 0;
      const encryption = makeEncryption({
        addRecipient: jest.fn().mockImplementation(async () => {
          addCallCount++;
          if (addCallCount === 2) {
            throw new Error("re-encryption failed");
          }
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      // The manager no longer does its own rollback — it lets the failure
      // propagate up so TransactionManager can `git reset --hard`. This
      // test asserts the failure surfaces; the rollback itself is covered
      // by transaction-manager.test.ts.
      await expect(manager.add(validKey1, undefined, manifest, repoRoot)).rejects.toThrow(
        "re-encryption failed",
      );
    });

    it("trims key whitespace before validation", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      const result = await manager.add(`  ${validKey1}  `, undefined, manifest, repoRoot);

      expect(result.added!.key).toBe(validKey1);
    });

    it("creates sops.age.recipients structure when missing", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() =>
        YAML.stringify({
          version: 1,
          environments: [
            { name: "staging", description: "Staging" },
            { name: "production", description: "Production" },
          ],
          namespaces: [{ name: "database", description: "Database" }],
          sops: { default_backend: "age" },
          file_pattern: "{namespace}/{environment}.enc.yaml",
        }),
      );

      const result = await manager.add(validKey1, undefined, manifest, repoRoot);

      expect(result.added!.key).toBe(validKey1);

      const writeCall = mockWriteFileAtomicSync.mock.calls[0];
      const writtenYaml = YAML.parse(writeCall[1] as string) as Record<string, unknown>;
      const sops = writtenYaml.sops as Record<string, unknown>;
      const age = sops.age as Record<string, unknown>;
      expect(age.recipients).toEqual([validKey1]);
    });
  });

  describe("remove", () => {
    it("throws when key not found", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockReturnValue(makeManifestYaml([validKey1]));

      await expect(manager.remove(validKey2, manifest, repoRoot)).rejects.toThrow(
        "is not in the manifest",
      );
    });

    it("updates clef.yaml and re-encrypts all existing files", async () => {
      const existingFiles = [
        "/repo/database/staging.enc.yaml",
        "/repo/database/production.enc.yaml",
      ];
      const encryption = makeEncryption();
      const mm = makeMatrixManager(existingFiles);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount <= 2) {
          return makeManifestYaml([validKey1, validKey2]);
        }
        if (readCallCount <= 4) {
          return "encrypted-file-content";
        }
        // Final read returns updated manifest without removed key
        return makeManifestYaml([validKey2]);
      });

      const result = await manager.remove(validKey1, manifest, repoRoot);

      expect(result.removed).toBeDefined();
      expect(result.removed!.key).toBe(validKey1);
      expect(result.reEncryptedFiles).toHaveLength(2);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.warnings).toContain(
        "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
      );

      // Check that removeRecipient was called for each file
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        "/repo/database/staging.enc.yaml",
        validKey1,
      );
      expect(encryption.removeRecipient).toHaveBeenCalledWith(
        "/repo/database/production.enc.yaml",
        validKey1,
      );
    });

    it("propagates re-encryption failures so the transaction can roll back", async () => {
      const existingFiles = [
        "/repo/database/staging.enc.yaml",
        "/repo/database/production.enc.yaml",
      ];

      let removeCallCount = 0;
      const encryption = makeEncryption({
        removeRecipient: jest.fn().mockImplementation(async () => {
          removeCallCount++;
          if (removeCallCount === 2) {
            throw new Error("re-encryption failed");
          }
        }),
      });

      const mm = makeMatrixManager(existingFiles);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      mockReadFileSync.mockImplementation(() => makeManifestYaml([validKey1, validKey2]));

      // Manager no longer has its own rollback path — failures bubble out so
      // TransactionManager can `git reset --hard`. Rollback semantics live in
      // transaction-manager.test.ts.
      await expect(manager.remove(validKey1, manifest, repoRoot)).rejects.toThrow(
        "re-encryption failed",
      );
    });

    it("rotation warning is always present even on success", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount <= 2) {
          return makeManifestYaml([validKey1]);
        }
        return makeManifestYaml([]);
      });

      const result = await manager.remove(validKey1, manifest, repoRoot);

      expect(result.warnings).toContain(
        "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
      );
    });

    it("removes object-form recipient correctly", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount <= 2) {
          return makeManifestYaml([{ key: validKey1, label: "Alice" }]);
        }
        return makeManifestYaml([]);
      });

      const result = await manager.remove(validKey1, manifest, repoRoot);

      expect(result.removed!.key).toBe(validKey1);
      expect(result.removed!.label).toBe("Alice");
    });

    it("skips re-encryption for non-existing files", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]); // no existing files
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any, makeStubTx());

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount <= 2) {
          return makeManifestYaml([validKey1]);
        }
        return makeManifestYaml([]);
      });

      const result = await manager.remove(validKey1, manifest, repoRoot);

      expect(encryption.removeRecipient).not.toHaveBeenCalled();
      expect(result.reEncryptedFiles).toHaveLength(0);
    });
  });

  describe("environment-scoped operations", () => {
    function makeManifestYamlWithEnvRecipients(
      globalRecipients: unknown[] = [],
      envRecipients: Record<string, unknown[]> = {},
    ): string {
      return YAML.stringify({
        version: 1,
        environments: [
          {
            name: "staging",
            description: "Staging",
            ...(envRecipients.staging ? { recipients: envRecipients.staging } : {}),
          },
          {
            name: "production",
            description: "Production",
            ...(envRecipients.production ? { recipients: envRecipients.production } : {}),
          },
        ],
        namespaces: [{ name: "database", description: "Database" }],
        sops: {
          default_backend: "age",
          age: {
            recipients: globalRecipients,
          },
        },
        file_pattern: "{namespace}/{environment}.enc.yaml",
      });
    }

    describe("list with environment", () => {
      it("returns per-env recipients when environment specified", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        mockReadFileSync.mockReturnValue(
          makeManifestYamlWithEnvRecipients([], {
            production: [{ key: validKey1, label: "Prod Key" }],
          }),
        );

        const result = await manager.list(manifest, repoRoot, "production");
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe(validKey1);
        expect(result[0].label).toBe("Prod Key");
      });

      it("returns empty array when environment has no recipients", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        mockReadFileSync.mockReturnValue(makeManifestYamlWithEnvRecipients([validKey1]));

        const result = await manager.list(manifest, repoRoot, "staging");
        expect(result).toEqual([]);
      });

      it("throws when environment does not exist", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        await expect(manager.list(manifest, repoRoot, "nonexistent")).rejects.toThrow(
          "not found in manifest",
        );
      });
    });

    describe("add with environment", () => {
      it("adds recipient to environment's recipients array", async () => {
        const encryption = makeEncryption();
        const existingFiles = ["/repo/database/production.enc.yaml"];
        const mm = makeMatrixManager(existingFiles);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        let readCallCount = 0;
        mockReadFileSync.mockImplementation(() => {
          readCallCount++;
          if (readCallCount <= 2) {
            return makeManifestYamlWithEnvRecipients([]);
          }
          if (readCallCount <= 3) {
            return "encrypted-file-content";
          }
          return makeManifestYamlWithEnvRecipients([], {
            production: [validKey1],
          });
        });

        const result = await manager.add(validKey1, undefined, manifest, repoRoot, "production");

        expect(result.added!.key).toBe(validKey1);
        // Only production file should be re-encrypted
        expect(result.reEncryptedFiles).toHaveLength(1);
        expect(result.reEncryptedFiles[0]).toContain("production");
        expect(encryption.addRecipient).toHaveBeenCalledTimes(1);
      });

      it("only re-encrypts files for the target environment", async () => {
        const encryption = makeEncryption();
        const existingFiles = [
          "/repo/database/staging.enc.yaml",
          "/repo/database/production.enc.yaml",
        ];
        const mm = makeMatrixManager(existingFiles);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        let readCallCount = 0;
        mockReadFileSync.mockImplementation(() => {
          readCallCount++;
          if (readCallCount <= 2) {
            return makeManifestYamlWithEnvRecipients([]);
          }
          if (readCallCount <= 3) {
            return "encrypted-file-content";
          }
          return makeManifestYamlWithEnvRecipients([], {
            staging: [validKey1],
          });
        });

        const result = await manager.add(validKey1, undefined, manifest, repoRoot, "staging");

        // Only staging file should be re-encrypted, not production
        expect(result.reEncryptedFiles).toHaveLength(1);
        expect(result.reEncryptedFiles[0]).toContain("staging");
      });

      it("throws when environment does not exist in manifest", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        await expect(
          manager.add(validKey1, undefined, manifest, repoRoot, "nonexistent"),
        ).rejects.toThrow("not found in manifest");
      });
    });

    describe("remove with environment", () => {
      it("removes recipient from environment's recipients array", async () => {
        const encryption = makeEncryption();
        const existingFiles = ["/repo/database/production.enc.yaml"];
        const mm = makeMatrixManager(existingFiles);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        let readCallCount = 0;
        mockReadFileSync.mockImplementation(() => {
          readCallCount++;
          if (readCallCount <= 2) {
            return makeManifestYamlWithEnvRecipients([], {
              production: [validKey1],
            });
          }
          if (readCallCount <= 3) {
            return "encrypted-file-content";
          }
          return makeManifestYamlWithEnvRecipients([], {
            production: [],
          });
        });

        const result = await manager.remove(validKey1, manifest, repoRoot, "production");

        expect(result.removed!.key).toBe(validKey1);
        expect(result.reEncryptedFiles).toHaveLength(1);
        expect(result.reEncryptedFiles[0]).toContain("production");
      });

      it("only re-encrypts files for the target environment", async () => {
        const encryption = makeEncryption();
        const existingFiles = [
          "/repo/database/staging.enc.yaml",
          "/repo/database/production.enc.yaml",
        ];
        const mm = makeMatrixManager(existingFiles);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        let readCallCount = 0;
        mockReadFileSync.mockImplementation(() => {
          readCallCount++;
          if (readCallCount <= 2) {
            return makeManifestYamlWithEnvRecipients([], {
              production: [validKey1],
            });
          }
          if (readCallCount <= 3) {
            return "encrypted-file-content";
          }
          return makeManifestYamlWithEnvRecipients([], {
            production: [],
          });
        });

        const result = await manager.remove(validKey1, manifest, repoRoot, "production");

        expect(encryption.removeRecipient).toHaveBeenCalledTimes(1);
        expect(result.reEncryptedFiles).toHaveLength(1);
        expect(result.reEncryptedFiles[0]).toContain("production");
      });

      it("throws when environment does not exist", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any, makeStubTx());

        await expect(manager.remove(validKey1, manifest, repoRoot, "nonexistent")).rejects.toThrow(
          "not found in manifest",
        );
      });
    });
  });
});
