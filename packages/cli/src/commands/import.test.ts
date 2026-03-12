import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerImportCommand } from "./import";
import { SubprocessRunner, SopsMissingError } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ImportRunner: jest.fn().mockImplementation(() => ({
      import: jest.fn().mockResolvedValue({
        imported: ["DB_HOST", "DB_PORT"],
        skipped: [],
        failed: [],
        warnings: [],
        dryRun: false,
      }),
    })),
  };
});
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn().mockResolvedValue("secret"),
    formatDependencyError: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "database", description: "Database" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function sopsRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "age") {
        return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--repo <path>", "Path to the Clef repository root");
  program.exitOverride();
  registerImportCommand(program, { runner });
  return program;
}

// Get reference to mocked ImportRunner
const { ImportRunner: MockImportRunner } = jest.requireMock("@clef-sh/core") as {
  ImportRunner: jest.Mock;
};

function setImportRunnerResult(result: {
  imported: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
  warnings: string[];
  dryRun: boolean;
}): jest.Mock {
  const mockImportFn = jest.fn().mockResolvedValue(result);
  MockImportRunner.mockImplementation(() => ({ import: mockImportFn }));
  return mockImportFn;
}

describe("clef import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);

    // Reset ImportRunner mock to default
    MockImportRunner.mockImplementation(() => ({
      import: jest.fn().mockResolvedValue({
        imported: ["DB_HOST", "DB_PORT"],
        skipped: [],
        failed: [],
        warnings: [],
        dryRun: false,
      }),
    }));
  });

  it("successful import: outputs correct results", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("DB_HOST"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("imported"));
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  it("dry run: shows preview output with would import/skip", async () => {
    setImportRunnerResult({
      imported: ["DB_HOST"],
      skipped: ["EXISTING"],
      failed: [],
      warnings: [],
      dryRun: true,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "import",
      "database/staging",
      "/path/to/.env",
      "--dry-run",
    ]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("would import"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("would skip"));
    // Should not exit with non-zero
    expect(mockExit).not.toHaveBeenCalledWith(1);
    expect(mockExit).not.toHaveBeenCalledWith(2);
  });

  it("--prefix: passes prefix to ImportRunner", async () => {
    const mockImportFn = setImportRunnerResult({
      imported: ["DB_HOST"],
      skipped: [],
      failed: [],
      warnings: [],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "import",
      "database/staging",
      "/path/to/.env",
      "--prefix",
      "DB_",
    ]);

    expect(mockImportFn).toHaveBeenCalledWith(
      "database/staging",
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ prefix: "DB_" }),
    );
  });

  it("--keys: passes keys array to ImportRunner (comma-separated)", async () => {
    const mockImportFn = setImportRunnerResult({
      imported: ["DB_HOST", "DB_PORT"],
      skipped: [],
      failed: [],
      warnings: [],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "import",
      "database/staging",
      "/path/to/.env",
      "--keys",
      "DB_HOST,DB_PORT",
    ]);

    expect(mockImportFn).toHaveBeenCalledWith(
      "database/staging",
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ keys: ["DB_HOST", "DB_PORT"] }),
    );
  });

  it("without --overwrite: skipped keys show hint", async () => {
    setImportRunnerResult({
      imported: ["NEW_KEY"],
      skipped: ["EXISTING_KEY"],
      failed: [],
      warnings: [],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("--overwrite to replace"),
    );
  });

  it("--overwrite: passes overwrite:true to ImportRunner", async () => {
    const mockImportFn = setImportRunnerResult({
      imported: ["EXISTING_KEY"],
      skipped: [],
      failed: [],
      warnings: [],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "import",
      "database/staging",
      "/path/to/.env",
      "--overwrite",
    ]);

    expect(mockImportFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ overwrite: true }),
    );
  });

  it("partial failure: exits with code 1, failed keys shown", async () => {
    setImportRunnerResult({
      imported: ["DB_HOST"],
      skipped: [],
      failed: [{ key: "API_TOKEN", error: "encrypt error: key not found" }],
      warnings: [],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("API_TOKEN"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("failed"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("parse error (e.g. invalid JSON): exits with code 2", async () => {
    MockImportRunner.mockImplementation(() => ({
      import: jest.fn().mockRejectedValue(new Error("Invalid JSON: Unexpected token")),
    }));

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/bad.json"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid JSON"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("--stdin: calls import with null sourcePath", async () => {
    const mockImportFn = setImportRunnerResult({
      imported: ["DB_HOST"],
      skipped: [],
      failed: [],
      warnings: [],
      dryRun: false,
    });

    // Mock stdin
    const dataHandlers: Array<(data: string) => void> = [];
    const endHandlers: Array<() => void> = [];
    const mockStdin = {
      setEncoding: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: unknown) => {
        if (event === "data") dataHandlers.push(handler as (data: string) => void);
        if (event === "end") endHandlers.push(handler as () => void);
        return mockStdin;
      }),
    };
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

    // Trigger stdin data after a tick
    setTimeout(() => {
      dataHandlers.forEach((h) => h("DB_HOST=localhost\n"));
      endHandlers.forEach((h) => h());
    }, 0);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "--stdin"]);

    expect(mockImportFn).toHaveBeenCalledWith(
      "database/staging",
      null, // sourcePath is null for stdin
      expect.any(String),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );

    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  });

  it("protected environment: formatter.confirm called", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/production", "/path/to/.env"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("protected"));
  });

  it("protected environment declined: nothing imported, no non-zero exit", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/production", "/path/to/.env"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockExit).not.toHaveBeenCalledWith(1);
    expect(mockExit).not.toHaveBeenCalledWith(2);
  });

  it("warnings from parser propagated to output", async () => {
    setImportRunnerResult({
      imported: ["STRING_KEY"],
      skipped: [],
      failed: [],
      warnings: ["NUMBER_KEY: skipped — value is number, not string"],
      dryRun: false,
    });

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/file.json"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("NUMBER_KEY"));
  });

  it("invalid target (no slash): exits with code 2", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "bad-target", "/path/to/.env"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid target"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("source file not found: exits with code 2", async () => {
    mockFs.existsSync.mockReturnValue(false);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/nonexistent/.env"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("no source provided without --stdin: exits with code 2", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("No source"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("dependency error calls formatDependencyError", async () => {
    // Make ImportRunner.import throw a SopsMissingError
    MockImportRunner.mockImplementationOnce(() => ({
      import: jest.fn().mockRejectedValue(new SopsMissingError("brew install sops")),
    }));
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows import summary line", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("2 imported"));
  });

  it("shows importing header line with namespace/environment", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "import", "database/staging", "/path/to/.env"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("database/staging"));
  });
});
