import { LintRunner } from "./runner";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { SopsClient } from "../sops/client";
import { ClefManifest, MatrixCell } from "../types";

jest.mock("fs");
jest.mock("../pending/metadata", () => ({
  getPendingKeys: jest.fn().mockResolvedValue([]),
}));

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
  let sopsClient: SopsClient;
  let runner: LintRunner;

  beforeEach(() => {
    jest.clearAllMocks();

    matrixManager = new MatrixManager();
    schemaValidator = new SchemaValidator();
    sopsClient = {} as SopsClient;
    runner = new LintRunner(matrixManager, schemaValidator, sopsClient);
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(false);

      const result = await runner.run(testManifest(), "/repo");

      const sopsErrors = result.issues.filter(
        (i) => i.category === "sops" && i.severity === "error",
      );
      expect(sopsErrors.length).toBe(4);
    });

    it("should report schema validation errors", async () => {
      const cells = [allExistCells()[0]]; // Just database/dev
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockImplementation(async (filePath: string) => {
        if (filePath.includes("dev")) {
          return {
            values: { DB_URL: "x", EXTRA: "y" },
            metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
          };
        }
        return {
          values: { DB_URL: "x" },
          metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
        };
      });

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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() is necessary to access the Jest mock after jest.mock()
      const { getPendingKeys } = require("../pending/metadata");
      (getPendingKeys as jest.Mock).mockResolvedValueOnce(["SECRET_KEY"]);

      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
        values: { SECRET_KEY: "placeholder" },
        metadata: { backend: "age", recipients: ["a", "b"], lastModified: new Date() },
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockRejectedValue(new Error("Cannot decrypt"));

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

      sopsClient.validateEncryption = jest.fn().mockRejectedValue(new Error("File corrupt"));

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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

    it("should handle schema load failures gracefully", async () => {
      const cells = [allExistCells()[0]];
      jest.spyOn(matrixManager, "resolveMatrix").mockReturnValue(cells);

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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
    it("should scaffold missing files and re-run lint", async () => {
      const missingCell: MatrixCell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      };

      jest.spyOn(matrixManager, "detectMissingCells").mockReturnValue([missingCell]);
      jest.spyOn(matrixManager, "scaffoldCell").mockResolvedValue(undefined);

      // After fix, resolveMatrix returns all existing
      jest
        .spyOn(matrixManager, "resolveMatrix")
        .mockReturnValue([{ ...missingCell, exists: true }]);

      sopsClient.validateEncryption = jest.fn().mockResolvedValue(true);
      sopsClient.decrypt = jest.fn().mockResolvedValue({
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

      expect(matrixManager.scaffoldCell).toHaveBeenCalledWith(
        missingCell,
        sopsClient,
        testManifest(),
      );
      expect(result.fileCount).toBe(1);
    });
  });
});
