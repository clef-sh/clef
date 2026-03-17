import * as fs from "fs";
import * as YAML from "yaml";
import { DriftDetector } from "./detector";
import { ClefManifest } from "../types";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

function makeManifest(overrides?: Partial<ClefManifest>): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "staging", description: "Staging" },
      { name: "production", description: "Production" },
    ],
    namespaces: [
      { name: "database", description: "DB secrets" },
      { name: "auth", description: "Auth secrets" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "secrets/{namespace}/{environment}.enc.yaml",
    ...overrides,
  };
}

function setupManifests(
  localManifest: ClefManifest,
  remoteManifest: ClefManifest,
  files: Record<string, Record<string, string>>,
): void {
  mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
    const p = String(filePath);
    if (p.endsWith("clef.yaml")) {
      if (p.startsWith("/local")) {
        return YAML.stringify(localManifest);
      }
      if (p.startsWith("/remote")) {
        return YAML.stringify(remoteManifest);
      }
    }
    if (files[p]) {
      return YAML.stringify({ ...files[p], sops: { version: "3.9" } });
    }
    throw new Error(`ENOENT: ${p}`);
  });

  mockFs.existsSync.mockImplementation((filePath: fs.PathLike) => {
    const p = String(filePath);
    if (p.endsWith("clef.yaml")) return true;
    return p in files;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DriftDetector", () => {
  describe("no drift — keys match across all environments", () => {
    it("returns zero issues when keys are identical", () => {
      const manifest = makeManifest();
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/local/secrets/database/staging.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/local/secrets/database/production.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/local/secrets/auth/dev.enc.yaml": { AUTH_KEY: "enc" },
        "/local/secrets/auth/staging.enc.yaml": { AUTH_KEY: "enc" },
        "/local/secrets/auth/production.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/database/dev.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/remote/secrets/database/staging.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/remote/secrets/database/production.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/remote/secrets/auth/dev.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/auth/staging.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/auth/production.enc.yaml": { AUTH_KEY: "enc" },
      };
      setupManifests(manifest, manifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.issues).toHaveLength(0);
      expect(result.namespacesCompared).toBe(2);
      expect(result.namespacesClean).toBe(2);
    });
  });

  describe("key in remote but missing in local", () => {
    it("reports drift when remote has a key that local environments lack", () => {
      const localManifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
      });
      const remoteManifest = makeManifest({
        environments: [{ name: "production", description: "Prod" }],
        namespaces: [{ name: "database", description: "DB" }],
      });
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/database/production.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
      };
      setupManifests(localManifest, remoteManifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].namespace).toBe("database");
      expect(result.issues[0].key).toBe("DB_PASS");
      expect(result.issues[0].missingFrom).toContain("dev");
      expect(result.issues[0].presentIn).toContain("production");
    });
  });

  describe("key in local but missing in remote", () => {
    it("reports drift for the key missing from remote environments", () => {
      const localManifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
      });
      const remoteManifest = makeManifest({
        environments: [{ name: "production", description: "Prod" }],
      });
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc", EXTRA_KEY: "enc" },
        "/local/secrets/auth/dev.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/database/production.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/auth/production.enc.yaml": { AUTH_KEY: "enc" },
      };
      setupManifests(localManifest, remoteManifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      const dbIssue = result.issues.find((i) => i.key === "EXTRA_KEY");
      expect(dbIssue).toBeDefined();
      expect(dbIssue!.missingFrom).toContain("production");
      expect(dbIssue!.presentIn).toContain("dev");
    });
  });

  describe("no shared namespaces", () => {
    it("returns 0 compared and no issues", () => {
      const localManifest = makeManifest({
        namespaces: [{ name: "database", description: "DB" }],
      });
      const remoteManifest = makeManifest({
        namespaces: [{ name: "payments", description: "Pay" }],
      });
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/payments/dev.enc.yaml": { STRIPE_KEY: "enc" },
      };
      setupManifests(localManifest, remoteManifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.issues).toHaveLength(0);
      expect(result.namespacesCompared).toBe(0);
      expect(result.namespacesClean).toBe(0);
    });
  });

  describe("missing .enc.yaml file skipped gracefully", () => {
    it("does not error when a matrix file does not exist on disk", () => {
      const manifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
      });
      // Only local file exists; remote file is missing
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc" },
      };
      setupManifests(manifest, manifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      // The remote file is missing so remote env contributes no keys —
      // drift is reported because DB_URL is only in local/dev
      expect(result.namespacesCompared).toBe(1);
      // No crash
    });
  });

  describe("malformed YAML handled gracefully", () => {
    it("skips files with invalid YAML content", () => {
      const manifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
      });

      mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const p = String(filePath);
        if (p.endsWith("clef.yaml")) {
          return YAML.stringify(manifest);
        }
        if (p === "/local/secrets/database/dev.enc.yaml") {
          return "{{invalid yaml: [";
        }
        if (p === "/remote/secrets/database/dev.enc.yaml") {
          return YAML.stringify({ DB_URL: "enc", sops: { version: "3.9" } });
        }
        throw new Error(`ENOENT: ${p}`);
      });

      mockFs.existsSync.mockImplementation((filePath: fs.PathLike) => {
        const p = String(filePath);
        return (
          p.endsWith("clef.yaml") ||
          p === "/local/secrets/database/dev.enc.yaml" ||
          p === "/remote/secrets/database/dev.enc.yaml"
        );
      });

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      // Should not throw — malformed file is skipped
      expect(result.namespacesCompared).toBe(1);
    });
  });

  describe("namespace filter", () => {
    it("only compares namespaces in the filter list", () => {
      const manifest = makeManifest();
      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc" },
        "/local/secrets/database/staging.enc.yaml": { DB_URL: "enc" },
        "/local/secrets/database/production.enc.yaml": { DB_URL: "enc" },
        "/local/secrets/auth/dev.enc.yaml": { AUTH_KEY: "enc", EXTRA: "enc" },
        "/local/secrets/auth/staging.enc.yaml": { AUTH_KEY: "enc" },
        "/local/secrets/auth/production.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/database/dev.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/database/staging.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/database/production.enc.yaml": { DB_URL: "enc" },
        "/remote/secrets/auth/dev.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/auth/staging.enc.yaml": { AUTH_KEY: "enc" },
        "/remote/secrets/auth/production.enc.yaml": { AUTH_KEY: "enc" },
      };
      setupManifests(manifest, manifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote", ["database"]);

      // database namespace has no drift, auth is excluded from comparison
      expect(result.namespacesCompared).toBe(1);
      expect(result.namespacesClean).toBe(1);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("sops metadata key is filtered out", () => {
    it("does not report drift for the sops key", () => {
      const manifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
      });

      mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const p = String(filePath);
        if (p.endsWith("clef.yaml")) {
          return YAML.stringify(manifest);
        }
        // Both files have identical keys, sops key differs
        if (p.includes("/local/")) {
          return YAML.stringify({ DB_URL: "enc1", sops: { version: "3.9", mac: "local" } });
        }
        if (p.includes("/remote/")) {
          return YAML.stringify({ DB_URL: "enc2", sops: { version: "3.9", mac: "remote" } });
        }
        throw new Error(`ENOENT: ${p}`);
      });

      mockFs.existsSync.mockReturnValue(true);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.issues).toHaveLength(0);
    });
  });

  describe("different environments across repos", () => {
    it("compares across all environments from both repos", () => {
      const localManifest = makeManifest({
        environments: [
          { name: "dev", description: "Dev" },
          { name: "staging", description: "Staging" },
        ],
        namespaces: [{ name: "database", description: "DB" }],
      });
      const remoteManifest = makeManifest({
        environments: [{ name: "production", description: "Prod" }],
        namespaces: [{ name: "database", description: "DB" }],
      });

      const files: Record<string, Record<string, string>> = {
        "/local/secrets/database/dev.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/local/secrets/database/staging.enc.yaml": { DB_URL: "enc", DB_PASS: "enc" },
        "/remote/secrets/database/production.enc.yaml": { DB_URL: "enc" },
      };
      setupManifests(localManifest, remoteManifest, files);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.localEnvironments).toEqual(["dev", "staging"]);
      expect(result.remoteEnvironments).toEqual(["production"]);
      const passIssue = result.issues.find((i) => i.key === "DB_PASS");
      expect(passIssue).toBeDefined();
      expect(passIssue!.missingFrom).toContain("production");
    });
  });

  describe("file with null/scalar YAML content", () => {
    it("skips files that parse to non-object values", () => {
      const manifest = makeManifest({
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
      });

      mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const p = String(filePath);
        if (p.endsWith("clef.yaml")) {
          return YAML.stringify(manifest);
        }
        if (p.includes("/local/")) {
          return "null";
        }
        if (p.includes("/remote/")) {
          return YAML.stringify({ DB_URL: "enc", sops: { version: "3.9" } });
        }
        throw new Error(`ENOENT: ${p}`);
      });

      mockFs.existsSync.mockReturnValue(true);

      const detector = new DriftDetector();
      const result = detector.detect("/local", "/remote");

      expect(result.namespacesCompared).toBe(1);
    });
  });
});
