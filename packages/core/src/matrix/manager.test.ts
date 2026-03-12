import * as fs from "fs";
import { MatrixManager } from "./manager";
import { ClefManifest } from "../types";
import { SopsClient } from "../sops/client";

jest.mock("fs");
jest.mock("../pending/metadata", () => ({
  getPendingKeys: jest.fn().mockResolvedValue([]),
  metadataPath: jest
    .fn()
    .mockImplementation((p: string) => p.replace(".enc.yaml", ".clef-meta.yaml")),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

function testManifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "staging", description: "Staging" },
      { name: "production", description: "Production", protected: true },
    ],
    namespaces: [
      { name: "database", description: "DB config" },
      { name: "auth", description: "Auth secrets" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

describe("MatrixManager", () => {
  let manager: MatrixManager;

  beforeEach(() => {
    manager = new MatrixManager();
    jest.clearAllMocks();
  });

  describe("resolveMatrix", () => {
    it("should produce N×M cells for all namespaces × environments", () => {
      mockFs.existsSync.mockReturnValue(true);

      const cells = manager.resolveMatrix(testManifest(), "/repo");

      // 2 namespaces × 3 environments = 6 cells
      expect(cells).toHaveLength(6);
    });

    it("should produce correct file paths from the pattern", () => {
      mockFs.existsSync.mockReturnValue(true);

      const cells = manager.resolveMatrix(testManifest(), "/repo");

      expect(cells[0]).toEqual({
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: true,
      });
      expect(cells[1]).toEqual({
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: true,
      });
      expect(cells[5]).toEqual({
        namespace: "auth",
        environment: "production",
        filePath: "/repo/auth/production.enc.yaml",
        exists: true,
      });
    });

    it("should mark cells as not existing when files are missing", () => {
      mockFs.existsSync.mockReturnValue(false);

      const cells = manager.resolveMatrix(testManifest(), "/repo");
      expect(cells.every((c) => !c.exists)).toBe(true);
    });

    it("should handle mixed existence state", () => {
      mockFs.existsSync.mockImplementation((p) => {
        return String(p).includes("dev");
      });

      const cells = manager.resolveMatrix(testManifest(), "/repo");
      const devCells = cells.filter((c) => c.environment === "dev");
      const otherCells = cells.filter((c) => c.environment !== "dev");

      expect(devCells.every((c) => c.exists)).toBe(true);
      expect(otherCells.every((c) => !c.exists)).toBe(true);
    });

    it("should handle custom file patterns", () => {
      mockFs.existsSync.mockReturnValue(true);
      const manifest = {
        ...testManifest(),
        file_pattern: "secrets/{namespace}/{environment}.enc.json",
      };

      const cells = manager.resolveMatrix(manifest, "/repo");
      expect(cells[0].filePath).toBe("/repo/secrets/database/dev.enc.json");
    });
  });

  describe("detectMissingCells", () => {
    it("should return only cells where files do not exist", () => {
      mockFs.existsSync.mockImplementation((p) => {
        return String(p).includes("dev");
      });

      const missing = manager.detectMissingCells(testManifest(), "/repo");
      expect(missing).toHaveLength(4); // 2 staging + 2 production
      expect(missing.every((c) => !c.exists)).toBe(true);
    });

    it("should return empty array when all files exist", () => {
      mockFs.existsSync.mockReturnValue(true);

      const missing = manager.detectMissingCells(testManifest(), "/repo");
      expect(missing).toHaveLength(0);
    });

    it("should return all cells when no files exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const missing = manager.detectMissingCells(testManifest(), "/repo");
      expect(missing).toHaveLength(6);
    });
  });

  describe("scaffoldCell", () => {
    it("should create directory and call sopsClient.encrypt with manifest and environment", async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockSopsClient = {
        encrypt: jest.fn().mockResolvedValue(undefined),
      } as unknown as SopsClient;

      const cell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      };

      const manifest = testManifest();
      await manager.scaffoldCell(cell, mockSopsClient, manifest);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/repo/database", { recursive: true });
      expect(mockSopsClient.encrypt).toHaveBeenCalledWith(
        "/repo/database/dev.enc.yaml",
        {},
        manifest,
        "dev",
      );
    });

    it("should not create directory if it already exists", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const mockSopsClient = {
        encrypt: jest.fn().mockResolvedValue(undefined),
      } as unknown as SopsClient;

      const cell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      };

      await manager.scaffoldCell(cell, mockSopsClient, testManifest());

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it("should pass per-env backend via environment param to encrypt", async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockReturnValue(undefined);

      const mockSopsClient = {
        encrypt: jest.fn().mockResolvedValue(undefined),
      } as unknown as SopsClient;

      const manifest: ClefManifest = {
        ...testManifest(),
        environments: [
          {
            name: "production",
            description: "Production",
            sops: {
              backend: "awskms",
              aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc",
            },
          },
        ],
      };

      const cell = {
        namespace: "database",
        environment: "production",
        filePath: "/repo/database/production.enc.yaml",
        exists: false,
      };

      await manager.scaffoldCell(cell, mockSopsClient, manifest);

      expect(mockSopsClient.encrypt).toHaveBeenCalledWith(
        "/repo/database/production.enc.yaml",
        {},
        manifest,
        "production",
      );
    });
  });

  describe("getMatrixStatus", () => {
    it("should report missing cells as issues", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const mockSopsClient = {} as SopsClient;
      const statuses = await manager.getMatrixStatus(testManifest(), "/repo", mockSopsClient);

      expect(statuses).toHaveLength(6);
      expect(statuses.every((s) => s.issues.length > 0)).toBe(true);
      expect(statuses.every((s) => s.keyCount === 0)).toBe(true);
      expect(statuses.every((s) => s.lastModified === null)).toBe(true);
    });

    it("should report key counts and detect missing keys across siblings", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const mockSopsClient = {
        decrypt: jest.fn().mockImplementation(async (filePath: string) => {
          if (filePath.includes("dev")) {
            return {
              values: { DB_URL: "dev-url", DB_POOL: "5", EXTRA_KEY: "val" },
              metadata: {
                backend: "age" as const,
                recipients: ["age1test"],
                lastModified: new Date("2024-01-15"),
              },
            };
          }
          return {
            values: { DB_URL: "staging-url", DB_POOL: "10" },
            metadata: {
              backend: "age" as const,
              recipients: ["age1test"],
              lastModified: new Date("2024-01-14"),
            },
          };
        }),
      } as unknown as SopsClient;

      // Use a manifest with just one namespace so we can isolate
      const manifest = {
        ...testManifest(),
        namespaces: [{ name: "database", description: "DB" }],
        environments: [
          { name: "dev", description: "Dev" },
          { name: "staging", description: "Staging" },
        ],
      };

      const statuses = await manager.getMatrixStatus(manifest, "/repo", mockSopsClient);

      expect(statuses).toHaveLength(2);

      // Dev has 3 keys
      expect(statuses[0].keyCount).toBe(3);

      // Staging should report EXTRA_KEY as missing
      const stagingIssues = statuses[1].issues;
      expect(stagingIssues.some((i) => i.key === "EXTRA_KEY")).toBe(true);
    });

    it("should handle decrypt errors gracefully", async () => {
      mockFs.existsSync.mockReturnValue(true);

      const mockSopsClient = {
        decrypt: jest.fn().mockRejectedValue(new Error("Key not found")),
      } as unknown as SopsClient;

      const manifest = {
        ...testManifest(),
        namespaces: [{ name: "database", description: "DB" }],
        environments: [{ name: "dev", description: "Dev" }],
      };

      const statuses = await manager.getMatrixStatus(manifest, "/repo", mockSopsClient);

      expect(statuses).toHaveLength(1);
      expect(statuses[0].issues).toHaveLength(1);
      expect(statuses[0].issues[0].type).toBe("sops_error");
    });
  });

  describe("isProtectedEnvironment", () => {
    it("should return true for protected environments", () => {
      expect(manager.isProtectedEnvironment(testManifest(), "production")).toBe(true);
    });

    it("should return false for non-protected environments", () => {
      expect(manager.isProtectedEnvironment(testManifest(), "dev")).toBe(false);
      expect(manager.isProtectedEnvironment(testManifest(), "staging")).toBe(false);
    });

    it("should return false for unknown environments", () => {
      expect(manager.isProtectedEnvironment(testManifest(), "unknown")).toBe(false);
    });
  });
});
