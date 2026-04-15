import * as fs from "fs";
import { Command } from "commander";
import { registerPolicyCommand } from "./policy";
import { SubprocessRunner } from "@clef-sh/core";
import type {
  ComplianceDocument,
  FileRotationStatus,
  RunComplianceOptions,
  RunComplianceResult,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");

jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
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
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

jest.mock("../output/symbols", () => ({
  sym: (k: string) => `[${k}]`,
  isPlainMode: () => true, // strip colors so assertions are stable
  symbols: {},
  setPlainMode: jest.fn(),
}));

const mockRunCompliance = jest.fn<Promise<RunComplianceResult>, [RunComplianceOptions]>();
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    runCompliance: (opts: RunComplianceOptions) => mockRunCompliance(opts),
  };
});

// Scaffold is exercised exhaustively in scaffold.test.ts.  Here we only assert
// the CLI command wires through the right options and formats the result.
const mockScaffoldPolicy = jest.fn();
jest.mock("../scaffold", () => ({
  ...jest.requireActual("../scaffold"),
  scaffoldPolicy: (opts: unknown) => mockScaffoldPolicy(opts),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const RUNNER: SubprocessRunner = { run: jest.fn() };

function makeProgram(): Command {
  const program = new Command();
  program.option("--dir <path>");
  program.exitOverride();
  registerPolicyCommand(program, { runner: RUNNER });
  return program;
}

function file(overrides: Partial<FileRotationStatus> = {}): FileRotationStatus {
  return {
    path: "api/dev.enc.yaml",
    environment: "dev",
    backend: "age",
    recipients: ["age1abc"],
    last_modified: "2026-03-15T00:00:00.000Z",
    last_modified_known: true,
    rotation_due: "2026-06-13T00:00:00.000Z",
    rotation_overdue: false,
    days_overdue: 0,
    compliant: true,
    ...overrides,
  };
}

function doc(files: FileRotationStatus[]): ComplianceDocument {
  return {
    schema_version: "1",
    generated_at: "2026-04-14T00:00:00.000Z",
    sha: "abc",
    repo: "o/r",
    policy_hash: "sha256:0",
    policy_snapshot: { version: 1, rotation: { max_age_days: 90 } },
    summary: {
      total_files: files.length,
      compliant: files.filter((f) => f.compliant).length,
      rotation_overdue: files.filter((f) => f.rotation_overdue).length,
      scan_violations: 0,
      lint_errors: 0,
    },
    files,
    scan: {
      matches: [],
      filesScanned: 0,
      filesSkipped: 0,
      unencryptedMatrixFiles: [],
      durationMs: 0,
    },
    lint: { issues: [], fileCount: files.length, pendingCount: 0 },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExit.mockClear();
  // mockReset clears both call history *and* mockReturnValueOnce queues.
  // clearAllMocks alone leaves leftover queued return values from prior tests.
  const { isJsonMode } = jest.requireMock("../output/formatter");
  isJsonMode.mockReset();
  isJsonMode.mockReturnValue(false);
});

describe("clef policy show", () => {
  it("prints DEFAULT_POLICY with a header comment when no policy file exists", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "show"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringMatching(/Using built-in default/),
    );
    // YAML body emitted via formatter.raw
    expect(mockFormatter.raw).toHaveBeenCalledWith(expect.stringContaining("version: 1"));
  });

  it("prints the parsed policy with a 'resolved from' header when file exists", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("version: 1\nrotation:\n  max_age_days: 45\n");

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "show"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringMatching(/Resolved from \.clef\/policy\.yaml/),
    );
    expect(mockFormatter.raw).toHaveBeenCalledWith(expect.stringContaining("max_age_days: 45"));
  });
});

