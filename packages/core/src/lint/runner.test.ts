import { LintRunner } from "./runner";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { ClefManifest, MatrixCell } from "../types";
import type { CellPendingMetadata, Lintable, SecretSource } from "../source/types";

jest.mock("fs");

interface SourceMock extends SecretSource, Lintable {
  validateEncryption: jest.Mock;
  readCell: jest.Mock;
  getCellMetadata: jest.Mock;
  getPendingMetadata: jest.Mock;
  listKeys: jest.Mock;
  scaffoldCell: jest.Mock;
}

function makeSource(): SourceMock {
  const stub = jest.fn();
  return {
    id: "mock",
    description: "mock",
    readCell: jest.fn(),
    writeCell: stub,
    deleteCell: stub,
    cellExists: stub,
    listKeys: jest.fn().mockResolvedValue([]),
    scaffoldCell: jest.fn().mockResolvedValue(undefined),
    getCellMetadata: jest.fn(),
    getPendingMetadata: jest
      .fn()
      .mockResolvedValue({ version: 1, pending: [], rotations: [] } as CellPendingMetadata),
    markPending: stub,
    markResolved: stub,
    recordRotation: stub,
    removeRotation: stub,
    validateEncryption: jest.fn().mockResolvedValue(true),
    checkRecipientDrift: stub,
  } as unknown as SourceMock;
}

function testManifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Dev" },
      { name: "production", description: "Prod" },
    ],
    namespaces: [
      { name: "database", description: "DB", schema: "schemas/database.yaml" },
      { name: "auth", description: "Auth" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

function allExistCells(): MatrixCell[] {
  return [
    {
      namespace: "database",
      environment: "dev",
      filePath: "/repo/database/dev.enc.yaml",
      exists: true,
    },
    {
      namespace: "database",
      environment: "production",
      filePath: "/repo/database/production.enc.yaml",
      exists: true,
    },
    {
      namespace: "auth",
      environment: "dev",
      filePath: "/repo/auth/dev.enc.yaml",
      exists: true,
    },
    {
      namespace: "auth",
      environment: "production",
      filePath: "/repo/auth/production.enc.yaml",
      exists: true,
    },
  ];
}

describe("LintRunner", () => {
  let matrixManager: MatrixManager;
  let schemaValidator: SchemaValidator;
  let source: SourceMock;
  let runner: LintRunner;

  beforeEach(() => {
    jest.clearAllMocks();

    matrixManager = new MatrixManager();
    schemaValidator = new SchemaValidator();
    source = makeSource();
    runner = new LintRunner(matrixManager, schemaValidator, source);
  });

  describe("run", () => {
    it("should report missing matrix files as errors", async () => {
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue([
        {
          namespace: "database",
          environment: "dev",
          filePath: "/repo/database/dev.enc.yaml",
          exists: false,
        },
      ]);

      const result = await runner.run(testManifest(), "/repo");

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe("error");
      expect(result.issues[0].category).toBe("matrix");
      expect(result.issues[0].fixCommand).toBe("clef init");
    });

    it("should report SOPS validation failures", async () => {
      const cells = allExistCells();
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.validateEncryption.mockResolvedValue(false);

      const result = await runner.run(testManifest(), "/repo");

      const sopsErrors = result.issues.filter(
        (i) => i.category === "sops" && i.severity === "error",
      );
      expect(sopsErrors.length).toBe(4);
    });

    it("should report schema validation errors", async () => {
      const cells = [allExistCells()[0]]; // Just database/dev
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { DATABASE_URL: "mysql://bad" },
        metadata: {
          backend: "age",
          recipients: ["age1test", "age1test2"],
          lastModified: new Date(),
        },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: {
          DATABASE_URL: { type: "string", required: true, pattern: "^postgres://" },
          DATABASE_SSL: { type: "boolean", required: true },
        },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: false,
        errors: [
          { key: "DATABASE_URL", message: "Pattern mismatch", rule: "pattern" },
          { key: "DATABASE_SSL", message: "Required key missing", rule: "required" },
        ],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");

      const schemaErrors = result.issues.filter((i) => i.category === "schema");
      expect(schemaErrors.length).toBe(2);
      expect(schemaErrors.every((e) => e.severity === "error")).toBe(true);
    });

    it("should report schema warnings for undeclared keys", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { DB_URL: "postgres://x", EXTRA: "val" },
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { DB_URL: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [{ key: "EXTRA", message: "Undeclared key", rule: "undeclared" }],
      });

      const result = await runner.run(testManifest(), "/repo");

      const schemaWarnings = result.issues.filter(
        (i) => i.category === "schema" && i.severity === "warning",
      );
      expect(schemaWarnings.length).toBe(1);
    });

    it("should report info for namespaces without schemas", async () => {
      const cells = [allExistCells()[2]]; // auth/dev — no schema
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { AUTH_KEY: "secret" },
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });

      const result = await runner.run(testManifest(), "/repo");

      const infoIssues = result.issues.filter(
        (i) => i.severity === "info" && i.category === "schema",
      );
      expect(infoIssues.length).toBe(1);
      expect(infoIssues[0].key).toBe("AUTH_KEY");
    });

    it("should detect cross-environment key drift", async () => {
      const cells = [allExistCells()[0], allExistCells()[1]]; // database dev + production
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockImplementation(
        async (ref: { namespace: string; environment: string }) => {
          if (ref.environment === "dev") {
            return {
              values: { DB_URL: "x", EXTRA: "y" },
              metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
            };
          }
          return {
            values: { DB_URL: "x" },
            metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
          };
        },
      );

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { DB_URL: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");

      const driftWarnings = result.issues.filter(
        (i) => i.category === "matrix" && i.severity === "warning",
      );
      expect(driftWarnings.length).toBe(1);
      expect(driftWarnings[0].key).toBe("EXTRA");
      expect(driftWarnings[0].message).toContain("production");
    });

    it("should report single-recipient files as info", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["only-one"], lastModified: new Date() },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { KEY: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");

      const sopsInfo = result.issues.filter((i) => i.category === "sops" && i.severity === "info");
      expect(sopsInfo.length).toBe(1);
      expect(sopsInfo[0].message).toContain("1 recipient");
    });

    it("should report pending placeholder keys as warnings", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { SECRET_KEY: "placeholder" },
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });
      source.getPendingMetadata.mockResolvedValue({
        version: 1,
        pending: [{ key: "SECRET_KEY", since: new Date(), setBy: "alice" }],
        rotations: [],
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { SECRET_KEY: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");

      const pendingWarnings = result.issues.filter(
        (i) =>
          i.category === "schema" && i.severity === "warning" && i.message.includes("placeholder"),
      );
      expect(pendingWarnings.length).toBe(1);
      expect(pendingWarnings[0].key).toBe("SECRET_KEY");
      expect(pendingWarnings[0].fixCommand).toContain("clef set");
    });

    it("should handle decrypt errors gracefully", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockRejectedValue(new Error("Cannot decrypt"));

      const result = await runner.run(testManifest(), "/repo");

      const sopsErrors = result.issues.filter(
        (i) => i.category === "sops" && i.severity === "error",
      );
      expect(sopsErrors.length).toBe(1);
      expect(sopsErrors[0].message).toContain("decrypt");
    });

    it("should handle validateEncryption throwing errors", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.validateEncryption.mockRejectedValue(new Error("File corrupt"));

      const result = await runner.run(testManifest(), "/repo");

      const sopsErrors = result.issues.filter(
        (i) => i.category === "sops" && i.severity === "error",
      );
      expect(sopsErrors.length).toBe(1);
      expect(sopsErrors[0].message).toContain("corrupted");
    });

    it("should report correct fileCount", async () => {
      const cells = allExistCells();
      cells.push({
        namespace: "missing",
        environment: "dev",
        filePath: "/repo/missing/dev.enc.yaml",
        exists: false,
      });
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: {},
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");
      expect(result.fileCount).toBe(5); // 4 existing + 1 missing
    });

    it("should detect missing per-env recipients in encrypted file", async () => {
      const manifest = testManifest();
      manifest.environments[1].recipients = [
        "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
        "age1deadgyu9nk64as3xhfmz05u94lef3nym6hvqntrrmyzpq28pjxdqs5gfng",
      ];

      const cells = [allExistCells()[1]]; // database/production
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { KEY: "val" },
        metadata: {
          backend: "age",
          recipients: ["age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"],
          lastModified: new Date(),
        },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { KEY: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(manifest, "/repo");

      const driftWarnings = result.issues.filter(
        (i) => i.category === "sops" && i.severity === "warning" && i.message.includes("missing"),
      );
      expect(driftWarnings.length).toBe(1);
      expect(driftWarnings[0].message).toContain("missing from encrypted file");
      expect(driftWarnings[0].fixCommand).toContain("-e production");
    });

    it("should detect unexpected recipients in encrypted file", async () => {
      const manifest = testManifest();
      manifest.environments[1].recipients = [
        "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
      ];

      const cells = [allExistCells()[1]]; // database/production
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { KEY: "val" },
        metadata: {
          backend: "age",
          recipients: [
            "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
            "age1deadgyu9nk64as3xhfmz05u94lef3nym6hvqntrrmyzpq28pjxdqs5gfng",
          ],
          lastModified: new Date(),
        },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { KEY: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(manifest, "/repo");

      const unexpectedWarnings = result.issues.filter(
        (i) =>
          i.category === "sops" && i.severity === "warning" && i.message.includes("Unexpected"),
      );
      expect(unexpectedWarnings.length).toBe(1);
      expect(unexpectedWarnings[0].fixCommand).toContain("clef recipients remove");
      expect(unexpectedWarnings[0].fixCommand).toContain("-e production");
    });

    it("should not check per-env recipient drift when no per-env recipients defined", async () => {
      const cells = [allExistCells()[0]]; // database/dev — no per-env recipients
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { KEY: "val" },
        metadata: {
          backend: "age",
          recipients: ["age1somekeyhere12345"],
          lastModified: new Date(),
        },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: { KEY: { type: "string", required: true } },
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.run(testManifest(), "/repo");

      const recipientDrift = result.issues.filter(
        (i) =>
          i.category === "sops" &&
          i.severity === "warning" &&
          (i.message.includes("missing from encrypted") || i.message.includes("Unexpected")),
      );
      expect(recipientDrift.length).toBe(0);
    });

    describe("service identity drift", () => {
      it("should detect missing environment on service identity", async () => {
        const manifest = testManifest();
        manifest.service_identities = [
          {
            name: "api-gw",
            description: "API gateway",
            namespaces: ["database"],
            environments: {
              dev: { recipient: "age1testrecipientkey" },
              // production missing
            },
          },
        ];

        const cells = allExistCells();
        jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);
        source.readCell.mockResolvedValue({
          values: { KEY: "val" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        });
        jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
        jest.spyOn(schemaValidator, "validate").mockReturnValue({
          valid: true,
          errors: [],
          warnings: [],
        });
        source.getCellMetadata.mockResolvedValue({
          backend: "age",
          recipients: ["age1testrecipientkey"],
          lastModified: new Date(),
        });

        const result = await runner.run(manifest, "/repo");

        const driftIssues = result.issues.filter(
          (i) =>
            i.category === "service-identity" && i.message.includes("no config for environment"),
        );
        expect(driftIssues.length).toBe(1);
        expect(driftIssues[0].message).toContain("production");
        expect(driftIssues[0].message).toContain("clef service add-env");
      });

      it("should detect unknown namespace reference", async () => {
        const manifest = testManifest();
        manifest.service_identities = [
          {
            name: "api-gw",
            description: "API gateway",
            namespaces: ["nonexistent"],
            environments: {
              dev: { recipient: "age1testrecipientkey" },
              production: { recipient: "age1testrecipientkey2" },
            },
          },
        ];

        const cells = allExistCells();
        jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);
        source.readCell.mockResolvedValue({
          values: { KEY: "val" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        });
        jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
        jest.spyOn(schemaValidator, "validate").mockReturnValue({
          valid: true,
          errors: [],
          warnings: [],
        });
        source.getCellMetadata.mockResolvedValue({
          backend: "age",
          recipients: [],
          lastModified: new Date(),
        });

        const result = await runner.run(manifest, "/repo");

        const nsIssues = result.issues.filter(
          (i) => i.category === "service-identity" && i.message.includes("non-existent namespace"),
        );
        expect(nsIssues.length).toBe(1);
        expect(nsIssues[0].message).toContain("nonexistent");
      });

      it("should detect unregistered recipient", async () => {
        const manifest = testManifest();
        manifest.service_identities = [
          {
            name: "api-gw",
            description: "API gateway",
            namespaces: ["database"],
            environments: {
              dev: { recipient: "age1testrecipientkey" },
              production: { recipient: "age1testrecipientkey2" },
            },
          },
        ];

        const cells = allExistCells();
        jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);
        source.readCell.mockResolvedValue({
          values: { KEY: "val" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        });
        jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
        jest.spyOn(schemaValidator, "validate").mockReturnValue({
          valid: true,
          errors: [],
          warnings: [],
        });
        source.getCellMetadata.mockResolvedValue({
          backend: "age",
          recipients: ["some-other-key"],
          lastModified: new Date(),
        });

        const result = await runner.run(manifest, "/repo");

        const recipientIssues = result.issues.filter(
          (i) =>
            i.category === "service-identity" && i.message.includes("recipient is not registered"),
        );
        expect(recipientIssues.length).toBeGreaterThan(0);
      });

      it("should detect scope mismatch", async () => {
        const manifest = testManifest();
        manifest.service_identities = [
          {
            name: "api-gw",
            description: "API gateway",
            namespaces: ["database"],
            environments: {
              dev: { recipient: "age1testrecipientkey" },
              production: { recipient: "age1testrecipientkey2" },
            },
          },
        ];

        const cells = allExistCells();
        jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);
        source.readCell.mockResolvedValue({
          values: { KEY: "val" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        });
        jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
        jest.spyOn(schemaValidator, "validate").mockReturnValue({
          valid: true,
          errors: [],
          warnings: [],
        });
        // Every cell carries the dev recipient — auth (out-of-scope) gets
        // flagged as "in scope mismatch" against the same recipient.
        source.getCellMetadata.mockResolvedValue({
          backend: "age",
          recipients: ["age1testrecipientkey"],
          lastModified: new Date(),
        });

        const result = await runner.run(manifest, "/repo");

        const scopeIssues = result.issues.filter(
          (i) => i.category === "service-identity" && i.message.includes("not in scope"),
        );
        expect(scopeIssues.length).toBeGreaterThan(0);
      });

      it("should report no issues when identities are valid", async () => {
        const manifest = testManifest();
        manifest.service_identities = [
          {
            name: "api-gw",
            description: "API gateway",
            namespaces: ["database"],
            environments: {
              dev: { recipient: "age1testrecipientkey" },
              production: { recipient: "age1testrecipientkey2" },
            },
          },
        ];

        const cells = allExistCells();
        jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);
        source.readCell.mockResolvedValue({
          values: { KEY: "val" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        });
        jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({ keys: {} });
        jest.spyOn(schemaValidator, "validate").mockReturnValue({
          valid: true,
          errors: [],
          warnings: [],
        });
        source.getCellMetadata.mockImplementation(
          async (ref: { namespace: string; environment: string }) => {
            if (ref.namespace === "database" && ref.environment === "dev") {
              return {
                backend: "age",
                recipients: ["age1testrecipientkey"],
                lastModified: new Date(),
              };
            }
            if (ref.namespace === "database" && ref.environment === "production") {
              return {
                backend: "age",
                recipients: ["age1testrecipientkey2"],
                lastModified: new Date(),
              };
            }
            // auth namespace — not in scope, no identity recipients
            return {
              backend: "age",
              recipients: ["some-other-key"],
              lastModified: new Date(),
            };
          },
        );

        const result = await runner.run(manifest, "/repo");

        const siIssues = result.issues.filter((i) => i.category === "service-identity");
        expect(siIssues.length).toBe(0);
      });
    });

    it("should handle schema load failures gracefully", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      source.readCell.mockResolvedValue({
        values: { KEY: "val" },
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockImplementation(() => {
        throw new Error("File not found");
      });

      const result = await runner.run(testManifest(), "/repo");

      const schemaWarnings = result.issues.filter(
        (i) => i.category === "schema" && i.severity === "warning",
      );
      expect(schemaWarnings.some((w) => w.message.includes("Could not load schema"))).toBe(true);
    });
  });

  describe("fix", () => {
    it("should scaffold missing files via the source and re-run lint", async () => {
      const missingCell: MatrixCell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      };

      jest.spyOn(matrixManager, "detectMissingCells").mockReturnValue([missingCell]);
      jest
        .spyOn(matrixManager, "resolveMatrix")
        .mockReturnValue([{ ...missingCell, exists: true }]);

      source.readCell.mockResolvedValue({
        values: {},
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });

      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue({
        keys: {},
      });
      jest.spyOn(schemaValidator, "validate").mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await runner.fix(testManifest(), "/repo");

      expect(source.scaffoldCell).toHaveBeenCalledWith(
        { namespace: "database", environment: "dev" },
        testManifest(),
      );
      expect(result.fileCount).toBe(1);
    });
  });

  describe("metadata consistency (.clef-meta.yaml)", () => {
    function cellAt(p: string): MatrixCell {
      return { namespace: "database", environment: "dev", filePath: p, exists: true };
    }

    beforeEach(() => {
      // Every cell decrypts + validates cleanly; individual tests
      // override listKeys / getPendingMetadata to drive the assertion.
      source.readCell.mockResolvedValue({
        values: {},
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
      });
      jest.spyOn(schemaValidator, "loadSchema").mockReturnValue(undefined as never);
    });

    it("reports a warning for an orphan rotation record (key not in cipher)", async () => {
      const cell = cellAt("/repo/database/dev.enc.yaml");
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue([cell]);

      source.listKeys.mockResolvedValue(["LIVE_KEY"]);
      source.getPendingMetadata.mockResolvedValue({
        version: 1,
        pending: [],
        rotations: [
          {
            key: "DELETED_KEY", // no longer in the cipher
            lastRotatedAt: new Date("2026-01-01"),
            rotatedBy: "alice",
            rotationCount: 3,
          },
          {
            key: "LIVE_KEY",
            lastRotatedAt: new Date("2026-04-01"),
            rotatedBy: "alice",
            rotationCount: 1,
          },
        ],
      });

      const result = await runner.run(testManifest(), "/repo");
      const orphan = result.issues.find(
        (i) => i.category === "metadata" && i.key === "DELETED_KEY",
      );
      expect(orphan).toBeDefined();
      expect(orphan?.severity).toBe("warning");
      expect(orphan?.message).toMatch(/not in this cell/);
    });

    it("reports an error for dual-state (key in both pending and rotations)", async () => {
      const cell = cellAt("/repo/database/dev.enc.yaml");
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue([cell]);

      source.listKeys.mockResolvedValue(["CORRUPT_KEY"]);
      source.getPendingMetadata.mockResolvedValue({
        version: 1,
        pending: [{ key: "CORRUPT_KEY", since: new Date(), setBy: "alice" }],
        rotations: [
          {
            key: "CORRUPT_KEY",
            lastRotatedAt: new Date(),
            rotatedBy: "bob",
            rotationCount: 1,
          },
        ],
      });

      const result = await runner.run(testManifest(), "/repo");
      const dual = result.issues.find((i) => i.category === "metadata" && i.key === "CORRUPT_KEY");
      expect(dual).toBeDefined();
      expect(dual?.severity).toBe("error");
      expect(dual?.fixCommand).toContain("clef set");
    });

    it("skips the metadata check when listKeys throws (substrate I/O failure)", async () => {
      const cell = cellAt("/repo/database/dev.enc.yaml");
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue([cell]);

      source.listKeys.mockRejectedValue(new Error("read failed"));
      source.getPendingMetadata.mockResolvedValue({
        version: 1,
        pending: [],
        rotations: [
          {
            key: "WHATEVER",
            lastRotatedAt: new Date(),
            rotatedBy: "alice",
            rotationCount: 1,
          },
        ],
      });

      const result = await runner.run(testManifest(), "/repo");
      const metadataIssues = result.issues.filter((i) => i.category === "metadata");
      expect(metadataIssues).toEqual([]);
    });
  });
});
