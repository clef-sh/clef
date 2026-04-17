import * as fs from "fs";
import { Command } from "commander";
import { registerPolicyCommand } from "./policy";
import { SubprocessRunner } from "@clef-sh/core";
import type {
  ComplianceDocument,
  FileRotationStatus,
  KeyRotationStatus,
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

function key(overrides: Partial<KeyRotationStatus> = {}): KeyRotationStatus {
  return {
    key: "API_KEY",
    last_rotated_at: "2026-03-15T00:00:00.000Z",
    last_rotated_known: true,
    rotated_by: "alice <alice@example.com>",
    rotation_count: 1,
    rotation_due: "2026-06-13T00:00:00.000Z",
    rotation_overdue: false,
    days_overdue: 0,
    compliant: true,
    ...overrides,
  };
}

function file(overrides: Partial<FileRotationStatus> = {}): FileRotationStatus {
  const base: FileRotationStatus = {
    path: "api/dev.enc.yaml",
    environment: "dev",
    backend: "age",
    recipients: ["age1abc"],
    last_modified: "2026-03-15T00:00:00.000Z",
    last_modified_known: true,
    keys: [key()],
    compliant: true,
  };
  const merged = { ...base, ...overrides };
  // Keep cell compliant flag consistent with key verdicts when the test
  // only overrides one or the other — this matches the real evaluator.
  if (!("compliant" in overrides)) {
    merged.compliant = merged.keys.every((k) => k.compliant);
  }
  return merged;
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
      rotation_overdue: files.filter((f) => !f.compliant).length,
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

  it("exits 1 when any key is overdue", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([
        file(),
        file({
          keys: [key({ rotation_overdue: true, compliant: false, days_overdue: 5 })],
        }),
      ]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 when any key has unknown rotation (unknown = violation by design)", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([
        file({
          keys: [
            key({
              last_rotated_at: null,
              last_rotated_known: false,
              rotated_by: null,
              rotation_count: 0,
              rotation_due: null,
              compliant: false,
            }),
          ],
        }),
      ]),
      passed: false,
      durationMs: 5,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);
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
    // Default per-key mode shows the "no keys" message; --per-file shows
    // "No matrix files matched the filter."
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringMatching(/No keys found/));
  });

  it("--json mode emits a structured payload", async () => {
    // --json is a top-level program flag in production. We exercise the
    // formatter mock directly here so the subcommand parser doesn't reject it.
    const { isJsonMode } = jest.requireMock("../output/formatter");
    isJsonMode.mockReturnValue(true);

    mockRunCompliance.mockResolvedValue({
      document: doc([
        // Cell with a key of unknown rotation state — violates the gate.
        file({
          keys: [
            key({
              last_rotated_at: null,
              last_rotated_known: false,
              rotated_by: null,
              rotation_count: 0,
              rotation_due: null,
              compliant: false,
            }),
          ],
        }),
        // Cell with a key that is overdue.
        file({
          keys: [key({ rotation_overdue: true, compliant: false, days_overdue: 5 })],
        }),
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
          // Both cells non-compliant → rotation_overdue counts both (one
          // unknown-violation, one literally overdue).
          rotation_overdue: 2,
          unknown_metadata: 1,
        }),
        passed: false,
      }),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("--per-file output uses the file-level table headers", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file()]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check", "--per-file"]);

    const tableCall = mockFormatter.table.mock.calls[0] as [string[][], string[]];
    expect(tableCall[1]).toEqual(["FILE", "ENV", "LAST WRITTEN", "KEYS", "STATUS"]);
  });

  it("--per-key output uses the per-key table headers (default)", async () => {
    mockRunCompliance.mockResolvedValue({
      document: doc([file()]),
      passed: true,
      durationMs: 1,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "check"]);

    const tableCall = mockFormatter.table.mock.calls[0] as [string[][], string[]];
    expect(tableCall[1]).toEqual(["KEY", "FILE", "ENV", "AGE", "LIMIT", "STATUS"]);
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
      document: doc([
        file({
          keys: [key({ rotation_overdue: true, compliant: false, days_overdue: 3 })],
          compliant: false,
        }),
      ]),
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
      document: doc([
        file({
          keys: [key({ rotation_overdue: true, compliant: false, days_overdue: 3 })],
          compliant: false,
        }),
      ]),
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

  it("forwards --dry-run to scaffoldPolicy", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "init",
      "--dry-run",
      "--force",
      "--workflow-only",
    ]);
    expect(mockScaffoldPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, force: true, workflowOnly: true }),
    );
  });

  it("renders diff output for would_overwrite results", async () => {
    mockScaffoldPolicy.mockReturnValueOnce({
      policy: { path: ".clef/policy.yaml", status: "skipped_by_flag" },
      workflow: {
        path: ".github/workflows/clef-compliance.yml",
        status: "would_overwrite",
        diff: "--- current\n+++ new\n@@ -1 +1 @@\n-node: 20\n+node: 22\n",
      },
      provider: "github",
      mergeInstruction: undefined,
    });
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "policy",
      "init",
      "--dry-run",
      "--force",
      "--workflow-only",
    ]);

    // Status label surfaces the "update" verb for would_overwrite
    const printCalls = mockFormatter.print.mock.calls.map((c) => c[0]);
    expect(printCalls.some((s) => /update/.test(String(s)))).toBe(true);
    // Diff body is forwarded verbatim to formatter.raw
    expect(mockFormatter.raw).toHaveBeenCalledWith(expect.stringContaining("+node: 22"));
  });

  it("renders would_create / unchanged status labels", async () => {
    mockScaffoldPolicy.mockReturnValueOnce({
      policy: { path: ".clef/policy.yaml", status: "would_create" },
      workflow: {
        path: ".github/workflows/clef-compliance.yml",
        status: "unchanged",
      },
      provider: "github",
      mergeInstruction: undefined,
    });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "policy", "init", "--dry-run", "--force"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    expect(printCalls.some((s) => /create/.test(s))).toBe(true);
    // Plain-mode label for "unchanged" is `[same]` — the test harness has
    // isPlainMode() stubbed true, so we assert on that.
    expect(printCalls.some((s) => /same/.test(s))).toBe(true);
    // No diff was produced for these statuses
    expect(mockFormatter.raw).not.toHaveBeenCalled();
  });
});
