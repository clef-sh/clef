import express from "express";
import request from "supertest";
import { createApiRouter } from "./api";
import { SubprocessRunner, SubprocessResult, markPendingWithRetry } from "@clef-sh/core";
import * as fs from "fs";
import * as YAML from "yaml";

jest.mock("fs");

const mockServiceIdCreate = jest.fn().mockResolvedValue({
  identity: {
    name: "test-id",
    namespaces: ["database"],
    environments: { dev: { recipient: "age1testpubkey" } },
  },
  privateKeys: { dev: "AGE-SECRET-KEY-MOCK-VALUE" },
});
const mockServiceIdRotate = jest.fn().mockResolvedValue({ dev: "AGE-SECRET-KEY-ROTATED" });

const mockMigrate = jest.fn().mockResolvedValue({
  migratedFiles: ["/repo/database/dev.enc.yaml", "/repo/database/production.enc.yaml"],
  skippedFiles: [],
  rolledBack: false,
  verifiedFiles: ["/repo/database/dev.enc.yaml", "/repo/database/production.enc.yaml"],
  warnings: [],
});

// Mock the pending metadata functions and ServiceIdentityManager from core
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ServiceIdentityManager: jest.fn().mockImplementation(() => ({
      create: mockServiceIdCreate,
      rotateKey: mockServiceIdRotate,
      delete: jest.fn().mockResolvedValue(undefined),
      updateEnvironments: jest.fn().mockResolvedValue(undefined),
      validate: jest.fn().mockReturnValue([]),
    })),
    BackendMigrator: jest.fn().mockImplementation(() => ({
      migrate: mockMigrate,
    })),
    getPendingKeys: jest.fn().mockResolvedValue([]),
    markResolved: jest.fn().mockResolvedValue(undefined),
    markPendingWithRetry: jest.fn().mockResolvedValue(undefined),
    generateRandomValue: jest.fn().mockReturnValue("a".repeat(64)),
  };
});

const mockFs = fs as jest.Mocked<typeof fs>;

const validManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const validManifestYaml = YAML.stringify(validManifest);

const sopsFileContent = YAML.stringify({
  sops: {
    age: [{ recipient: "age1abc" }, { recipient: "age1def" }],
    lastmodified: "2024-01-15T00:00:00Z",
  },
});

