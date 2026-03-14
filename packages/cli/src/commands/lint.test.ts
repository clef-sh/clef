import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerLintCommand } from "./lint";
import { SubprocessRunner, LintResult, SopsMissingError } from "@clef-sh/core";
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

// Mock the LintRunner to control returned results
const mockLintRun = jest.fn<Promise<LintResult>, []>();
const mockLintFix = jest.fn<Promise<LintResult>, []>();
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    LintRunner: jest.fn().mockImplementation(() => ({
      run: mockLintRun,
      fix: mockLintFix,
    })),
  };
});

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

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerLintCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === "age") return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

describe("clef lint", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
  });

  it("should report all clear when no issues and exit 0", async () => {
    mockLintRun.mockResolvedValue({ issues: [], fileCount: 3, pendingCount: 0 });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("All clear"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should report errors and exit 1", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "matrix",
          file: "database/dev.enc.yaml",
          message: "Missing file",
          fixCommand: "clef lint --fix",
        },
      ],
      fileCount: 0,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("error"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output JSON with --json flag", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "matrix",
          file: "database/dev.enc.yaml",
          message: "Missing",
        },
      ],
      fileCount: 0,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint", "--json"]);

    expect(mockFormatter.raw).toHaveBeenCalled();
    const jsonOutput = (mockFormatter.raw as jest.Mock).mock.calls[0][0];
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.issues).toBeDefined();
    expect(parsed.fileCount).toBeDefined();
  });

  it("should exit 1 on manifest parse error", async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("file not found");
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use fix mode when --fix is passed", async () => {
    mockLintFix.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "matrix",
          file: "database/dev.enc.yaml",
          message: "Still missing",
        },
      ],
      fileCount: 0,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint", "--fix"]);

    expect(mockLintFix).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle dependency error (SopsMissingError) and call formatDependencyError", async () => {
    mockLintRun.mockRejectedValue(new SopsMissingError("brew install sops"));
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should display warnings in output", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "warning",
          category: "schema",
          file: "database/dev.enc.yaml",
          key: "DB_URL",
          message: "Optional key missing",
          fixCommand: "clef set database/dev DB_URL <value>",
        },
      ],
      fileCount: 1,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const warningLine = printCalls.find((l) => l.includes("warning"));
    expect(warningLine).toBeTruthy();
    // No errors, so exit 0
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should display info messages in output", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "info",
          category: "schema",
          file: "database/dev.enc.yaml",
          key: "EXTRA_KEY",
          message: "Key not in schema",
        },
      ],
      fileCount: 1,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const infoLine = printCalls.find((l) => l.includes("info"));
    expect(infoLine).toBeTruthy();
    // No errors, so exit 0
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should display errors with fix commands", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "matrix",
          file: "database/dev.enc.yaml",
          message: "Missing file",
          fixCommand: "clef lint --fix",
        },
      ],
      fileCount: 0,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("clef lint --fix"));
  });

  it("should display errors with key references", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "schema",
          file: "database/dev.enc.yaml",
          key: "MISSING_KEY",
          message: "Required key missing",
        },
      ],
      fileCount: 1,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("MISSING_KEY"));
    expect(keyLine).toBeTruthy();
  });

  it("should display mixed severity summary", async () => {
    mockLintRun.mockResolvedValue({
      issues: [
        {
          severity: "error",
          category: "matrix",
          file: "a.enc.yaml",
          message: "Error",
        },
        {
          severity: "warning",
          category: "schema",
          file: "b.enc.yaml",
          message: "Warning",
        },
        {
          severity: "info",
          category: "schema",
          file: "c.enc.yaml",
          message: "Info",
        },
      ],
      fileCount: 3,
      pendingCount: 0,
    });
    const runner = goodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "lint"]);

    // Summary line should include all three
    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const summaryLine = printCalls.find(
      (l) => l.includes("error") && l.includes("warning") && l.includes("info"),
    );
    expect(summaryLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
