import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerReportCommand } from "./report";
import { SubprocessRunner, ClefReport, SopsMissingError } from "@clef-sh/core";
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
const mockGenerateReportAtCommit = jest.fn();
const mockListCommitRange = jest.fn();
const mockGetHeadSha = jest.fn();
const mockPushOtlp = jest.fn();
const mockResolveTelemetryConfig = jest.fn();
const mockFetchCheckpoint = jest.fn();

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ReportGenerator: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
  };
});

jest.mock("../report/historical", () => ({
  generateReportAtCommit: (...args: unknown[]) => mockGenerateReportAtCommit(...args),
  listCommitRange: (...args: unknown[]) => mockListCommitRange(...args),
  getHeadSha: (...args: unknown[]) => mockGetHeadSha(...args),
}));

jest.mock("../output/otlp", () => ({
  reportToOtlp: jest.fn().mockReturnValue('{"resourceLogs":[]}'),
  pushOtlp: (...args: unknown[]) => mockPushOtlp(...args),
  resolveTelemetryConfig: (...args: unknown[]) => mockResolveTelemetryConfig(...args),
  fetchCheckpoint: (...args: unknown[]) => mockFetchCheckpoint(...args),
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
    const telemetryConfig = {
      url: "https://otel.example.com/v1/logs",
      headers: { Authorization: "Bearer tok_abc" },
    };

    it("errors when telemetry is not configured", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockResolveTelemetryConfig.mockReturnValue(undefined);

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("CLEF_TELEMETRY_URL"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("pushes HEAD only when checkpoint returns null (first push)", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockResolveTelemetryConfig.mockReturnValue(telemetryConfig);
      mockFetchCheckpoint.mockResolvedValue({ lastCommitSha: null, lastTimestamp: null });
      mockPushOtlp.mockResolvedValue(undefined);

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockFetchCheckpoint).toHaveBeenCalledWith(telemetryConfig);
      expect(mockPushOtlp).toHaveBeenCalledTimes(1);
      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("1 report(s) pushed"),
      );
    });

    it("exits with up-to-date message when checkpoint matches HEAD", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockResolveTelemetryConfig.mockReturnValue(telemetryConfig);
      mockFetchCheckpoint.mockResolvedValue({
        lastCommitSha: "abc1234567890",
        lastTimestamp: "2024-01-15T11:00:00Z",
      });

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockPushOtlp).not.toHaveBeenCalled();
      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("up to date"),
      );
    });

    it("gap-fills when checkpoint is behind HEAD", async () => {
      const report = makeClefReport();
      mockGenerate.mockResolvedValue(report);
      mockResolveTelemetryConfig.mockReturnValue(telemetryConfig);
      mockFetchCheckpoint.mockResolvedValue({
        lastCommitSha: "old_sha",
        lastTimestamp: "2024-01-14T00:00:00Z",
      });
      mockListCommitRange.mockResolvedValue(["mid_sha", "abc1234567890"]);
      mockGenerateReportAtCommit.mockResolvedValue(
        makeClefReport({
          repoIdentity: { ...report.repoIdentity, commitSha: "mid_sha" },
        }),
      );
      mockPushOtlp.mockResolvedValue(undefined);

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockListCommitRange).toHaveBeenCalledWith(
        expect.any(String),
        "old_sha",
        expect.any(Object),
      );
      expect(mockPushOtlp).toHaveBeenCalledTimes(2);
      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("2 report(s) pushed"),
      );
    });

    it("still outputs terminal format after push", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockResolveTelemetryConfig.mockReturnValue(telemetryConfig);
      mockFetchCheckpoint.mockResolvedValue({ lastCommitSha: null, lastTimestamp: null });
      mockPushOtlp.mockResolvedValue(undefined);

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      // Normal output still happens after push
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("github.com/org/repo"),
      );
    });

    it("push failure propagates as error", async () => {
      mockGenerate.mockResolvedValue(makeClefReport());
      mockResolveTelemetryConfig.mockReturnValue(telemetryConfig);
      mockFetchCheckpoint.mockRejectedValue(
        new Error("Checkpoint fetch failed: 401 Unauthorized"),
      );

      const program = makeProgram(goodRunner());
      await program.parseAsync(["node", "clef", "report", "--push"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Checkpoint fetch failed"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