describe("clef policy check", () => {
  it("exits 0 when all files compliant", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file(), file({ environment: "production" })]),
      passed: true,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);

    expect(mockFormatter.table).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when any file overdue", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file(), file({ rotation_overdue: true, compliant: false, days_overdue: 5 })]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 0 when files have unknown metadata but --strict is not set", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file({ last_modified_known: false })]),
      passed: true,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 3 when --strict and any file has unknown metadata", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file({ last_modified_known: false })]),
      passed: true,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check", "--strict"]);
    expect(mockExit).toHaveBeenCalledWith(3);
  });

  it("--strict + overdue still exits 1 (overdue takes precedence)", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([
        file({ last_modified_known: false }),
        file({ rotation_overdue: true, compliant: false, days_overdue: 1 }),
      ]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check", "--strict"]);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("forwards --namespace and --environment filters", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "check",
      "-n",
      "api",
      "billing",
      "-e",
      "production",
    ]);

    expect(mockRunCompliance).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { namespaces: ["api", "billing"], environments: ["production"] },
        include: { rotation: true, scan: false, lint: false },
      }),
    );
  });

  it("prints an info message when no files match the filter", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringMatching(/No matrix files/));
  });

  it("--json mode emits a structured payload", async () => {
    // --json is a top-level program flag in production. We exercise the
    // formatter mock directly here so the subcommand parser doesn't reject it.
    const { isJsonMode } = jest.requireMock("../output/formatter");
    isJsonMode.mockReturnValue(true);

    mockRunCompliance.mockResolvedValue({
      document: doc([
        file({ last_modified_known: false }),
        file({ rotation_overdue: true, compliant: false, days_overdue: 5 }),
      ]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);

    expect(mockFormatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          total_files: 2,
          compliant: 1,
          rotation_overdue: 1,
          unknown_metadata: 1,
        }),
        passed: false,
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("clef policy report", () => {
  it("writes JSON to stdout by default", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file()]),
      passed: true,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "report"]);

    // JSON written via formatter.raw (not .json — .json prints minified, but
    // report uses pretty-printed JSON for human readability + git diffs)
    expect(mockFormatter.raw).toHaveBeenCalledTimes(1);
    const written = mockFormatter.raw.mock.calls[0][0];
    expect(JSON.parse(written)).toMatchObject({
      schema_version: "1",
      summary: expect.any(Object),
      files: expect.any(Array),
    });
  });

  it("writes to --output file when provided", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file()]),
      passed: true,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "report",
      "--output",
      "/tmp/compliance.json",
    ]);

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/compliance.json",
      expect.stringContaining('"schema_version": "1"'),
      "utf-8",
    );
    // Human summary printed to stdout
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringMatching(/Wrote \/tmp\/compliance\.json.*passed/),
    );
  });

  it("forwards --sha and --repo to runCompliance", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "report",
      "--sha",
      "deadbeef",
      "--repo",
      "owner/name",
    ]);
    expect(mockRunCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "deadbeef", repo: "owner/name" }),
    );
  });

  it("forwards --no-scan / --no-lint / --no-rotation flags", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "report",
      "--no-scan",
      "--no-lint",
      "--no-rotation",
    ]);
    expect(mockRunCompliance).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { scan: false, lint: false, rotation: false },
      }),
    );
  });

  it("does not exit nonzero on policy violations (artifact production succeeded)", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file({ rotation_overdue: true, compliant: false })]),
      passed: false,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "report"]);
    // No process.exit() call from report — Commander returns naturally
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("output file summary shows 'failed' when not passed", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file({ rotation_overdue: true, compliant: false })]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "report", "--output", "/tmp/c.json"]);
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringMatching(/Wrote.*failed/));
  });
});

describe("clef policy init", () => {
  beforeEach(() => {
    mockScaffoldPolicy.mockReset();
    mockScaffoldPolicy.mockReturnValue({
      policy: { path: ".clef/policy.yaml", status: "created" },
      workflow: { path: ".github/workflows/clef-compliance.yml", status: "created" },
      provider: "github",
      mergeInstruction: undefined,
    });
  });

  it("invokes scaffoldPolicy with the resolved repoRoot", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init"]);
    expect(mockScaffoldPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: expect.any(String),
        ci: undefined,
        force: undefined,
        policyOnly: undefined,
        workflowOnly: undefined,
      }),
    );
  });

  it("forwards --ci, --force, --policy-only, --workflow-only", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "init",
      "--ci",
      "gitlab",
      "--force",
      "--policy-only",
    ]);
    expect(mockScaffoldPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ci: "gitlab", force: true, policyOnly: true }),
    );
  });

  it("rejects an invalid --ci value with exit 2", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init", "--ci", "jenkins"]);
    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringMatching(/Invalid --ci/));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockScaffoldPolicy).not.toHaveBeenCalled();
  });

  it("prints a human summary by default", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init"]);
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringMatching(/Policy.*\.clef\/policy\.yaml/),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringMatching(/Workflow.*\.github\/workflows/),
    );
  });

  it("surfaces a merge instruction for non-github providers", async () => {
    mockScaffoldPolicy.mockReturnValueOnce({
      policy: { path: ".clef/policy.yaml", status: "created" },
      workflow: { path: ".gitlab/clef-compliance.yml", status: "created" },
      provider: "gitlab",
      mergeInstruction: "Add `include: '/.gitlab/clef-compliance.yml'` to your .gitlab-ci.yml",
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init", "--ci", "gitlab"]);
    expect(mockFormatter.hint).toHaveBeenCalledWith(
      expect.stringMatching(/include.*gitlab-ci\.yml/),
    );
  });

  it("emits structured JSON in --json mode", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter");
    isJsonMode.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init"]);
    expect(mockFormatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ status: "created" }),
        workflow: expect.objectContaining({ status: "created" }),
        provider: "github",
      }),
    );
    // No human print path was taken
    expect(mockFormatter.print).not.toHaveBeenCalled();
  });

  it("reports skipped_exists for an idempotent re-run", async () => {
    mockScaffoldPolicy.mockReturnValueOnce({
      policy: { path: ".clef/policy.yaml", status: "skipped_exists" },
      workflow: {
        path: ".github/workflows/clef-compliance.yml",
        status: "skipped_exists",
      },
      provider: "github",
      mergeInstruction: undefined,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init"]);

    // Status label contains "exists" text
    const printCalls = mockFormatter.print.mock.calls.map((c) => c[0]);
    expect(printCalls.some((s) => /exists/.test(String(s)))).toBe(true);
  });
});
