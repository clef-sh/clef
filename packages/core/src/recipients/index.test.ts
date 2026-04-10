import * as fs from "fs";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { RecipientManager } from "./index";
import { ClefManifest, EncryptionBackend } from "../types";

jest.mock("fs");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

      await expect(manager.add("not-a-valid-key", undefined, manifest, repoRoot)).rejects.toThrow(
        "must start with 'age1'",
      );
    });

    it("rejects duplicate key", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      await manager.add(validKey1, "Alice", manifest, repoRoot);

      const writeCall = mockWriteFileAtomicSync.mock.calls[0];
      const writtenYaml = YAML.parse(writeCall[1] as string) as Record<string, unknown>;
      const sops = writtenYaml.sops as Record<string, unknown>;
      const age = sops.age as Record<string, unknown>;
      const recipients = age.recipients as Array<Record<string, string>>;
      expect(recipients[0]).toEqual({ key: validKey1, label: "Alice" });
    });

    it("rolls back on re-encryption failure", async () => {
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
      const manager = new RecipientManager(encryption, mm as any);

      const originalManifest = makeManifestYaml([]);
      const encryptedContent1 = "original-encrypted-staging";
      const encryptedContent2 = "original-encrypted-production";

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        // Call 1: initial manifest read for add checks
        if (readCallCount === 1) return originalManifest;
        // Call 2: manifest backup
        if (readCallCount === 2) return originalManifest;
        // Call 3: file backup for staging (first file)
        if (readCallCount === 3) return encryptedContent1;
        // Call 4: file backup for production (second file)
        if (readCallCount === 4) return encryptedContent2;
        // Call 5: restored manifest read for result
        return originalManifest;
      });

      const result = await manager.add(validKey1, undefined, manifest, repoRoot);

      expect(result.failedFiles).toContain("/repo/database/production.enc.yaml");
      expect(result.reEncryptedFiles).toHaveLength(0);
      expect(result.warnings).toContain(
        "Rollback completed: manifest and re-encrypted files have been restored.",
      );

      // Verify manifest was restored (via write-file-atomic for both
      // the initial mutation and the rollback restore).
      const manifestWriteCalls = mockWriteFileAtomicSync.mock.calls.filter((call) => {
        const p = call[0] as string;
        return p.endsWith("clef.yaml");
      });
      // Last write should be the rollback (with the original raw manifest contents)
      const lastManifestWrite = manifestWriteCalls[manifestWriteCalls.length - 1];
      expect(lastManifestWrite[1]).toBe(originalManifest);

      // Verify staging file was restored (it was re-encrypted before the failure).
      // The rollback path uses fs.writeFileSync to restore file backups verbatim.
      const stagingWriteCalls = mockWriteFileSync.mock.calls.filter(
        (call) => call[0] === "/repo/database/staging.enc.yaml",
      );
      expect(stagingWriteCalls).toHaveLength(1);
      expect(stagingWriteCalls[0][1]).toBe(encryptedContent1);
    });

    it("trims key whitespace before validation", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any);

      mockReadFileSync.mockImplementation(() => makeManifestYaml([]));

      const result = await manager.add(`  ${validKey1}  `, undefined, manifest, repoRoot);

      expect(result.added!.key).toBe(validKey1);
    });

    it("creates sops.age.recipients structure when missing", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any);

      mockReadFileSync.mockImplementation(() =>
        YAML.stringify({
          version: 1,
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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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

    it("rolls back on re-encryption failure", async () => {
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
      const manager = new RecipientManager(encryption, mm as any);

      const originalManifest = makeManifestYaml([validKey1, validKey2]);
      const encryptedContent1 = "original-encrypted-staging";
      const encryptedContent2 = "original-encrypted-production";

      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount === 1) return originalManifest;
        if (readCallCount === 2) return originalManifest;
        if (readCallCount === 3) return encryptedContent1;
        if (readCallCount === 4) return encryptedContent2;
        return originalManifest;
      });

      const result = await manager.remove(validKey1, manifest, repoRoot);

      expect(result.failedFiles).toContain("/repo/database/production.enc.yaml");
      expect(result.reEncryptedFiles).toHaveLength(0);
      expect(result.warnings).toContain(
        "Rollback completed: manifest and re-encrypted files have been restored.",
      );
      expect(result.warnings).toContain(
        "Re-encryption removes future access, not past access. Rotate secret values to complete revocation.",
      );

      // Verify manifest was restored (via write-file-atomic)
      const manifestWriteCalls = mockWriteFileAtomicSync.mock.calls.filter((call) => {
        const p = call[0] as string;
        return p.endsWith("clef.yaml");
      });
      const lastManifestWrite = manifestWriteCalls[manifestWriteCalls.length - 1];
      expect(lastManifestWrite[1]).toBe(originalManifest);

      // Verify staging file was restored (via fs.writeFileSync from rollback path)
      const stagingWriteCalls = mockWriteFileSync.mock.calls.filter(
        (call) => call[0] === "/repo/database/staging.enc.yaml",
      );
      expect(stagingWriteCalls).toHaveLength(1);
      expect(stagingWriteCalls[0][1]).toBe(encryptedContent1);
    });

    it("rotation warning is always present even on success", async () => {
      const encryption = makeEncryption();
      const mm = makeMatrixManager([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
      const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

        mockReadFileSync.mockReturnValue(makeManifestYamlWithEnvRecipients([validKey1]));

        const result = await manager.list(manifest, repoRoot, "staging");
        expect(result).toEqual([]);
      });

      it("throws when environment does not exist", async () => {
        const encryption = makeEncryption();
        const mm = makeMatrixManager();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

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
        const manager = new RecipientManager(encryption, mm as any);

        await expect(manager.remove(validKey1, manifest, repoRoot, "nonexistent")).rejects.toThrow(
          "not found in manifest",
        );
      });
    });
  });
});
