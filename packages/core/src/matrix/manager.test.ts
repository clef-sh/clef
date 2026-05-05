import * as fs from "fs";
import { MatrixManager } from "./manager";
import { ClefManifest } from "../types";

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

  // scaffoldCell was removed in Phase 7 — consumers go through
  // source.scaffoldCell on the composed source. The cell-create + initial
  // encrypt is covered by ComposedSecretSource's scaffoldCell tests.

  describe("getMatrixStatus", () => {
    it("should report missing cells as issues", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const statuses = await manager.getMatrixStatus(testManifest(), "/repo");

      expect(statuses).toHaveLength(6);
      expect(statuses.every((s) => s.issues.length > 0)).toBe(true);
      expect(statuses.every((s) => s.keyCount === 0)).toBe(true);
      expect(statuses.every((s) => s.lastModified === null)).toBe(true);
    });

    it("should report key counts and detect missing keys across siblings", async () => {
      mockFs.existsSync.mockReturnValue(true);
      // SOPS files store key names in plaintext — mock the file content
      mockFs.readFileSync.mockImplementation((filePath) => {
        const p = String(filePath);
        if (p.includes("dev")) {
          return "DB_URL: ENC[...]\nDB_POOL: ENC[...]\nEXTRA_KEY: ENC[...]\nsops:\n  lastmodified: '2024-01-15T00:00:00Z'\n";
        }
        return "DB_URL: ENC[...]\nDB_POOL: ENC[...]\nsops:\n  lastmodified: '2024-01-14T00:00:00Z'\n";
      });

      const manifest = {
        ...testManifest(),
        namespaces: [{ name: "database", description: "DB" }],
        environments: [
          { name: "dev", description: "Dev" },
          { name: "staging", description: "Staging" },
        ],
      };

      const statuses = await manager.getMatrixStatus(manifest, "/repo");

      expect(statuses).toHaveLength(2);

      // Dev has 3 keys (excluding sops metadata key)
      expect(statuses[0].keyCount).toBe(3);

      // Staging should report EXTRA_KEY as missing
      const stagingIssues = statuses[1].issues;
      expect(stagingIssues.some((i) => i.key === "EXTRA_KEY")).toBe(true);
    });

    it("should handle unreadable files gracefully", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("permission denied");
      });

      const manifest = {
        ...testManifest(),
        namespaces: [{ name: "database", description: "DB" }],
        environments: [{ name: "dev", description: "Dev" }],
      };

      const statuses = await manager.getMatrixStatus(manifest, "/repo");

      expect(statuses).toHaveLength(1);
      expect(statuses[0].keyCount).toBe(0);
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