function makeRunner(overrides?: Partial<Record<string, SubprocessResult>>): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      // Match overrides by "cmd subcommand" — find the first arg that isn't a flag
      const sub = args.find((a) => !a.startsWith("-") && a !== "/dev/null" && a !== "NUL") ?? "";
      const key = `${cmd} ${sub}`.trim();
      if (overrides && key in overrides) {
        return overrides[key];
      }

      if (cmd === "sops" && args.includes("--version")) {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        return {
          stdout: YAML.stringify({ DB_HOST: "localhost", DB_PORT: "5432" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (cmd === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (cmd === "cat") {
        return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args.includes("encrypt")) {
        return { stdout: "encrypted-content", stderr: "", exitCode: 0 };
      }
      if (cmd === "tee") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "git" && args[0] === "status") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "git" && args[0] === "commit") {
        return { stdout: "[main abc1234] test commit", stderr: "", exitCode: 0 };
      }
      if (cmd === "git" && args[0] === "add") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function createApp(runner?: SubprocessRunner) {
  mockFs.readFileSync.mockReturnValue(validManifestYaml);
  mockFs.existsSync.mockReturnValue(true);

  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createApiRouter({ runner: runner ?? makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
  );
  return app;
}

describe("API routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // GET /api/manifest
  describe("GET /api/manifest", () => {
    it("should return the manifest", async () => {
      const app = createApp();
      const res = await request(app).get("/api/manifest");
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect(res.body.environments).toHaveLength(2);
      expect(res.body.namespaces).toHaveLength(1);
    });

    it("should return 500 on manifest parse error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("file not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/manifest");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("MANIFEST_ERROR");
    });
  });

  // GET /api/matrix
  describe("GET /api/matrix", () => {
    it("should return matrix statuses", async () => {
      const app = createApp();
      const res = await request(app).get("/api/matrix");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Assert at least one cell has expected namespace/environment properties
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty("cell.namespace");
        expect(res.body[0]).toHaveProperty("cell.environment");
      }
    });

    it("should return 500 when manifest is missing", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/matrix");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("MATRIX_ERROR");
    });
  });

  // GET /api/namespace/:ns/:env
  describe("GET /api/namespace/:ns/:env", () => {
    it("should return decrypted values", async () => {
      const app = createApp();
      const res = await request(app).get("/api/namespace/database/dev");
      expect(res.status).toBe(200);
      expect(res.body.values).toBeDefined();
      expect(res.body.values.DB_HOST).toBe("localhost");
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).get("/api/namespace/unknown/dev");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 500 on decrypt error", async () => {
      const runner = makeRunner({
        "sops decrypt": { stdout: "", stderr: "decrypt failed", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/namespace/database/dev");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("DECRYPT_ERROR");
    });

    it("should set Cache-Control: no-store header on decrypted values", async () => {
      const app = createApp();
      const res = await request(app).get("/api/namespace/database/dev");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // PUT /api/namespace/:ns/:env/:key
  describe("PUT /api/namespace/:ns/:env/:key", () => {
    it("should set a value and NOT echo it back in the response", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "newhost" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toBe("DB_HOST");
      // A1: value must NOT be present in the response
      expect(res.body.value).toBeUndefined();
    });

    it("should return 400 when value is missing", async () => {
      const app = createApp();
      const res = await request(app).put("/api/namespace/database/dev/DB_HOST").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).put("/api/namespace/unknown/dev/KEY").send({ value: "val" });
      expect(res.status).toBe(404);
    });

    it("should generate random value server-side when random: true", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/dev/NEW_KEY")
        .send({ random: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pending).toBe(true);
      expect(res.body.value).toBeUndefined();
    });

    it("should rollback and return 500 when markPendingWithRetry fails after encrypt succeeds", async () => {
      (markPendingWithRetry as jest.Mock).mockRejectedValueOnce(new Error("disk full"));

      const runner = makeRunner();
      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/NEW_KEY")
        .send({ random: true });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Pending state could not be recorded");
      expect(res.body.message).toContain("rolled back");
      // Verify sops.encrypt was called twice (once for set, once for rollback)
      const runCalls = (runner.run as jest.Mock).mock.calls;
      const encryptCalls = runCalls.filter(
        (c: [string, string[], Record<string, unknown>?]) =>
          c[0] === "sops" && (c[1] as string[]).includes("encrypt"),
      );
      expect(encryptCalls.length).toBeGreaterThanOrEqual(2);

      // Verify the rollback encrypt does NOT contain the new key
      const rollbackCall = encryptCalls[1];
      const rollbackStdin = (rollbackCall[2] as { stdin?: string })?.stdin ?? "";
      expect(rollbackStdin).not.toContain("NEW_KEY");
      // Verify original values are preserved
      const parsed = YAML.parse(rollbackStdin);
      expect(parsed).toEqual({ DB_HOST: "localhost", DB_PORT: "5432" });
    });

    it("should return 500 with partial failure when both pending and rollback fail", async () => {
      (markPendingWithRetry as jest.Mock).mockRejectedValueOnce(new Error("disk full"));

      const runner = makeRunner({
        "sops encrypt": { stdout: "", stderr: "encrypt failed", exitCode: 1 },
      });
      // Override so first encrypt succeeds, second fails (rollback)
      let encryptCallCount = 0;
      (runner.run as jest.Mock).mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "sops" && args[0] === "decrypt") {
          return {
            stdout: YAML.stringify({ DB_HOST: "localhost", DB_PORT: "5432" }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (cmd === "sops" && args.includes("encrypt")) {
          encryptCallCount++;
          if (encryptCallCount === 1) {
            return { stdout: "encrypted", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "encrypt failed", exitCode: 1 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        if (cmd === "cat") {
          return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/NEW_KEY")
        .send({ random: true });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Partial failure");
      expect(res.body.code).toBe("PARTIAL_FAILURE");
    });

    it("should return 500 on encrypt error", async () => {
      const runner = makeRunner({
        "sops encrypt": { stdout: "", stderr: "encrypt failed", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "val" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("SET_ERROR");
    });

    it("should return warnings when value violates schema", async () => {
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockImplementation((p: string) => {
        if (String(p).includes("clef.yaml")) return validManifestYaml;
        if (String(p).includes("schemas/")) {
          return YAML.stringify({
            keys: {
              DB_HOST: { type: "string", required: true, pattern: "^postgres://" },
            },
          });
        }
        return "";
      });

      const manifestWithSchema = {
        ...validManifest,
        namespaces: [{ name: "database", description: "DB", schema: "schemas/database.yaml" }],
      };
      const manifestYaml = YAML.stringify(manifestWithSchema);
      readFileSync.mockImplementation((p: string) => {
        if (String(p).includes("clef.yaml")) return manifestYaml;
        if (String(p).includes("schemas/")) {
          return YAML.stringify({
            keys: {
              DB_HOST: { type: "string", required: true, pattern: "^postgres://" },
            },
          });
        }
        // Return valid SOPS metadata for encrypted files so parseMetadataFromFile succeeds
        return sopsFileContent;
      });
      const { existsSync } = jest.requireMock("fs");
      existsSync.mockReturnValue(true);

      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "not-a-postgres-url" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.warnings).toBeDefined();
      expect(res.body.warnings.length).toBeGreaterThan(0);
    });

    it("should set Cache-Control: no-store header on PUT response", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "newhost" });
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
    });

    it("should return 409 when writing to protected environment without confirmation", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/production/KEY")
        .send({ value: "val" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROTECTED_ENV");
      expect(res.body.protected).toBe(true);
    });

    it("should allow writing to protected environment with confirmed: true", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/production/KEY")
        .send({ value: "val", confirmed: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return no warnings when value passes schema", async () => {
      const app = createApp();
      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "newhost" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.warnings).toBeUndefined();
    });
  });

  // DELETE /api/namespace/:ns/:env/:key
  describe("DELETE /api/namespace/:ns/:env/:key", () => {
    it("should delete a key", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespace/database/dev/DB_HOST");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 404 for unknown key", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespace/database/dev/NONEXISTENT");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("KEY_NOT_FOUND");
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespace/unknown/dev/KEY");
      expect(res.status).toBe(404);
    });

    it("should return 500 on decrypt error", async () => {
      const runner = makeRunner({
        "sops decrypt": { stdout: "", stderr: "error", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app).delete("/api/namespace/database/dev/KEY");
      expect(res.status).toBe(500);
    });

    it("should set Cache-Control: no-store header on DELETE response", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespace/database/dev/DB_HOST");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
    });

    it("should return 409 when deleting from protected environment without confirmation", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespace/database/production/DB_HOST");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROTECTED_ENV");
    });

    it("should allow deleting from protected environment with confirmed: true", async () => {
      const app = createApp();
      const res = await request(app)
        .delete("/api/namespace/database/production/DB_HOST")
        .send({ confirmed: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should call markResolved after successful delete", async () => {
      const { markResolved: mockMarkResolved } = jest.requireMock("@clef-sh/core");
      const app = createApp();
      const res = await request(app).delete("/api/namespace/database/dev/DB_HOST");
      expect(res.status).toBe(200);
      expect(mockMarkResolved).toHaveBeenCalledWith(
        expect.stringContaining("database/dev.enc.yaml"),
        ["DB_HOST"],
      );
    });
  });

  // POST /api/namespace/:ns/:env/:key/accept
  describe("POST /api/namespace/:ns/:env/:key/accept", () => {
    it("should call markResolved and return success", async () => {
      const { markResolved: mockMarkResolved } = jest.requireMock("@clef-sh/core");
      const app = createApp();
      const res = await request(app).post("/api/namespace/database/dev/DB_HOST/accept");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMarkResolved).toHaveBeenCalledWith(
        expect.stringContaining("database/dev.enc.yaml"),
        ["DB_HOST"],
      );
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).post("/api/namespace/unknown/dev/DB_HOST/accept");
      expect(res.status).toBe(404);
    });
  });

  // GET /api/diff/:ns/:envA/:envB
  describe("GET /api/diff/:ns/:envA/:envB", () => {
    it("should return diff result", async () => {
      const app = createApp();
      const res = await request(app).get("/api/diff/database/dev/production");
      expect(res.status).toBe(200);
      expect(res.body.namespace).toBe("database");
      expect(res.body.rows).toBeDefined();
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).get("/api/diff/unknown/dev/production");
      expect(res.status).toBe(404);
    });

    it("should return 500 on diff error", async () => {
      const runner = makeRunner({
        "sops decrypt": { stdout: "", stderr: "decrypt failed", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/diff/database/dev/production");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("DIFF_ERROR");
    });

    it("should set Cache-Control: no-store header on diff response", async () => {
      const app = createApp();
      const res = await request(app).get("/api/diff/database/dev/production");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // GET /api/lint/:namespace
  describe("GET /api/lint/:namespace", () => {
    it("should return lint issues filtered by namespace", async () => {
      const app = createApp();
      const res = await request(app).get("/api/lint/database");
      expect(res.status).toBe(200);
      expect(res.body.issues).toBeDefined();
      expect(res.body.fileCount).toBeDefined();
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).get("/api/lint/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  // GET /api/lint
  describe("GET /api/lint", () => {
    it("should return lint result", async () => {
      const app = createApp();
      const res = await request(app).get("/api/lint");
      expect(res.status).toBe(200);
      expect(res.body.issues).toBeDefined();
      expect(res.body.fileCount).toBeDefined();
    });

    it("should return 500 on lint error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/lint");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("LINT_ERROR");
    });
  });

  // POST /api/lint/fix
  describe("POST /api/lint/fix", () => {
    it("should run lint fix and return result", async () => {
      const app = createApp();
      const res = await request(app).post("/api/lint/fix");
      expect(res.status).toBe(200);
      expect(res.body.issues).toBeDefined();
    });

    it("should return 500 on fix error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).post("/api/lint/fix");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("LINT_FIX_ERROR");
    });
  });

  // POST /api/git/commit
  describe("POST /api/git/commit", () => {
    it("should stage clef files and create a commit", async () => {
      const runner = makeRunner({
        "git status": {
          stdout: " M database/dev.enc.yaml\n M database/dev.clef-meta.yaml\n",
          stderr: "",
          exitCode: 0,
        },
      });
      const app = createApp(runner);
      const res = await request(app).post("/api/git/commit").send({ message: "test commit" });
      expect(res.status).toBe(200);
      expect(res.body.hash).toBe("abc1234");

      // Assert stageFiles is called before commit with only clef files
      const runCalls = (runner.run as jest.Mock).mock.calls;
      const addCall = runCalls.find((c: [string, string[]]) => c[0] === "git" && c[1][0] === "add");
      const commitCall = runCalls.find(
        (c: [string, string[]]) => c[0] === "git" && c[1][0] === "commit",
      );
      expect(addCall).toBeDefined();
      expect(commitCall).toBeDefined();
      // add must be called before commit
      const addIndex = runCalls.indexOf(addCall);
      const commitIndex = runCalls.indexOf(commitCall);
      expect(addIndex).toBeLessThan(commitIndex);
    });

    it("should only stage .enc.yaml, .enc.json, and .clef-meta.yaml files", async () => {
      const runner = makeRunner({
        "git status": {
          stdout:
            "?? database/dev.enc.yaml\n?? README.md\n?? database/dev.clef-meta.yaml\n?? notes.txt\n",
          stderr: "",
          exitCode: 0,
        },
      });
      const app = createApp(runner);
      const res = await request(app).post("/api/git/commit").send({ message: "test" });
      expect(res.status).toBe(200);

      const runCalls = (runner.run as jest.Mock).mock.calls;
      const addCall = runCalls.find((c: [string, string[]]) => c[0] === "git" && c[1][0] === "add");
      expect(addCall).toBeDefined();
      // Should include clef files but not README.md or notes.txt
      const addArgs = addCall![1] as string[];
      expect(addArgs).toContain("database/dev.enc.yaml");
      expect(addArgs).toContain("database/dev.clef-meta.yaml");
      expect(addArgs).not.toContain("README.md");
      expect(addArgs).not.toContain("notes.txt");
    });

    it("should return 400 when there are no clef files to commit", async () => {
      const runner = makeRunner({
        "git status": {
          stdout: " M README.md\n",
          stderr: "",
          exitCode: 0,
        },
      });
      const app = createApp(runner);
      const res = await request(app).post("/api/git/commit").send({ message: "test" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOTHING_TO_COMMIT");
    });

    it("should return 400 when message is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/git/commit").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 on git error", async () => {
      const runner = makeRunner({
        "git status": {
          stdout: " M database/dev.enc.yaml\n",
          stderr: "",
          exitCode: 0,
        },
        "git commit": { stdout: "", stderr: "nothing to commit", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app).post("/api/git/commit").send({ message: "test" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("GIT_ERROR");
    });
  });

  // GET /api/git/status
  describe("GET /api/git/status", () => {
    it("should return git status", async () => {
      const app = createApp();
      const res = await request(app).get("/api/git/status");
      expect(res.status).toBe(200);
      expect(res.body.staged).toBeDefined();
      expect(res.body.unstaged).toBeDefined();
      expect(res.body.untracked).toBeDefined();
    });

    it("should return 500 on error", async () => {
      const runner = makeRunner({
        "git status": { stdout: "", stderr: "not a git repo", exitCode: 128 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/git/status");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("GIT_ERROR");
    });
  });

  // GET /api/lint/:namespace — error path
  describe("GET /api/lint/:namespace — lint error", () => {
    it("should return 500 when the lint run throws", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("disk error");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/lint/database");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("LINT_ERROR");
    });
  });

  // POST /api/scan
  describe("POST /api/scan", () => {
    it("should return scan results", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scan").send({});
      expect(res.status).toBe(200);
      expect(res.body.matches).toBeDefined();
      expect(res.body.filesScanned).toBeDefined();
      expect(res.body.unencryptedMatrixFiles).toBeDefined();
    });

    it("should accept a severity filter", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scan").send({ severity: "high" });
      expect(res.status).toBe(200);
    });

    it("should return 500 on scan error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("io error");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).post("/api/scan").send({});
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("SCAN_ERROR");
    });
  });

  // GET /api/scan/status
  describe("GET /api/scan/status", () => {
    it("should return null before any scan has run", async () => {
      const app = createApp();
      const res = await request(app).get("/api/scan/status");
      expect(res.status).toBe(200);
      expect(res.body.lastRun).toBeNull();
      expect(res.body.lastRunAt).toBeNull();
    });

    it("should return the last scan result after a scan", async () => {
      const app = createApp();
      await request(app).post("/api/scan").send({});
      const res = await request(app).get("/api/scan/status");
      expect(res.status).toBe(200);
      expect(res.body.lastRun).not.toBeNull();
      expect(res.body.lastRunAt).not.toBeNull();
    });
  });

  // POST /api/editor/open
  describe("POST /api/editor/open", () => {
    let savedEditor: string | undefined;
    let savedTermProgram: string | undefined;

    beforeEach(() => {
      savedEditor = process.env.EDITOR;
      savedTermProgram = process.env.TERM_PROGRAM;
    });

    afterEach(() => {
      if (savedEditor === undefined) {
        delete process.env.EDITOR;
      } else {
        process.env.EDITOR = savedEditor;
      }
      if (savedTermProgram === undefined) {
        delete process.env.TERM_PROGRAM;
      } else {
        process.env.TERM_PROGRAM = savedTermProgram;
      }
    });

    it("should open a file when EDITOR is configured", async () => {
      process.env.EDITOR = "nano";
      delete process.env.TERM_PROGRAM;
      const app = createApp();
      const res = await request(app)
        .post("/api/editor/open")
        .send({ file: "database/dev.enc.yaml" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 400 when file is missing from body", async () => {
      process.env.EDITOR = "nano";
      const app = createApp();
      const res = await request(app).post("/api/editor/open").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 when no editor is configured", async () => {
      delete process.env.EDITOR;
      delete process.env.TERM_PROGRAM;
      const app = createApp();
      const res = await request(app)
        .post("/api/editor/open")
        .send({ file: "database/dev.enc.yaml" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("NO_EDITOR");
    });

    it("should return 400 when file path escapes repo root", async () => {
      process.env.EDITOR = "nano";
      delete process.env.TERM_PROGRAM;
      const app = createApp();
      const res = await request(app).post("/api/editor/open").send({ file: "../../../etc/passwd" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 when the runner throws", async () => {
      process.env.EDITOR = "nano";
      delete process.env.TERM_PROGRAM;
      const runner = makeRunner();
      (runner.run as jest.Mock).mockRejectedValueOnce(new Error("editor crashed"));
      const app = createApp(runner);
      const res = await request(app)
        .post("/api/editor/open")
        .send({ file: "database/dev.enc.yaml" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("EDITOR_ERROR");
    });
  });

  // POST /api/import/preview
  describe("POST /api/import/preview", () => {
    it("should return a dry-run preview of keys to import", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/preview")
        .send({ target: "database/dev", content: "NEW_KEY=value\nDB_HOST=newhost" });
      expect(res.status).toBe(200);
      expect(res.body.wouldImport).toBeDefined();
      expect(res.body.wouldSkip).toBeDefined();
      expect(res.body.wouldOverwrite).toBeDefined();
      expect(res.body.totalKeys).toBeDefined();
    });

    it("should classify overwriteKeys separately", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/preview")
        .send({
          target: "database/dev",
          content: "NEW_KEY=value\nDB_HOST=newhost",
          overwriteKeys: ["DB_HOST"],
        });
      expect(res.status).toBe(200);
      expect(res.body.wouldImport).not.toContain("DB_HOST");
    });

    it("should return 400 when target is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/import/preview").send({ content: "KEY=value" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 400 for invalid target format", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/preview")
        .send({ target: "invalid", content: "KEY=value" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 on preview error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("io error");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app)
        .post("/api/import/preview")
        .send({ target: "database/dev", content: "KEY=value" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("IMPORT_PREVIEW_ERROR");
    });
  });

  // POST /api/import/apply
  describe("POST /api/import/apply", () => {
    it("should import selected keys into the target", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/apply")
        .send({
          target: "database/dev",
          content: "NEW_KEY=value",
          keys: ["NEW_KEY"],
        });
      expect(res.status).toBe(200);
      expect(res.body.imported).toBeDefined();
      expect(res.body.skipped).toBeDefined();
      expect(res.body.failed).toBeDefined();
    });

    it("should return 200 with empty arrays when keys is empty", async () => {
      const app = createApp();
      const res = await request(app).post("/api/import/apply").send({
        target: "database/dev",
        content: "NEW_KEY=value",
        keys: [],
      });
      expect(res.status).toBe(200);
      expect(res.body.imported).toEqual([]);
      expect(res.body.skipped).toEqual([]);
      expect(res.body.failed).toEqual([]);
    });

    it("should return 400 when target is missing", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/apply")
        .send({ content: "KEY=value", keys: ["KEY"] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 400 when keys array is missing", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/apply")
        .send({ target: "database/dev", content: "KEY=value" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 400 for invalid target format", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/import/apply")
        .send({ target: "invalid", content: "KEY=value", keys: ["KEY"] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 on apply error", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("io error");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app)
        .post("/api/import/apply")
        .send({
          target: "database/dev",
          content: "KEY=value",
          keys: ["KEY"],
        });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("IMPORT_APPLY_ERROR");
    });
  });

  // GET /api/recipients
  describe("GET /api/recipients", () => {
    it("should return recipients list", async () => {
      const manifestWithRecipients = {
        ...validManifest,
        sops: {
          default_backend: "age",
          age: {
            recipients: [
              {
                key: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
                label: "Test Key",
              },
            ],
          },
        },
      };
      const manifestYaml = YAML.stringify(manifestWithRecipients);
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.existsSync.mockReturnValue(true);

      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/recipients");
      expect(res.status).toBe(200);
      expect(res.body.recipients).toBeDefined();
      expect(Array.isArray(res.body.recipients)).toBe(true);
      expect(res.body.totalFiles).toBeDefined();
      expect(typeof res.body.totalFiles).toBe("number");
    });

    it("should return 500 when manifest is missing", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/recipients");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("RECIPIENTS_ERROR");
    });
  });

  // GET /api/recipients/validate
  describe("GET /api/recipients/validate", () => {
    it("should validate a valid age key", async () => {
      const app = createApp();
      const res = await request(app).get(
        "/api/recipients/validate?key=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      );
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.key).toBeDefined();
    });

    it("should reject an invalid key", async () => {
      const app = createApp();
      const res = await request(app).get("/api/recipients/validate?key=not-a-valid-key");
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when key is missing", async () => {
      const app = createApp();
      const res = await request(app).get("/api/recipients/validate");
      expect(res.status).toBe(400);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  // POST /api/recipients/add
  describe("POST /api/recipients/add", () => {
    it("should add a recipient and return result", async () => {
      const manifestWithRecipients = {
        ...validManifest,
        sops: {
          default_backend: "age",
          age: {
            recipients: [
              {
                key: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
                label: "Existing Key",
              },
            ],
          },
        },
      };
      const manifestYaml = YAML.stringify(manifestWithRecipients);
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);

      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).post("/api/recipients/add").send({
        key: "age1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
        label: "New Key",
      });
      expect(res.status).toBe(200);
      expect(res.body.added).toBeDefined();
      expect(res.body.recipients).toBeDefined();
      expect(res.body.reEncryptedFiles).toBeDefined();
      expect(res.body.failedFiles).toBeDefined();
    });

    it("should return error for invalid key", async () => {
      const app = createApp();
      const res = await request(app).post("/api/recipients/add").send({ key: "not-a-valid-key" });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("RECIPIENTS_ADD_ERROR");
    });
  });

  // POST /api/recipients/remove
  describe("POST /api/recipients/remove", () => {
    it("should remove a recipient and return result with rotation reminder", async () => {
      const testKey = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
      const manifestWithRecipients = {
        ...validManifest,
        sops: {
          default_backend: "age",
          age: {
            recipients: [
              { key: testKey, label: "Test Key" },
              {
                key: "age1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
                label: "Other Key",
              },
            ],
          },
        },
      };
      const manifestYaml = YAML.stringify(manifestWithRecipients);
      mockFs.readFileSync.mockReturnValue(manifestYaml);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);

      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).post("/api/recipients/remove").send({ key: testKey });
      expect(res.status).toBe(200);
      expect(res.body.removed).toBeDefined();
      expect(res.body.recipients).toBeDefined();
      expect(res.body.rotationReminder).toBeDefined();
      expect(Array.isArray(res.body.rotationReminder)).toBe(true);
    });

    it("should return error for non-existent key", async () => {
      const app = createApp();
      const res = await request(app).post("/api/recipients/remove").send({
        key: "age1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
      });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("RECIPIENTS_REMOVE_ERROR");
    });
  });

  // GET /api/git/diff
  describe("GET /api/git/diff", () => {
    it("should return diff", async () => {
      const runner = makeRunner({
        "git diff": { stdout: "diff output here", stderr: "", exitCode: 0 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/git/diff");
      expect(res.status).toBe(200);
      expect(res.body.diff).toBeDefined();
    });

    it("should return empty diff when no changes", async () => {
      const app = createApp();
      const res = await request(app).get("/api/git/diff");
      expect(res.status).toBe(200);
      expect(res.body.diff).toBeDefined();
    });

    it("should set Cache-Control: no-store header", async () => {
      const app = createApp();
      const res = await request(app).get("/api/git/diff");
      expect(res.headers["cache-control"]).toContain("no-store");
    });

    it("should return 500 on error", async () => {
      const runner = makeRunner({
        "git diff": { stdout: "", stderr: "not a repo", exitCode: 128 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/git/diff");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("GIT_DIFF_ERROR");
    });
  });

  // GET /api/git/log/:ns/:env
  describe("GET /api/git/log/:ns/:env", () => {
    it("should return log entries", async () => {
      const runner = makeRunner({
        "git log": {
          stdout: "abc123|author|2024-01-15T00:00:00Z|test commit\n",
          stderr: "",
          exitCode: 0,
        },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/git/log/database/dev");
      expect(res.status).toBe(200);
      expect(res.body.log).toBeDefined();
      expect(Array.isArray(res.body.log)).toBe(true);
    });

    it("should return 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).get("/api/git/log/unknown/dev");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 500 on error", async () => {
      const runner = makeRunner({
        "git log": { stdout: "", stderr: "not a repo", exitCode: 128 },
      });
      const app = createApp(runner);
      const res = await request(app).get("/api/git/log/database/dev");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("GIT_LOG_ERROR");
    });
  });

  // POST /api/copy
  describe("POST /api/copy", () => {
    it("should copy a key from one cell to another", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "dev",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toBe("DB_HOST");
      expect(res.body.from).toBe("database/dev");
      expect(res.body.to).toBe("database/dev");
    });

    it("should copy to a protected environment when confirmed: true", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "production",
        confirmed: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 400 when any required field is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        // fromEnv, toNs, toEnv absent
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 409 when copying to a protected environment without confirmation", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "production",
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROTECTED_ENV");
      expect(res.body.protected).toBe(true);
    });

    it("should return 404 when source cell is not in the matrix", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "ghost",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "dev",
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 404 when destination cell is not in the matrix", async () => {
      const app = createApp();
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "canary",
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 500 when sops fails during copy", async () => {
      const runner = makeRunner({
        "sops decrypt": { stdout: "", stderr: "mac mismatch", exitCode: 1 },
      });
      const app = createApp(runner);
      const res = await request(app).post("/api/copy").send({
        key: "DB_HOST",
        fromNs: "database",
        fromEnv: "dev",
        toNs: "database",
        toEnv: "dev",
      });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("COPY_ERROR");
    });
  });

  // Multi-step workflow: set value then commit
  describe("workflow: set then commit", () => {
    it("should set a value and then commit the encrypted file", async () => {
      const runner = makeRunner({
        "git status": {
          stdout: "?? database/dev.enc.yaml\n?? database/dev.clef-meta.yaml\n",
          stderr: "",
          exitCode: 0,
        },
      });
      const app = createApp(runner);

      const setRes = await request(app)
        .put("/api/namespace/database/dev/DB_PASSWORD")
        .send({ value: "supersecret" });
      expect(setRes.status).toBe(200);

      const commitRes = await request(app)
        .post("/api/git/commit")
        .send({ message: "feat(database): add DB_PASSWORD" });
      expect(commitRes.status).toBe(200);
      expect(commitRes.body.hash).toBeDefined();
    });

    it("should return 500 on commit when git fails after a successful set", async () => {
      const runner = makeRunner({
        "git status": { stdout: "?? database/dev.enc.yaml\n", stderr: "", exitCode: 0 },
        "git commit": { stdout: "", stderr: "fatal: not a git repo", exitCode: 128 },
      });
      const app = createApp(runner);

      const setRes = await request(app)
        .put("/api/namespace/database/dev/DB_PASSWORD")
        .send({ value: "supersecret" });
      expect(setRes.status).toBe(200);

      const commitRes = await request(app).post("/api/git/commit").send({ message: "update" });
      expect(commitRes.status).toBe(500);
      expect(commitRes.body.code).toBe("GIT_ERROR");
    });
  });

  // Multi-step workflow: import preview then apply
  describe("workflow: import preview then apply", () => {
    it("should preview keys and then apply the selected subset", async () => {
      const app = createApp();
      const content = "NEW_API_KEY=abc123\nDB_HOST=override";

      const previewRes = await request(app)
        .post("/api/import/preview")
        .send({ target: "database/dev", content });
      expect(previewRes.status).toBe(200);
      expect(Array.isArray(previewRes.body.wouldImport)).toBe(true);

      const applyRes = await request(app)
        .post("/api/import/apply")
        .send({ target: "database/dev", content, keys: ["NEW_API_KEY"] });
      expect(applyRes.status).toBe(200);
      expect(Array.isArray(applyRes.body.imported)).toBe(true);
    });

    it("should return 400 on apply when target was malformed", async () => {
      const app = createApp();
      await request(app)
        .post("/api/import/preview")
        .send({ target: "database/dev", content: "KEY=val" });

      const applyRes = await request(app)
        .post("/api/import/apply")
        .send({ target: "bad", content: "KEY=val", keys: ["KEY"] });
      expect(applyRes.status).toBe(400);
      expect(applyRes.body.code).toBe("BAD_REQUEST");
    });
  });

  // Multi-step workflow: scan then check cached status
  describe("workflow: scan then check status", () => {
    it("should return null status before scan, then populated status after", async () => {
      const app = createApp();

      const before = await request(app).get("/api/scan/status");
      expect(before.status).toBe(200);
      expect(before.body.lastRun).toBeNull();

      await request(app).post("/api/scan").send({});

      const after = await request(app).get("/api/scan/status");
      expect(after.status).toBe(200);
      expect(after.body.lastRun).not.toBeNull();
      expect(after.body.lastRunAt).not.toBeNull();
    });
  });

  // Scan with severity: "all" (gap in existing tests which only cover "high")
  describe("POST /api/scan — severity: all", () => {
    it("should accept severity: 'all' and return scan results", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scan").send({ severity: "all" });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.matches)).toBe(true);
    });
  });

  // Pending key inclusion in GET namespace response
  describe("GET /api/namespace/:ns/:env — pending keys", () => {
    it("should include keys returned by getPendingKeys in the pending array", async () => {
      const { getPendingKeys: mockGetPending } = jest.requireMock("@clef-sh/core");
      mockGetPending.mockResolvedValueOnce(["DB_PASSWORD"]);
      const app = createApp();
      const res = await request(app).get("/api/namespace/database/dev");
      expect(res.status).toBe(200);
      expect(res.body.pending).toContain("DB_PASSWORD");
    });
  });

  // Service identity create — private key security headers
  describe("POST /api/service-identities — private key security", () => {
    it("should set Cache-Control: no-store on create response containing private keys", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/service-identities")
        .send({ name: "my-svc", namespaces: ["database"] });

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["pragma"]).toBe("no-cache");
    });

    it("should return private keys in the response body", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/service-identities")
        .send({ name: "my-svc", namespaces: ["database"] });

      expect(res.status).toBe(200);
      expect(res.body.privateKeys).toBeDefined();
      expect(res.body.identity).toBeDefined();
    });
  });

  // Service identity rotate — private key security headers
  describe("POST /api/service-identities/:name/rotate — private key security", () => {
    it("should set Cache-Control: no-store on rotate response containing private keys", async () => {
      const manifest = {
        ...validManifest,
        service_identities: [
          {
            name: "my-svc",
            namespaces: ["database"],
            environments: { dev: { recipient: "age1old" } },
          },
        ],
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
      const app = createApp();
      const res = await request(app).post("/api/service-identities/my-svc/rotate").send({});

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["pragma"]).toBe("no-cache");
    });

    it("should return private keys in the rotate response body", async () => {
      const manifest = {
        ...validManifest,
        service_identities: [
          {
            name: "my-svc",
            namespaces: ["database"],
            environments: { dev: { recipient: "age1old" } },
          },
        ],
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
      const app = createApp();
      const res = await request(app).post("/api/service-identities/my-svc/rotate").send({});

      expect(res.status).toBe(200);
      expect(res.body.privateKeys).toBeDefined();
    });
  });

  // ── Backend Migration ─────────────────────────────────────────────────────

  describe("GET /api/backend-config", () => {
    it("should return global backend and per-env effective config", async () => {
      const app = createApp();
      const res = await request(app).get("/api/backend-config");
      expect(res.status).toBe(200);
      expect(res.body.global.default_backend).toBe("age");
      expect(res.body.environments).toHaveLength(2);
      expect(res.body.environments[0].name).toBe("dev");
      expect(res.body.environments[0].effective.backend).toBe("age");
      expect(res.body.environments[0].hasOverride).toBe(false);
      expect(res.body.environments[1].name).toBe("production");
      expect(res.body.environments[1].protected).toBe(true);
    });

    it("should return 500 when manifest cannot be parsed", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("file not found");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );
      const res = await request(app).get("/api/backend-config");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("BACKEND_CONFIG_ERROR");
    });
  });

  describe("POST /api/migrate-backend/preview", () => {
    it("should return dry-run result with events", async () => {
      mockMigrate.mockResolvedValueOnce({
        migratedFiles: [],
        skippedFiles: [],
        rolledBack: false,
        verifiedFiles: [],
        warnings: ["Would update global default_backend \u2192 awskms"],
      });
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result).toBeDefined();
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    it("should return 409 for protected env without confirmed", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: { backend: "awskms", key: "arn:..." } });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROTECTED_ENV");
    });

    it("should proceed with confirmed: true on protected env", async () => {
      mockMigrate.mockResolvedValueOnce({
        migratedFiles: [],
        skippedFiles: [],
        rolledBack: false,
        verifiedFiles: [],
        warnings: [],
      });
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 400 when target is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/migrate-backend/preview").send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 400 when target.backend is missing", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: {}, confirmed: true });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 when migrator throws", async () => {
      mockMigrate.mockRejectedValueOnce(new Error("Unexpected sops failure"));
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("MIGRATION_ERROR");
      expect(res.body.error).toContain("Unexpected sops failure");
    });

    it("should not require confirmation when scoped to non-protected env", async () => {
      mockMigrate.mockResolvedValueOnce({
        migratedFiles: [],
        skippedFiles: [],
        rolledBack: false,
        verifiedFiles: [],
        warnings: [],
      });
      const app = createApp();
      // Scope to "dev" which is not protected — should not require confirmed
      const res = await request(app)
        .post("/api/migrate-backend/preview")
        .send({ target: { backend: "awskms", key: "arn:..." }, environment: "dev" });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/migrate-backend/apply", () => {
    it("should return success result with migrated files", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/apply")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.migratedFiles).toHaveLength(2);
      expect(res.body.result.rolledBack).toBe(false);
    });

    it("should return result with rolledBack on failure", async () => {
      mockMigrate.mockResolvedValueOnce({
        migratedFiles: [],
        skippedFiles: [],
        rolledBack: true,
        error: "KMS access denied",
        verifiedFiles: [],
        warnings: ["All changes have been rolled back."],
      });
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/apply")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.result.rolledBack).toBe(true);
      expect(res.body.result.error).toContain("KMS access denied");
    });

    it("should return 409 for protected env without confirmed", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/apply")
        .send({ target: { backend: "awskms", key: "arn:..." } });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROTECTED_ENV");
    });

    it("should return 400 when target is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/migrate-backend/apply").send({ confirmed: true });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("should return 500 when migrator throws", async () => {
      mockMigrate.mockRejectedValueOnce(new Error("KMS connection timeout"));
      const app = createApp();
      const res = await request(app)
        .post("/api/migrate-backend/apply")
        .send({ target: { backend: "awskms", key: "arn:..." }, confirmed: true });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("MIGRATION_ERROR");
      expect(res.body.error).toContain("KMS connection timeout");
    });
  });
});
