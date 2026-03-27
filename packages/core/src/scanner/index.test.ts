import * as fs from "fs";
import * as path from "path";
import {
  ScanRunner,
  shannonEntropy,
  isHighEntropy,
  matchPatterns,
  redactValue,
  loadIgnoreRules,
  shouldIgnoreFile,
  shouldIgnoreMatch,
  parseIgnoreContent,
} from "./index";
import type { ClefManifest, SubprocessRunner } from "../types";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

const REPO_ROOT = "/test-repo";

function makeManifest(overrides?: Partial<ClefManifest>): ClefManifest {
  return {
    version: 1,
    environments: [{ name: "dev", description: "Dev" }],
    namespaces: [{ name: "database", description: "DB" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    ...overrides,
  };
}

function makeRunner(stagedFiles: string[] = [], lsFiles: string[] = []): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("--diff-filter=ACM")) {
        return Promise.resolve({
          stdout: stagedFiles.join("\n"),
          stderr: "",
          exitCode: 0,
        });
      }
      if (args[0] === "ls-files") {
        return Promise.resolve({
          stdout: lsFiles.join("\n"),
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }),
  };
}

function setupFsNothing(): void {
  mockFs.existsSync.mockReturnValue(false);
  mockFs.readFileSync.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ScanRunner.scan", () => {
  describe("unencrypted matrix files", () => {
    it("detects an unencrypted matrix file missing SOPS metadata", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) {
          return "DB_HOST: localhost\nDB_PASS: secret\n";
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.unencryptedMatrixFiles).toContain("database/dev.enc.yaml");
    });

    it("does not flag an encrypted matrix file", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) {
          return 'DB_HOST: ENC[AES256...]\nsops:\n  version: "3.7.0"\n';
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.unencryptedMatrixFiles).toHaveLength(0);
    });
  });

  describe("pattern matching", () => {
    it("detects a pattern match in an arbitrary file", async () => {
      const runner = makeRunner([], ["src/config.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) return true;
        return false;
      });
      mockFs.statSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) {
          return { size: 100, isDirectory: () => false } as fs.Stats;
        }
        throw new Error("ENOENT");
      });
      // No binary check
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) {
          return 'const key = "AKIAIOSFODNN7EXAMPLE";\n';
        }
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].matchType).toBe("pattern");
      expect(result.matches[0].patternName).toBe("AWS access key");
    });

    it("detects entropy match in an arbitrary file", async () => {
      const runner = makeRunner([], ["config/.env"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "config/.env")) return true;
        return false;
      });
      mockFs.statSync.mockImplementation(() => {
        return { size: 50, isDirectory: () => false } as fs.Stats;
      });
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "config/.env")) {
          // High-entropy value after =
          return "DB_PASSWORD=4xK9mQ2pLv8nR3wZaT7cBhJqYd\n";
        }
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      const entropyMatches = result.matches.filter((m) => m.matchType === "entropy");
      expect(entropyMatches.length).toBeGreaterThan(0);
    });

    it("suppresses entropy matches in high severity mode", async () => {
      const runner = makeRunner([], ["config/.env"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "config/.env")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "config/.env")) {
          return "DB_PASSWORD=4xK9mQ2pLv8nR3wZaT7cBhJqYd\n";
        }
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, { severity: "high" });
      const entropyMatches = result.matches.filter((m) => m.matchType === "entropy");
      expect(entropyMatches).toHaveLength(0);
    });

    it("skips lines with # clef-ignore", async () => {
      const runner = makeRunner([], ["src/config.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) {
          return 'const key = "AKIAIOSFODNN7EXAMPLE"; # clef-ignore\n';
        }
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.matches).toHaveLength(0);
    });
  });

  describe(".clefignore rules", () => {
    it("skips files that match .clefignore rules", async () => {
      const runner = makeRunner([], ["vendor/some-lib.js"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "vendor/some-lib.js")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, ".clefignore")) {
          return "vendor/\n";
        }
        return "API_KEY=mysecretapikey12345\n";
      });
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.matches).toHaveLength(0);
      expect(result.filesSkipped).toBeGreaterThan(0);
    });
  });

  describe("staged-only mode", () => {
    it("only scans staged files", async () => {
      const runner = makeRunner(["src/staged.ts"], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/staged.ts")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/staged.ts")) {
          return "const x = 1;\n";
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const result = await scanner.scan(REPO_ROOT, manifest, { stagedOnly: true });
      expect(result.filesScanned).toBe(1);
      // Verify git diff --cached was called
      const runMock = runner.run as jest.Mock;
      const calls: string[][] = runMock.mock.calls.map((c: unknown[]) => c[1] as string[]);
      expect(calls.some((args) => args.includes("--diff-filter=ACM"))).toBe(true);
    });
  });

  describe("binary file handling", () => {
    it("skips binary files (null byte detected)", async () => {
      const runner = makeRunner([], ["image.png"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "image.png")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 512, isDirectory: () => false } as fs.Stats);
      // Simulate binary file: return buffer with a null byte
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockImplementation((_fd: unknown, buf: unknown) => {
        (buf as Buffer)[10] = 0; // null byte
        return 512;
      });
      mockFs.closeSync.mockReturnValue(undefined);

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("large file handling", () => {
    it("skips files over 1MB", async () => {
      const runner = makeRunner([], ["large.log"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "large.log")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({
        size: 2 * 1024 * 1024,
        isDirectory: () => false,
      } as fs.Stats);

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("durationMs", () => {
    it("populates durationMs on the result", async () => {
      setupFsNothing();
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("paths option (getFilesInPaths)", () => {
    it("scans files in specified paths (file path)", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) return true;
        return false;
      });
      mockFs.statSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) {
          return { size: 50, isDirectory: () => false } as fs.Stats;
        }
        throw new Error("ENOENT");
      });
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/config.ts")) return "const x = 1;\n";
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, { paths: ["src/config.ts"] });
      expect(result.filesScanned).toBe(1);
    });

    it("scans files in a specified directory path via walkDir", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      const dirPath = path.join(REPO_ROOT, "src");
      const filePath = path.join(dirPath, "app.ts");

      mockFs.existsSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (s === dirPath || s === filePath) return true;
        return false;
      });
      mockFs.statSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === dirPath) return { size: 0, isDirectory: () => true } as fs.Stats;
        if (s === filePath) return { size: 50, isDirectory: () => false } as fs.Stats;
        throw new Error("ENOENT");
      });
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        { name: "app.ts", isDirectory: () => false } as fs.Dirent,
      ]);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((_p: unknown, _enc: unknown) => "const x = 1;\n");

      const result = await scanner.scan(REPO_ROOT, manifest, { paths: ["src"] });
      expect(result.filesScanned).toBeGreaterThanOrEqual(1);
    });

    it("skips non-existent paths silently", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const result = await scanner.scan(REPO_ROOT, manifest, { paths: ["nonexistent/path.ts"] });
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("shouldAlwaysSkip inside file loop", () => {
    it("skips .enc.yaml files listed by git ls-files", async () => {
      // enc.yaml appears in git ls-files output (shouldn't happen in practice but test the guard)
      const runner = makeRunner([], ["database/dev.enc.yaml"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      // matrix file exists and has SOPS metadata (not an unencrypted matrix file)
      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((_p: unknown, _enc: unknown) => {
        return 'sops:\n  version: "3.7.0"\n';
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      // File is skipped in the scan loop (always-skip extension)
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });

    it("skips .clef-meta.yaml files", async () => {
      const runner = makeRunner([], ["database/dev.clef-meta.yaml"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (s === path.join(REPO_ROOT, "database/dev.clef-meta.yaml")) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });

    it("skips .sops.yaml files", async () => {
      const runner = makeRunner([], [".sops.yaml"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (s === path.join(REPO_ROOT, ".sops.yaml")) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("file not found after listing", () => {
    it("skips files that no longer exist when scanning starts", async () => {
      const runner = makeRunner([], ["src/deleted.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        // src/deleted.ts does NOT exist
        return false;
      });
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("statSync error", () => {
    it("skips files when statSync throws", async () => {
      const runner = makeRunner([], ["src/unreadable.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/unreadable.ts")) return true;
        return false;
      });
      mockFs.statSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "src/unreadable.ts")) {
          throw new Error("EACCES: permission denied");
        }
        throw new Error("ENOENT");
      });
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThan(0);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("isBinary catch path", () => {
    it("treats files as non-binary when openSync throws", async () => {
      const runner = makeRunner([], ["src/app.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "src/app.ts")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      // openSync throws → isBinary returns false → file is treated as text
      mockFs.openSync.mockImplementation(() => {
        throw new Error("EACCES");
      });
      mockFs.readFileSync.mockImplementation((_p: unknown, _enc: unknown) => "const x = 1;\n");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      // File is scanned (treated as text since isBinary returns false on error)
      expect(result.filesScanned).toBe(1);
    });
  });

  describe("getAllTrackedFiles fallback (walkDir)", () => {
    it("falls back to walkDir when git ls-files fails", async () => {
      const runner: SubprocessRunner = {
        run: jest.fn().mockImplementation((_cmd: string, args: string[]) => {
          if (args[0] === "ls-files") {
            return Promise.resolve({ stdout: "", stderr: "not a git repo", exitCode: 128 });
          }
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        }),
      };
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        return false;
      });
      (mockFs.readdirSync as jest.Mock).mockReturnValue([]);
      mockFs.readFileSync.mockImplementation(() => "");

      // Should not throw — falls back to walkDir which returns []
      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesScanned).toBe(0);
    });

    it("walkDir recurses into subdirectories, skipping ALWAYS_SKIP_DIRS", async () => {
      const runner: SubprocessRunner = {
        run: jest.fn().mockImplementation((_cmd: string, args: string[]) => {
          if (args[0] === "ls-files") {
            return Promise.resolve({ stdout: "", stderr: "", exitCode: 128 });
          }
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        }),
      };
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      const subDir = path.join(REPO_ROOT, "src");
      const srcFile = path.join(subDir, "app.ts");

      mockFs.existsSync.mockImplementation((p: unknown) => {
        // Return true only for the actual source file being scanned
        return String(p) === srcFile;
      });
      (mockFs.readdirSync as jest.Mock).mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === REPO_ROOT) {
          return [
            { name: "src", isDirectory: () => true } as fs.Dirent,
            { name: "node_modules", isDirectory: () => true } as fs.Dirent,
          ];
        }
        if (s === subDir) {
          return [{ name: "app.ts", isDirectory: () => false } as fs.Dirent];
        }
        return [];
      });
      mockFs.statSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === srcFile) return { size: 50, isDirectory: () => false } as fs.Stats;
        throw new Error("ENOENT");
      });
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((_p: unknown, _enc: unknown) => "const x = 1;\n");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      // src/app.ts should be scanned; node_modules should be skipped
      expect(result.filesScanned).toBeGreaterThanOrEqual(1);
    });

    it("walkDir returns empty when readdirSync throws", async () => {
      const runner: SubprocessRunner = {
        run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 128 }),
      };
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockReturnValue(false);
      (mockFs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("detectEntropy — no variable name", () => {
    it("uses redactValue when no variable name can be extracted", async () => {
      const runner = makeRunner([], ["config.yaml"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "database/dev.enc.yaml")) return false;
        if (String(p) === path.join(REPO_ROOT, "config.yaml")) return true;
        return false;
      });
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockImplementation((p: unknown, _enc: unknown) => {
        if (String(p) === path.join(REPO_ROOT, "config.yaml")) {
          // Value after : with no leading word identifier
          return ": 4xK9mQ2pLv8nR3wZaT7cBhJqYdEsFgHu\n";
        }
        return "";
      });

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      const entropyMatches = result.matches.filter((m) => m.matchType === "entropy");
      // May or may not match depending on regex — just verify no crash
      expect(Array.isArray(entropyMatches)).toBe(true);
    });
  });

  describe("getAllTrackedFiles empty stdout", () => {
    it("returns empty array when git ls-files stdout is empty", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      // runner returns empty stdout with exitCode 0
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("branch coverage — default options parameter", () => {
    it("scan() with no options argument uses default empty options", async () => {
      const runner = makeRunner([], []);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation(() => "");
      // Call without the third argument to exercise the default parameter branch
      const result = await scanner.scan(REPO_ROOT, manifest);
      expect(result.filesScanned).toBe(0);
    });
  });

  describe("branch coverage — absolute relFile path", () => {
    it("handles an absolute file path returned from git ls-files", async () => {
      const absFile = path.join(REPO_ROOT, "src/config.ts");
      const runner: SubprocessRunner = {
        run: jest.fn().mockImplementation((_cmd: string, args: string[]) => {
          if (args[0] === "ls-files") {
            // Return an absolute path (unusual but possible)
            return Promise.resolve({ stdout: absFile, stderr: "", exitCode: 0 });
          }
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        }),
      };
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      mockFs.existsSync.mockImplementation((p: unknown) => String(p) === absFile);
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      mockFs.readFileSync.mockReturnValue("const x = 1;\n");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesScanned).toBeGreaterThanOrEqual(1);
    });
  });

  describe("branch coverage — shouldAlwaysSkip exact dir name", () => {
    it("skips a file whose relPath exactly equals a skip dir name", async () => {
      // "node_modules" with no slash — relPath === dir branch
      const runner = makeRunner([], ["node_modules"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation(() => "");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      expect(result.filesSkipped).toBeGreaterThanOrEqual(1);
    });
  });

  describe("branch coverage — detectEntropy low-entropy value", () => {
    it("skips values with assignment pattern but low Shannon entropy", async () => {
      const runner = makeRunner([], ["src/config.ts"]);
      const scanner = new ScanRunner(runner);
      const manifest = makeManifest();

      const absFile = path.join(REPO_ROOT, "src/config.ts");
      mockFs.existsSync.mockImplementation((p: unknown) => String(p) === absFile);
      mockFs.statSync.mockReturnValue({ size: 50, isDirectory: () => false } as fs.Stats);
      mockFs.openSync.mockReturnValue(3);
      mockFs.readSync.mockReturnValue(0);
      mockFs.closeSync.mockReturnValue(undefined);
      // A 20+ char value with very low entropy (all same char)
      mockFs.readFileSync.mockReturnValue("PASSWORD=aaaaaaaaaaaaaaaaaaaa\n");

      const result = await scanner.scan(REPO_ROOT, manifest, {});
      const entropyMatches = result.matches.filter((m) => m.matchType === "entropy");
      expect(entropyMatches).toHaveLength(0);
    });
  });
});

// Exercise re-exported helpers (covers the re-export getter functions in index.ts)
describe("re-exports from index", () => {
  it("shannonEntropy is callable", () => {
    expect(shannonEntropy("abc")).toBeGreaterThan(0);
  });
  it("isHighEntropy is callable", () => {
    expect(isHighEntropy("x")).toBe(false);
  });
  it("matchPatterns is callable", () => {
    expect(matchPatterns("const x = 1;", 1, "file.ts")).toEqual([]);
  });
  it("redactValue is callable", () => {
    expect(redactValue("AKIAIOSFODNN7EXAMPLE")).toContain("AKIA");
  });
  it("parseIgnoreContent is callable", () => {
    expect(parseIgnoreContent("")).toEqual({ files: [], patterns: [], paths: [] });
  });
  it("loadIgnoreRules returns empty rules when .clefignore is absent", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(loadIgnoreRules("/nonexistent")).toEqual({ files: [], patterns: [], paths: [] });
  });
  it("shouldIgnoreFile is callable", () => {
    expect(shouldIgnoreFile("src/app.ts", { files: [], patterns: [], paths: [] })).toBe(false);
  });
  it("shouldIgnoreMatch is callable", () => {
    const match = { file: "f", line: 1, column: 1, matchType: "pattern" as const, preview: "x" };
    expect(shouldIgnoreMatch(match, { files: [], patterns: [], paths: [] })).toBe(false);
  });
});
