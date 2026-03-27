import * as fs from "fs";
import {
  ClefManifest,
  ClefReport,
  CLEF_REPORT_SCHEMA_VERSION,
  EncryptionBackend,
  MatrixCell,
  SubprocessRunner,
} from "../types";
import { MatrixManager } from "../matrix/manager";
import { SchemaValidator } from "../schema/validator";
import { getPendingKeys } from "../pending/metadata";
import { checkDependency } from "../dependencies/checker";
import { ManifestParser } from "../manifest/parser";
import { LintRunner } from "../lint/runner";
import { ReportGenerator } from "./generator";

jest.mock("fs");
jest.mock("../manifest/parser");
jest.mock("../lint/runner");
jest.mock("../pending/metadata");
jest.mock("../dependencies/checker");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetPendingKeys = jest.mocked(getPendingKeys);
const mockCheckDependency = jest.mocked(checkDependency);
const mockManifestParserCtor = jest.mocked(ManifestParser);
const mockLintRunnerCtor = jest.mocked(LintRunner);

const validManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev", protected: false },
    { name: "prod", description: "Prod", protected: true },
  ],
  namespaces: [
    { name: "database", description: "DB", schema: "schemas/database.yaml", owners: ["alice"] },
    { name: "app", description: "App" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

function makeRunner(overrides?: Record<string, string>): jest.Mocked<SubprocessRunner> {
  return {
    run: jest.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      const key = args.join(" ");
      const val = overrides?.[key];
      if (val !== undefined) return { stdout: val, stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeSopsClient(): jest.Mocked<EncryptionBackend> {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn().mockResolvedValue({
      backend: "age",
      recipients: ["age1abc123"],
      lastModified: new Date("2024-01-15T10:00:00.000Z"),
    }),
  };
}

function makeMatrixManager(cells: MatrixCell[]): jest.Mocked<MatrixManager> {
  return {
    resolveMatrix: jest.fn().mockReturnValue(cells),
    detectMissingCells: jest.fn(),
    scaffoldCell: jest.fn(),
    getMatrixStatus: jest.fn(),
    isProtectedEnvironment: jest.fn(),
  } as unknown as jest.Mocked<MatrixManager>;
}

function makeSchemaValidator(): jest.Mocked<SchemaValidator> {
  return {
    loadSchema: jest.fn(),
    validate: jest.fn(),
  } as unknown as jest.Mocked<SchemaValidator>;
}

const existingCell = (ns: string, env: string): MatrixCell => ({
  namespace: ns,
  environment: env,
  filePath: `/${ns}/${env}.enc.yaml`,
  exists: true,
});

const missingCell = (ns: string, env: string): MatrixCell => ({
  namespace: ns,
  environment: env,
  filePath: `/${ns}/${env}.enc.yaml`,
  exists: false,
});

describe("ReportGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // ManifestParser mock
    mockManifestParserCtor.mockImplementation(
      () => ({ parse: jest.fn().mockReturnValue(validManifest) }) as unknown as ManifestParser,
    );

    // LintRunner mock
    mockLintRunnerCtor.mockImplementation(
      () =>
        ({
          run: jest.fn().mockResolvedValue({ issues: [], fileCount: 0, pendingCount: 0 }),
        }) as unknown as LintRunner,
    );

    mockGetPendingKeys.mockResolvedValue([]);
    mockCheckDependency.mockResolvedValue({
      installed: "3.9.4",
      required: "3.8.0",
      satisfied: true,
      installHint: "",
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      "key1: ENC[AES256_GCM]\nkey2: ENC[AES256_GCM]\nsops:\n  version: 3.9.4\n",
    );
  });

  it("happy path — all sections populated correctly", async () => {
    const runner = makeRunner({
      "remote get-url origin": "git@github.com:org/my-repo.git",
      "rev-parse HEAD": "abc1234567890abcdef",
      "branch --show-current": "main",
      "log -1 --format=%cI": "2024-01-15T10:00:00+00:00",
    });
    const cells = [existingCell("database", "dev")];
    const generator = new ReportGenerator(
      runner,
      makeSopsClient(),
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report: ClefReport = await generator.generate("/repo", "1.2.3");

    expect(report.schemaVersion).toBe(CLEF_REPORT_SCHEMA_VERSION);
    expect(report.repoIdentity.repoOrigin).toBe("github.com/org/my-repo");
    expect(report.repoIdentity.commitSha).toBe("abc1234567890abcdef");
    expect(report.repoIdentity.branch).toBe("main");
    expect(report.repoIdentity.clefVersion).toBe("1.2.3");
    expect(report.repoIdentity.sopsVersion).toBe("3.9.4");
    expect(report.manifest.manifestVersion).toBe(1);
    expect(report.manifest.environments).toHaveLength(2);
    expect(report.manifest.namespaces).toHaveLength(2);
    expect(report.matrix).toHaveLength(1);
    expect(report.matrix[0].exists).toBe(true);
    expect(report.matrix[0].keyCount).toBe(2);
  });

  it("git command failures fall back to empty strings", async () => {
    const runner: jest.Mocked<SubprocessRunner> = {
      run: jest.fn().mockRejectedValue(new Error("git not found")),
    };
    mockCheckDependency.mockRejectedValue(new Error("sops not found"));
    const generator = new ReportGenerator(
      runner,
      makeSopsClient(),
      makeMatrixManager([]),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.repoIdentity.repoOrigin).toBe("");
    expect(report.repoIdentity.commitSha).toBe("");
    expect(report.repoIdentity.branch).toBe("");
    expect(report.repoIdentity.sopsVersion).toBeNull();
  });

  it("SOPS metadata failure results in null metadata for that cell", async () => {
    const sopsClient = makeSopsClient();
    sopsClient.getMetadata.mockRejectedValue(new Error("metadata error"));
    const cells = [existingCell("database", "dev")];
    const generator = new ReportGenerator(
      makeRunner(),
      sopsClient,
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.matrix[0].metadata).toBeNull();
    expect(report.matrix[0].exists).toBe(true);
  });

  it("namespace filter excludes non-matching cells", async () => {
    const cells = [existingCell("database", "dev"), existingCell("app", "dev")];
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0", { namespaceFilter: ["database"] });

    expect(report.matrix).toHaveLength(1);
    expect(report.matrix[0].namespace).toBe("database");
  });

  it("environment filter excludes non-matching cells", async () => {
    const cells = [existingCell("database", "dev"), existingCell("database", "prod")];
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0", { environmentFilter: ["prod"] });

    expect(report.matrix).toHaveLength(1);
    expect(report.matrix[0].environment).toBe("prod");
  });

  it("policy issues pass through sanitizer — no key names in output", async () => {
    mockLintRunnerCtor.mockImplementation(
      () =>
        ({
          run: jest.fn().mockResolvedValue({
            issues: [
              {
                severity: "error",
                category: "schema",
                file: "/database/dev.enc.yaml",
                key: "SECRET_PASSWORD",
                message: "Required key SECRET_PASSWORD is missing.",
              },
            ],
            fileCount: 1,
            pendingCount: 0,
          }),
        }) as unknown as LintRunner,
    );
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager([existingCell("database", "dev")]),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.policy.issueCount.error).toBe(1);
    for (const issue of report.policy.issues) {
      expect(issue.message).not.toContain("SECRET_PASSWORD");
      expect((issue as { key?: string }).key).toBeUndefined();
    }
  });

  it("recipient summary aggregates across cells", async () => {
    const sopsClient = makeSopsClient();
    sopsClient.getMetadata
      .mockResolvedValueOnce({
        backend: "age",
        recipients: ["age1abc", "age1shared"],
        lastModified: new Date(),
      })
      .mockResolvedValueOnce({
        backend: "age",
        recipients: ["age1xyz", "age1shared"],
        lastModified: new Date(),
      });
    const cells = [existingCell("db", "dev"), existingCell("db", "prod")];
    const generator = new ReportGenerator(
      makeRunner(),
      sopsClient,
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.recipients["age1shared"]).toBeDefined();
    expect(report.recipients["age1shared"].fileCount).toBe(2);
    expect(report.recipients["age1abc"].fileCount).toBe(1);
  });

  it("sets schemaVersion to CLEF_REPORT_SCHEMA_VERSION", async () => {
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager([]),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.schemaVersion).toBe(CLEF_REPORT_SCHEMA_VERSION);
  });

  it("maps hasSchema, owners, and protected flag correctly", async () => {
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager([]),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    const dbNs = report.manifest.namespaces.find((n) => n.name === "database");
    expect(dbNs?.hasSchema).toBe(true);
    expect(dbNs?.owners).toEqual(["alice"]);

    const appNs = report.manifest.namespaces.find((n) => n.name === "app");
    expect(appNs?.hasSchema).toBe(false);
    expect(appNs?.owners).toEqual([]);

    const prodEnv = report.manifest.environments.find((e) => e.name === "prod");
    expect(prodEnv?.protected).toBe(true);
  });

  it("readKeyCount returns 0 for missing files", async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    const cells = [existingCell("database", "dev")];
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.matrix[0].keyCount).toBe(0);
  });

  it("non-existing cells get keyCount=0 and metadata=null", async () => {
    const cells = [missingCell("database", "dev")];
    const generator = new ReportGenerator(
      makeRunner(),
      makeSopsClient(),
      makeMatrixManager(cells),
      makeSchemaValidator(),
    );

    const report = await generator.generate("/repo", "1.0.0");

    expect(report.matrix[0].exists).toBe(false);
    expect(report.matrix[0].keyCount).toBe(0);
    expect(report.matrix[0].metadata).toBeNull();
  });
});
