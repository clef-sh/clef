import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerReportCommand } from "./report";
import { SubprocessRunner, ClefReport, SopsMissingError, CloudApiError } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    hint: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    table: jest.fn(),
    confirm: jest.fn(),
    secretPrompt: jest.fn(),
    formatDependencyError: jest.fn(),
  },
}));

const mockGenerate = jest.fn<Promise<ClefReport>, []>();
const mockFetchIntegration = jest.fn();
const mockSubmitReport = jest.fn();
const mockSubmitBatchReports = jest.fn();
const mockTransform = jest.fn();
const mockGenerateReportAtCommit = jest.fn();
const mockListCommitRange = jest.fn();
const mockGetHeadSha = jest.fn();
const mockCollectCIContext = jest.fn();

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ReportGenerator: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
    CloudClient: jest.fn().mockImplementation(() => ({
      fetchIntegration: mockFetchIntegration,
      submitReport: mockSubmitReport,
      submitBatchReports: mockSubmitBatchReports,
    })),
    ReportTransformer: jest.fn().mockImplementation(() => ({
      transform: mockTransform,
    })),
    collectCIContext: (...args: unknown[]) => mockCollectCIContext(...args),
  };
});

jest.mock("../report/historical", () => ({
  generateReportAtCommit: (...args: unknown[]) => mockGenerateReportAtCommit(...args),
  listCommitRange: (...args: unknown[]) => mockListCommitRange(...args),
  getHeadSha: (...args: unknown[]) => mockGetHeadSha(...args),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const cloudManifestYaml = YAML.stringify({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
  cloud: { integrationId: "int_abc" },
});

function makeClefReport(overrides: Partial<ClefReport> = {}): ClefReport {
  return {
    schemaVersion: 1,
    repoIdentity: {
      repoOrigin: "github.com/org/repo",
      commitSha: "abc1234567890",
      branch: "main",
      commitTimestamp: "2024-01-15T10:00:00Z",
      reportGeneratedAt: "2024-01-15T11:00:00Z",
      clefVersion: "1.0.0",
      sopsVersion: "3.9.4",
    },
    manifest: {
      manifestVersion: 1,
      filePattern: "{namespace}/{environment}.enc.yaml",
      environments: [{ name: "dev", protected: false }],
      namespaces: [{ name: "database", hasSchema: false, owners: [] }],
      defaultBackend: "age",
    },
    matrix: [
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: true,
        keyCount: 3,
        pendingCount: 0,
        metadata: {
          backend: "age",
          recipients: ["age1abc123"],
          lastModified: "2024-01-15T10:00:00.000Z",
        },
      },
    ],
    policy: {
      issueCount: { error: 0, warning: 0, info: 0 },
      issues: [],
    },
    recipients: {
      age1abc123: { type: "age", environments: ["dev"], fileCount: 1 },
    },
    ...overrides,
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerReportCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

describe("clef report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    delete process.env.CLEF_API_TOKEN;
    delete process.env.CLEF_API_URL;
  });

  it("default terminal output — prints matrix table and exits 0 on no errors", async () => {
    mockGenerate.mockResolvedValue(makeClefReport());
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("github.com/org/repo"),
    );
    expect(mockFormatter.table).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(["Namespace", "Environment"]),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("No policy issues found"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("--json outputs valid JSON to formatter.raw", async () => {
    mockGenerate.mockResolvedValue(makeClefReport());
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report", "--json"]);

    expect(mockFormatter.raw).toHaveBeenCalled();
    const jsonOutput = (mockFormatter.raw as jest.Mock).mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.matrix).toBeDefined();
    expect(parsed.policy).toBeDefined();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 0 when policy has no errors", async () => {
    mockGenerate.mockResolvedValue(makeClefReport());
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report"]);

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when policy has errors", async () => {
    mockGenerate.mockResolvedValue(
      makeClefReport({
        policy: {
          issueCount: { error: 2, warning: 0, info: 0 },
          issues: [
            { severity: "error", category: "schema", message: "2 keys fail schema validation" },
          ],
        },
      }),
    );
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("error"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("generation failure emits error message and exits 1", async () => {
    mockGenerate.mockRejectedValue(new Error("manifest not found"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("manifest not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("--namespace and --environment are passed to generator", async () => {
    mockGenerate.mockResolvedValue(makeClefReport());
    const { ReportGenerator } = jest.requireMock("@clef-sh/core") as {
      ReportGenerator: jest.Mock;
    };
    ReportGenerator.mockImplementation(() => ({ generate: mockGenerate }));
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "report",
      "--namespace",
      "database",
      "--environment",
      "prod",
    ]);

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        namespaceFilter: ["database"],
        environmentFilter: ["prod"],
      }),
    );
  });

  it("SopsMissingError calls formatDependencyError and exits 1", async () => {
    mockGenerate.mockRejectedValue(new SopsMissingError("brew install sops"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "report"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  // ── --at flag ───────────────────────────────────────────────────────────

  describe("--at", () => {
    it("generates report at specific commit and outputs JSON", async () => {
      const report = makeClefReport();
      mockGenerateReportAtCommit.mockResolvedValue(report);
      const program = makeProgram(goodRunner());

      await program.parseAsync(["node", "clef", "report", "--at", "abc123", "--json"]);

      expect(mockGenerateReportAtCommit).toHaveBeenCalledWith(
        expect.any(String),
        "abc123",
        expect.any(String),
        expect.any(Object),
      );
      expect(mockFormatter.raw).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("outputs terminal format when --json not specified", async () => {
      mockGenerateReportAtCommit.mockResolvedValue(makeClefReport());
      const program = makeProgram(goodRunner());

      await program.parseAsync(["node", "clef", "report", "--at", "abc123"]);

      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("github.com/org/repo"),
      );
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  // ── --since flag ────────────────────────────────────────────────────────

  describe("--since", () => {
    it("generates reports for commit range", async () => {
      const report = makeClefReport();
      mockGenerate.mockResolvedValue(report);
      mockListCommitRange.mockResolvedValue(["aaa111", "bbb222", "head123"]);
      mockGetHeadSha.mockResolvedValue("head123");
      mockGenerateReportAtCommit.mockResolvedValue(
        makeClefReport({
          repoIdentity: { ...report.repoIdentity, commitSha: "aaa111" },
        }),
      );

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--since", "old_sha"]);

      expect(mockListCommitRange).toHaveBeenCalledWith(
        expect.any(String),
        "old_sha",
        expect.any(Object),
      );
      expect(mockGenerateReportAtCommit).toHaveBeenCalledTimes(2);
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("3 report(s)"));
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("outputs JSON array when --json is specified", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockListCommitRange.mockResolvedValue(["head123"]);
      mockGetHeadSha.mockResolvedValue("head123");

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--since", "old", "--json"]);

      expect(mockFormatter.raw).toHaveBeenCalled();
      const jsonOutput = (mockFormatter.raw as jest.Mock).mock.calls[0][0] as string;
      const parsed = JSON.parse(jsonOutput);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  // ── --push flag ─────────────────────────────────────────────────────────

  describe("--push", () => {
    it("without token emits error and exits 1", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      const program = makeProgram(goodRunner());

      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("API token"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("without cloud.integrationId emits error and exits 1", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      // Return manifest without cloud section
      mockFs.readFileSync.mockReturnValue(validManifestYaml);

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("integrationId"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("submits single report on first push (lastCommitSha=null)", async () => {
      const report = makeClefReport();
      mockGenerate.mockResolvedValue(report);
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: null,
        config: { collectCIContext: false },
      });
      mockTransform.mockReturnValue({
        commitSha: "abc1234567890",
        branch: "main",
        commitTimestamp: 1705312800000,
        cliVersion: "1.0.0",
        summary: {
          filesScanned: 1,
          namespaces: [],
          environments: [],
          cells: [],
          violations: 0,
          passed: true,
        },
        drift: [],
        policyResults: [],
      });
      mockSubmitReport.mockResolvedValue({ id: "rpt_1", commitSha: "abc1234567890" });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockFetchIntegration).toHaveBeenCalled();
      expect(mockSubmitReport).toHaveBeenCalled();
      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("submitted"));
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("exits 0 when already up to date", async () => {
      const report = makeClefReport();
      mockGenerate.mockResolvedValue(report);
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: "abc1234567890",
        config: { collectCIContext: false },
      });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("up to date"));
      expect(mockSubmitReport).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("batch submits when gap-filling multiple commits", async () => {
      const report = makeClefReport();
      mockGenerate.mockResolvedValue(report);
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: "old_sha",
        config: { collectCIContext: false },
      });
      mockListCommitRange.mockResolvedValue(["mid_sha", "abc1234567890"]);
      mockGenerateReportAtCommit.mockResolvedValue(makeClefReport());
      mockTransform.mockReturnValue({
        commitSha: "x",
        branch: "main",
        commitTimestamp: 0,
        cliVersion: "1.0.0",
        summary: {
          filesScanned: 0,
          namespaces: [],
          environments: [],
          cells: [],
          violations: 0,
          passed: true,
        },
        drift: [],
        policyResults: [],
      });
      mockSubmitBatchReports.mockResolvedValue({ accepted: 2, reportIds: ["a", "b"] });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockSubmitBatchReports).toHaveBeenCalled();
      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("2 report(s)"));
    });

    it("reads token from CLEF_API_TOKEN env var", async () => {
      process.env.CLEF_API_TOKEN = "env_token_xyz";
      mockGenerate.mockResolvedValue(makeClefReport());
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: "abc1234567890",
        config: { collectCIContext: false },
      });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockFormatter.error).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("uses CLEF_API_URL env var", async () => {
      process.env.CLEF_API_URL = "https://custom.api.test";
      mockGenerate.mockResolvedValue(makeClefReport());
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: "abc1234567890",
        config: { collectCIContext: false },
      });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockFetchIntegration).toHaveBeenCalledWith(
        "https://custom.api.test",
        "tok_abc",
        "int_abc",
      );
    });

    it("attaches CI context to last report when collectCIContext enabled", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockResolvedValue({
        lastCommitSha: null,
        config: { collectCIContext: true },
      });
      const cloudReport = {
        commitSha: "abc1234567890",
        branch: "main",
        commitTimestamp: 0,
        cliVersion: "1.0.0",
        summary: {
          filesScanned: 0,
          namespaces: [],
          environments: [],
          cells: [],
          violations: 0,
          passed: true,
        },
        drift: [],
        policyResults: [],
      };
      mockTransform.mockReturnValue(cloudReport);
      mockCollectCIContext.mockReturnValue({ provider: "github-actions" });
      mockSubmitReport.mockResolvedValue({ id: "rpt_1", commitSha: "abc1234567890" });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "tok_abc"]);

      expect(mockCollectCIContext).toHaveBeenCalled();
      // The ciContext should have been attached to the report
      expect(mockSubmitReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ ciContext: { provider: "github-actions" } }),
      );
    });

    it("handles CloudApiError with hint", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockFs.readFileSync.mockReturnValue(cloudManifestYaml);
      mockFetchIntegration.mockRejectedValue(
        new CloudApiError("API returned 401 Unauthorized", 401, "Check your API token."),
      );

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push", "--api-token", "bad_tok"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("401"));
      expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("API token"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
