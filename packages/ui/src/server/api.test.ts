import express from "express";
import request from "supertest";
import { createApiRouter } from "./api";
import {
  SubprocessRunner,
  SubprocessResult,
  markPendingWithRetry,
  CLEF_POLICY_FILENAME,
} from "@clef-sh/core";
import * as fs from "fs";
import * as YAML from "yaml";

jest.mock("fs");
// write-file-atomic and @clef-sh/core source mapping are wired up in
// packages/ui/jest.config.js — needed because the built core dist inlines
// write-file-atomic, which would defeat any local jest.mock() here.

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

const mockResetReset = jest.fn().mockResolvedValue({
  scaffoldedCells: ["/repo/database/dev.enc.yaml"],
  pendingKeysByCell: {},
  backendChanged: false,
  affectedEnvironments: ["dev"],
});

const mockSyncPlan = jest.fn().mockResolvedValue({
  cells: [
    {
      namespace: "database",
      environment: "production",
      filePath: "/repo/database/production.enc.yaml",
      missingKeys: ["API_KEY"],
      isProtected: true,
    },
  ],
  totalKeys: 1,
  hasProtectedEnvs: true,
});
const mockSyncSync = jest.fn().mockResolvedValue({
  modifiedCells: ["database/production"],
  scaffoldedKeys: { "database/production": ["API_KEY"] },
  totalKeysScaffolded: 1,
});

const mockWriteSchema = jest.fn();

// StructureManager method stubs — default to success. Tests override per-case
// for error scenarios.
const mockAddNamespace = jest.fn().mockResolvedValue(undefined);
const mockEditNamespace = jest.fn().mockResolvedValue(undefined);
const mockRemoveNamespace = jest.fn().mockResolvedValue(undefined);
const mockAddEnvironment = jest.fn().mockResolvedValue(undefined);
const mockEditEnvironment = jest.fn().mockResolvedValue(undefined);
const mockRemoveEnvironment = jest.fn().mockResolvedValue(undefined);

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
    StructureManager: jest.fn().mockImplementation(() => ({
      addNamespace: mockAddNamespace,
      editNamespace: mockEditNamespace,
      removeNamespace: mockRemoveNamespace,
      addEnvironment: mockAddEnvironment,
      editEnvironment: mockEditEnvironment,
      removeEnvironment: mockRemoveEnvironment,
    })),
    BackendMigrator: jest.fn().mockImplementation(() => ({
      migrate: mockMigrate,
    })),
    ResetManager: jest.fn().mockImplementation(() => ({
      reset: mockResetReset,
    })),
    SyncManager: jest.fn().mockImplementation(() => ({
      plan: mockSyncPlan,
      sync: mockSyncSync,
    })),
    // TransactionManager wraps every mutation in a real RecipientManager,
    // BulkOps, ImportRunner, etc. Stub it so tests don't try to acquire
    // git locks or run preflight against a mocked filesystem.
    TransactionManager: jest.fn().mockImplementation(() => ({
      run: jest
        .fn()
        .mockImplementation(
          async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
            await opts.mutate();
            return { sha: null, paths: opts.paths, startedDirty: false };
          },
        ),
    })),
    getPendingKeys: jest.fn().mockResolvedValue([]),
    markResolved: jest.fn().mockResolvedValue(undefined),
    markPendingWithRetry: jest.fn().mockResolvedValue(undefined),
    recordRotation: jest.fn().mockResolvedValue(undefined),
    removeRotation: jest.fn().mockResolvedValue(undefined),
    generateRandomValue: jest.fn().mockReturnValue("a".repeat(64)),
    writeSchema: (...args: unknown[]) => mockWriteSchema(...args),
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
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
        return { stdout: "abc1234", stderr: "", exitCode: 0 };
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

    it("records a rotation when a real (non-random) value is set via the UI", async () => {
      // Regression: the UI PUT endpoint used to call markResolved only,
      // which never wrote a rotation record — policy stayed red forever
      // even after the user re-saved.  Now a real-value PUT must call
      // recordRotation (which also strips pending internally).
      const { recordRotation: mockRecordRotation } = jest.requireMock("@clef-sh/core");
      const runner = makeRunner();
      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/DB_HOST")
        .send({ value: "new-value" });

      expect(res.status).toBe(200);
      expect(mockRecordRotation).toHaveBeenCalledWith(
        expect.stringContaining("database/dev.enc.yaml"),
        ["DB_HOST"],
        expect.stringContaining("clef ui"),
      );
    });

    it("does NOT record a rotation on a random (pending) PUT", async () => {
      const { recordRotation: mockRecordRotation } = jest.requireMock("@clef-sh/core");
      const runner = makeRunner();
      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/PLACEHOLDER_KEY")
        .send({ random: true });

      expect(res.status).toBe(200);
      expect(mockRecordRotation).not.toHaveBeenCalled();
    });

    it("propagates markPendingWithRetry failures so the transaction can roll back", async () => {
      (markPendingWithRetry as jest.Mock).mockRejectedValueOnce(new Error("disk full"));

      const runner = makeRunner();
      const app = createApp(runner);
      const res = await request(app)
        .put("/api/namespace/database/dev/NEW_KEY")
        .send({ random: true });

      // The PUT runs inside tx.run by default. When markPendingWithRetry
      // throws, the error bubbles up out of mutate; the transaction handles
      // the file rollback via git reset. The endpoint surfaces the
      // underlying error message — the old in-method rollback dance with
      // PENDING_FAILURE/PARTIAL_FAILURE codes is gone.
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("disk full");
      expect(res.body.code).toBe("SET_ERROR");
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
    it("should record rotation (accept-as-real) and return success", async () => {
      // Accept is treated as a rotation event: the user is declaring the
      // placeholder value to be the real one, establishing a point-in-time
      // rotation record.  recordRotation strips the matching pending entry
      // internally, so no separate markResolved is needed.
      const { recordRotation: mockRecordRotation } = jest.requireMock("@clef-sh/core");
      const app = createApp();
      const res = await request(app).post("/api/namespace/database/dev/DB_HOST/accept");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockRecordRotation).toHaveBeenCalledWith(
        expect.stringContaining("database/dev.enc.yaml"),
        ["DB_HOST"],
        expect.stringContaining("clef ui"),
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
  describe("schema endpoints", () => {
    const schemaYaml = YAML.stringify({
      keys: {
        API_KEY: { type: "string", required: true, pattern: "^sk_" },
        FLAG: { type: "boolean", required: false },
      },
    });

    /**
     * Build the app with route-aware fs mocks. `createApp` sets blanket
     * `readFileSync`/`existsSync` mocks, so we apply path-routed overrides
     * AFTER it and return both. Tests can further override existsSync to
     * simulate a missing schema file on disk.
     */
    function makeAppWithSchema(opts: { attached: boolean }) {
      const manifest = opts.attached
        ? {
            ...validManifest,
            namespaces: [{ name: "database", description: "DB", schema: "schemas/database.yaml" }],
          }
        : validManifest;
      const manifestYaml = YAML.stringify(manifest);
      const app = createApp();
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const sp = String(p);
        if (sp.endsWith("schemas/database.yaml")) return schemaYaml;
        return manifestYaml;
      });
      mockFs.existsSync.mockReturnValue(true);
      return app;
    }

    describe("GET /api/namespaces/:ns/schema", () => {
      it("returns attached:false with an empty schema when none is wired up", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app).get("/api/namespaces/database/schema");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          namespace: "database",
          attached: false,
          path: null,
          schema: { keys: {} },
        });
      });

      it("returns attached:true with the parsed schema when one is wired up", async () => {
        const app = makeAppWithSchema({ attached: true });
        const res = await request(app).get("/api/namespaces/database/schema");
        expect(res.status).toBe(200);
        expect(res.body.attached).toBe(true);
        expect(res.body.path).toBe("schemas/database.yaml");
        expect(res.body.schema.keys.API_KEY).toMatchObject({
          type: "string",
          required: true,
          pattern: "^sk_",
        });
      });

      it("returns 404 for an unknown namespace", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app).get("/api/namespaces/ghost/schema");
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("NOT_FOUND");
      });

      it("returns 500 when an attached schema file is missing on disk", async () => {
        const app = makeAppWithSchema({ attached: true });
        mockFs.existsSync.mockImplementation(
          (p: fs.PathLike) => !String(p).endsWith("schemas/database.yaml"),
        );
        const res = await request(app).get("/api/namespaces/database/schema");
        expect(res.status).toBe(500);
        expect(res.body.code).toBe("SCHEMA_MISSING");
      });
    });

    describe("PUT /api/namespaces/:ns/schema", () => {
      it("writes the schema and attaches it on first save when none is wired up", async () => {
        const app = makeAppWithSchema({ attached: false });
        const payload = {
          schema: {
            keys: {
              API_KEY: { type: "string", required: true, pattern: "^sk_" },
            },
          },
        };
        const res = await request(app).put("/api/namespaces/database/schema").send(payload);
        expect(res.status).toBe(200);
        expect(res.body.attached).toBe(true);
        expect(res.body.path).toBe("schemas/database.yaml");
        expect(mockWriteSchema).toHaveBeenCalledWith(
          expect.stringContaining("schemas/database.yaml"),
          expect.objectContaining({
            keys: expect.objectContaining({ API_KEY: expect.objectContaining({ type: "string" }) }),
          }),
        );
        expect(mockEditNamespace).toHaveBeenCalledWith(
          "database",
          { schema: "schemas/database.yaml" },
          expect.anything(),
          "/repo",
        );
      });

      it("writes the schema and skips re-attachment when already attached", async () => {
        const app = makeAppWithSchema({ attached: true });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: { FLAG: { type: "boolean", required: false } } },
          });
        expect(res.status).toBe(200);
        expect(mockWriteSchema).toHaveBeenCalledTimes(1);
        expect(mockEditNamespace).not.toHaveBeenCalled();
      });

      it("rejects payloads with an invalid type", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: { K: { type: "float", required: true } } },
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_SCHEMA");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });

      it("rejects payloads with an invalid regex", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: { K: { type: "string", required: true, pattern: "([" } } },
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_SCHEMA");
      });

      it("rejects payloads missing the keys map", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app).put("/api/namespaces/database/schema").send({ schema: {} });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_SCHEMA");
      });

      it("returns 404 for an unknown namespace", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/ghost/schema")
          .send({ schema: { keys: {} } });
        expect(res.status).toBe(404);
      });

      it("respects an explicit body.path on first save", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: {} },
            path: "schemas/custom/db.yaml",
          });
        expect(res.status).toBe(200);
        expect(res.body.path).toBe("schemas/custom/db.yaml");
        expect(mockEditNamespace).toHaveBeenCalledWith(
          "database",
          { schema: "schemas/custom/db.yaml" },
          expect.anything(),
          "/repo",
        );
      });

      it("rejects body.path that escapes the repository root via traversal", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: {} },
            path: "../../../etc/clef-injected.yaml",
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("SCHEMA_PATH_INVALID");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });

      it("rejects body.path that is absolute", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: {} },
            path: "/etc/clef-injected.yaml",
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("SCHEMA_PATH_INVALID");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });

      it("rejects body.path that hides a `..` segment behind a safe-looking prefix", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: {} },
            path: "schemas/../../../etc/clef-injected.yaml",
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("SCHEMA_PATH_INVALID");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });

      it("rejects body.path containing a NUL byte", async () => {
        const app = makeAppWithSchema({ attached: false });
        const res = await request(app)
          .put("/api/namespaces/database/schema")
          .send({
            schema: { keys: {} },
            path: "schemas/db\0.yaml",
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("SCHEMA_PATH_INVALID");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });

      it("rejects a namespace param that does not match the safe identifier pattern", async () => {
        const app = makeAppWithSchema({ attached: false });
        // Uppercase fails the lowercase-only whitelist (clef's own
        // ENV_NAME_PATTERN). The default `schemas/${ns}.yaml` fallback must
        // never be built from a name that hasn't been pattern-checked.
        const res = await request(app)
          .put("/api/namespaces/BadNs/schema")
          .send({ schema: { keys: {} } });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_NAMESPACE");
        expect(mockWriteSchema).not.toHaveBeenCalled();
      });
    });
  });

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

  // GET /api/policy
  describe("GET /api/policy", () => {
    function setupPolicyFs(opts: { policyExists: boolean; policyYaml?: string }): void {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(CLEF_POLICY_FILENAME)) return opts.policyExists;
        return true;
      });
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s.endsWith(CLEF_POLICY_FILENAME)) return opts.policyYaml ?? "";
        return validManifestYaml;
      });
    }

    it("returns built-in default with source: 'default' when policy file is absent", async () => {
      setupPolicyFs({ policyExists: false });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/policy");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("default");
      expect(res.body.path).toBe(CLEF_POLICY_FILENAME);
      expect(res.body.policy.version).toBe(1);
      expect(typeof res.body.rawYaml).toBe("string");
      expect(res.body.rawYaml).toContain("rotation");
    });

    it("returns the parsed file with source: 'file' when .clef/policy.yaml exists", async () => {
      const policyYaml = "version: 1\nrotation:\n  max_age_days: 45\n";
      setupPolicyFs({ policyExists: true, policyYaml });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/policy");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("file");
      expect(res.body.policy.rotation.max_age_days).toBe(45);
    });

    it("returns 422 with POLICY_INVALID when the policy file is malformed", async () => {
      // Schema-invalid policy: missing version field.
      setupPolicyFs({ policyExists: true, policyYaml: "rotation:\n  max_age_days: 30\n" });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/policy");
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("POLICY_INVALID");
    });
  });

  // GET /api/policy/check
  describe("GET /api/policy/check", () => {
    it("returns rotation status, summary, policy, and source", async () => {
      // SopsClient.getMetadata reads cell files via fs.readFileSync directly
      // (not through the runner) when `sops filestatus` exit-codes 1.  Use a
      // per-path mock so manifest reads return manifest YAML and cell reads
      // return a real SOPS-shaped envelope.
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        if (s.endsWith("clef.yaml")) return validManifestYaml;
        if (s.endsWith(CLEF_POLICY_FILENAME)) return ""; // unused — existsSync→true but PolicyParser.load is robust
        return sopsFileContent;
      });
      // Make the policy file appear absent so runCompliance falls back to
      // DEFAULT_POLICY (90-day window).  The 2024-01-15 timestamp on
      // sopsFileContent is well past 90 days from any 2026 wall-clock.
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s.endsWith(CLEF_POLICY_FILENAME)) return false;
        return true;
      });

      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/policy/check");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.files)).toBe(true);
      expect(res.body.summary).toEqual(
        expect.objectContaining({
          total_files: expect.any(Number),
          compliant: expect.any(Number),
          rotation_overdue: expect.any(Number),
          unknown_metadata: expect.any(Number),
        }),
      );
      expect(res.body.policy.version).toBe(1);
      expect(res.body.source).toBe("default");
    });

    it("returns 500 with POLICY_CHECK_ERROR when compliance throws", async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("manifest read failed");
      });
      const app = express();
      app.use(express.json());
      app.use(
        "/api",
        createApiRouter({ runner: makeRunner(), repoRoot: "/repo", sopsPath: "sops" }),
      );

      const res = await request(app).get("/api/policy/check");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("POLICY_CHECK_ERROR");
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

  // ── Manifest structure: namespaces ──────────────────────────────────────

  describe("POST /api/namespaces", () => {
    it("creates a namespace and returns 201", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/namespaces")
        .send({ name: "billing", description: "Billing secrets" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("billing");
      expect(mockAddNamespace).toHaveBeenCalledWith(
        "billing",
        expect.objectContaining({ description: "Billing secrets" }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("returns 400 when name is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/namespaces").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("returns 409 on duplicate namespace name", async () => {
      mockAddNamespace.mockRejectedValueOnce(new Error("Namespace 'billing' already exists."));
      const app = createApp();
      const res = await request(app).post("/api/namespaces").send({ name: "billing" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
    });

    it("returns 400 on invalid identifier", async () => {
      mockAddNamespace.mockRejectedValueOnce(new Error("Invalid namespace name 'has spaces'."));
      const app = createApp();
      const res = await request(app).post("/api/namespaces").send({ name: "has spaces" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });
  });

  describe("PATCH /api/namespaces/:name", () => {
    it("renames a namespace", async () => {
      const app = createApp();
      const res = await request(app).patch("/api/namespaces/database").send({ rename: "billing" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("billing");
      expect(res.body.previousName).toBe("database");
      expect(mockEditNamespace).toHaveBeenCalledWith(
        "database",
        expect.objectContaining({ rename: "billing" }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("updates a description without renaming", async () => {
      const app = createApp();
      const res = await request(app)
        .patch("/api/namespaces/database")
        .send({ description: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.previousName).toBeUndefined();
    });

    it("returns 400 when no edit fields are provided", async () => {
      const app = createApp();
      const res = await request(app).patch("/api/namespaces/database").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
    });

    it("returns 404 when the namespace doesn't exist", async () => {
      mockEditNamespace.mockRejectedValueOnce(new Error("Namespace 'nonexistent' not found."));
      const app = createApp();
      const res = await request(app)
        .patch("/api/namespaces/nonexistent")
        .send({ description: "x" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 409 when the rename target already exists", async () => {
      mockEditNamespace.mockRejectedValueOnce(new Error("Namespace 'billing' already exists."));
      const app = createApp();
      const res = await request(app).patch("/api/namespaces/database").send({ rename: "billing" });
      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /api/namespaces/:name", () => {
    it("removes a namespace", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/namespaces/database");

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockRemoveNamespace).toHaveBeenCalledWith(
        "database",
        expect.any(Object),
        expect.any(String),
      );
    });

    it("returns 412 when removing would orphan a service identity", async () => {
      mockRemoveNamespace.mockRejectedValueOnce(
        new Error(
          "Cannot remove namespace 'database': it is the only scope of service identity 'web-app'.",
        ),
      );
      const app = createApp();
      const res = await request(app).delete("/api/namespaces/database");
      expect(res.status).toBe(412);
      expect(res.body.code).toBe("PRECONDITION_FAILED");
    });

    it("returns 412 when removing the last namespace", async () => {
      mockRemoveNamespace.mockRejectedValueOnce(
        new Error("Cannot remove the last namespace from the manifest."),
      );
      const app = createApp();
      const res = await request(app).delete("/api/namespaces/database");
      expect(res.status).toBe(412);
    });
  });

  // ── Manifest structure: environments ────────────────────────────────────

  describe("POST /api/environments", () => {
    it("creates an environment and returns 201", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/environments")
        .send({ name: "staging", description: "Staging" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("staging");
      expect(res.body.protected).toBe(false);
      expect(mockAddEnvironment).toHaveBeenCalledWith(
        "staging",
        expect.objectContaining({ description: "Staging" }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("creates a protected environment when protected:true", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/environments")
        .send({ name: "canary", protected: true });

      expect(res.status).toBe(201);
      expect(res.body.protected).toBe(true);
    });

    it("returns 400 when name is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/environments").send({});
      expect(res.status).toBe(400);
    });

    it("returns 409 on duplicate env name", async () => {
      mockAddEnvironment.mockRejectedValueOnce(new Error("Environment 'staging' already exists."));
      const app = createApp();
      const res = await request(app).post("/api/environments").send({ name: "staging" });
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /api/environments/:name", () => {
    it("renames an environment", async () => {
      const app = createApp();
      const res = await request(app).patch("/api/environments/dev").send({ rename: "development" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("development");
      expect(res.body.previousName).toBe("dev");
    });

    it("toggles protected via PATCH", async () => {
      const app = createApp();
      const res = await request(app).patch("/api/environments/dev").send({ protected: true });

      expect(res.status).toBe(200);
      expect(mockEditEnvironment).toHaveBeenCalledWith(
        "dev",
        expect.objectContaining({ protected: true }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("returns 400 when no edit fields are provided", async () => {
      const app = createApp();
      const res = await request(app).patch("/api/environments/dev").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/environments/:name", () => {
    it("removes an environment", async () => {
      const app = createApp();
      const res = await request(app).delete("/api/environments/dev");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("returns 412 when the environment is protected", async () => {
      mockRemoveEnvironment.mockRejectedValueOnce(
        new Error("Environment 'production' is protected. Cannot remove a protected environment."),
      );
      const app = createApp();
      const res = await request(app).delete("/api/environments/production");
      expect(res.status).toBe(412);
      expect(res.body.error).toContain("protected");
    });

    it("returns 412 when removing the last environment", async () => {
      mockRemoveEnvironment.mockRejectedValueOnce(
        new Error("Cannot remove the last environment from the manifest."),
      );
      const app = createApp();
      const res = await request(app).delete("/api/environments/dev");
      expect(res.status).toBe(412);
    });
  });

  describe("POST /api/reset", () => {
    it("resets an env scope and returns the result", async () => {
      mockResetReset.mockResolvedValueOnce({
        scaffoldedCells: ["/repo/database/dev.enc.yaml"],
        pendingKeysByCell: {},
        backendChanged: false,
        affectedEnvironments: ["dev"],
      });
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "env", name: "dev" } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.scaffoldedCells).toHaveLength(1);
      expect(res.body.result.affectedEnvironments).toEqual(["dev"]);
      expect(mockResetReset).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { kind: "env", name: "dev" } }),
        expect.any(Object),
        "/repo",
      );
    });

    it("resets a namespace scope", async () => {
      mockResetReset.mockResolvedValueOnce({
        scaffoldedCells: ["/repo/database/dev.enc.yaml", "/repo/database/production.enc.yaml"],
        pendingKeysByCell: {},
        backendChanged: false,
        affectedEnvironments: ["dev", "production"],
      });
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "namespace", name: "database" } });

      expect(res.status).toBe(200);
      expect(res.body.result.scaffoldedCells).toHaveLength(2);
    });

    it("resets a cell scope", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "cell", namespace: "database", environment: "dev" } });

      expect(res.status).toBe(200);
      expect(mockResetReset).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { kind: "cell", namespace: "database", environment: "dev" },
        }),
        expect.any(Object),
        "/repo",
      );
    });

    it("passes optional backend + key + keys through to ResetManager", async () => {
      const app = createApp();
      await request(app)
        .post("/api/reset")
        .send({
          scope: { kind: "env", name: "dev" },
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
          keys: ["DB_URL", "DB_PASSWORD"],
        });

      expect(mockResetReset).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
          keys: ["DB_URL", "DB_PASSWORD"],
        }),
        expect.any(Object),
        "/repo",
      );
    });

    it("returns 400 when scope is missing", async () => {
      const app = createApp();
      const res = await request(app).post("/api/reset").send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
      expect(mockResetReset).not.toHaveBeenCalled();
    });

    it("returns 400 when scope is malformed", async () => {
      const app = createApp();
      const res = await request(app).post("/api/reset").send({ scope: "env" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
      expect(mockResetReset).not.toHaveBeenCalled();
    });

    it("returns 404 when scope references an unknown environment", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "env", name: "nonexistent" } });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.error).toContain("Environment 'nonexistent' not found");
      expect(mockResetReset).not.toHaveBeenCalled();
    });

    it("returns 404 when scope references an unknown namespace", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "namespace", name: "nope" } });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(mockResetReset).not.toHaveBeenCalled();
    });

    it("returns 400 when ResetManager throws a user-error message", async () => {
      mockResetReset.mockRejectedValueOnce(
        new Error("Backend 'awskms' requires a key. Pass --key <keyId>."),
      );
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "env", name: "dev" }, backend: "awskms" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
      expect(res.body.error).toContain("requires a key");
    });

    it("returns 400 when scope matches zero cells", async () => {
      mockResetReset.mockRejectedValueOnce(
        new Error("Reset scope env dev matches zero cells. Check the scope name."),
      );
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "env", name: "dev" } });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("BAD_REQUEST");
      expect(res.body.error).toContain("matches zero cells");
    });

    it("returns 500 with RESET_ERROR on unexpected failure", async () => {
      mockResetReset.mockRejectedValueOnce(new Error("git lock contention"));
      const app = createApp();
      const res = await request(app)
        .post("/api/reset")
        .send({ scope: { kind: "env", name: "dev" } });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("RESET_ERROR");
      expect(res.body.error).toContain("git lock contention");
    });
  });

  describe("POST /api/sync/preview", () => {
    it("returns plan for a valid namespace", async () => {
      const app = createApp();
      const res = await request(app).post("/api/sync/preview").send({ namespace: "database" });

      expect(res.status).toBe(200);
      expect(res.body.totalKeys).toBe(1);
      expect(res.body.cells).toHaveLength(1);
      expect(mockSyncPlan).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        namespace: "database",
      });
    });

    it("returns 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).post("/api/sync/preview").send({ namespace: "nope" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns plan for all namespaces when no namespace provided", async () => {
      const app = createApp();
      const res = await request(app).post("/api/sync/preview").send({});

      expect(res.status).toBe(200);
      expect(mockSyncPlan).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        namespace: undefined,
      });
    });
  });

  describe("POST /api/sync", () => {
    it("executes sync and returns result", async () => {
      const app = createApp();
      const res = await request(app).post("/api/sync").send({ namespace: "database" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.totalKeysScaffolded).toBe(1);
      expect(mockSyncSync).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        namespace: "database",
      });
    });

    it("returns 404 for unknown namespace", async () => {
      const app = createApp();
      const res = await request(app).post("/api/sync").send({ namespace: "nope" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 500 on sync failure", async () => {
      mockSyncSync.mockRejectedValueOnce(new Error("transaction failed"));
      const app = createApp();
      const res = await request(app).post("/api/sync").send({ namespace: "database" });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("SYNC_ERROR");
      expect(res.body.error).toContain("transaction failed");
    });
  });
});
