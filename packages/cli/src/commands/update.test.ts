import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerUpdateCommand } from "./update";
import { SubprocessRunner, SopsMissingError, SopsVersionError } from "@clef-sh/core";
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

const mockResolveMatrix = jest.fn();
const mockScaffoldCell = jest.fn();
const mockCleanup = jest.fn().mockResolvedValue(undefined);
const mockManifestParse = jest.fn().mockReturnValue({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

// TransactionManager is replaced with a stub that just runs the mutate
// callback and returns a fake commit SHA. Real transaction semantics
// (locking, preflight, rollback) live in transaction-manager.test.ts.
const mockTxRun = jest
  .fn()
  .mockImplementation(
    async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
      await opts.mutate();
      return {
        sha: "abc1234abc1234abc1234abc1234abc1234abcd",
        paths: opts.paths,
        startedDirty: false,
      };
    },
  );

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({
      parse: mockManifestParse,
    })),
    MatrixManager: jest.fn().mockImplementation(() => ({
      resolveMatrix: mockResolveMatrix,
    })),
    GitIntegration: jest.fn().mockImplementation(() => ({})),
    TransactionManager: jest.fn().mockImplementation(() => ({ run: mockTxRun })),
  };
});

// Mock createSecretSource so the update command's scaffold loop runs
// against a controllable stub source. Credential resolution
// (CLEF_AGE_KEY, CLEF_AGE_KEY_FILE, .clef/config.yaml) lives inside
// createSecretSource → createSopsClient and is exercised by
// age-credential.test.ts; we don't re-test it here.
jest.mock("../source-factory", () => ({
  createSecretSource: jest.fn().mockImplementation(async () => ({
    source: { scaffoldCell: mockScaffoldCell },
    cleanup: mockCleanup,
  })),
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

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerUpdateCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

describe("clef update", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockResolveMatrix.mockReturnValue([]);
    mockScaffoldCell.mockResolvedValue(undefined);
    mockManifestParse.mockReturnValue({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "database", description: "DB" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });
  });

  it("should report up to date when all cells exist", async () => {
    mockResolveMatrix.mockReturnValue([
      { namespace: "database", environment: "dev", exists: true },
    ]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.success).toHaveBeenCalledWith("Matrix is up to date.");
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  it("should scaffold missing cells and report count", async () => {
    mockResolveMatrix.mockReturnValue([
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      },
      {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: false,
      },
    ]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockScaffoldCell).toHaveBeenCalledTimes(2);
    expect(mockScaffoldCell).toHaveBeenCalledWith(
      { namespace: "database", environment: "dev" },
      expect.any(Object),
    );
    expect(mockScaffoldCell).toHaveBeenCalledWith(
      { namespace: "database", environment: "staging" },
      expect.any(Object),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Scaffolded 2"));
  });

  it("wraps the scaffold loop in a single transaction", async () => {
    mockResolveMatrix.mockReturnValue([
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      },
      {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: false,
      },
    ]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "--dir", "/repo", "update"]);

    expect(mockTxRun).toHaveBeenCalledTimes(1);
    const [repoRoot, opts] = mockTxRun.mock.calls[0] as [
      string,
      { description: string; paths: string[] },
    ];
    expect(repoRoot).toBe("/repo");
    expect(opts.description).toContain("scaffold 2 matrix cells");
    // Paths must be repo-relative for git add / git clean
    expect(opts.paths).toEqual(["database/dev.enc.yaml", "database/staging.enc.yaml"]);
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    mockResolveMatrix.mockReturnValue([
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      },
      {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: false,
      },
    ]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "--dir", "/repo", "update"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.scaffolded).toBe(2);
    expect(data.sha).toMatch(/^[a-f0-9]+$/);
    expect(data.paths).toEqual(["database/dev.enc.yaml", "database/staging.enc.yaml"]);

    isJsonMode.mockReturnValue(false);
  });

  it("should error when clef.yaml is not found", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rolls back the whole transaction when any cell fails", async () => {
    mockResolveMatrix.mockReturnValue([
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: false,
      },
      {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: false,
      },
    ]);
    // Stub tx.run to surface the mutate error like the real TransactionManager
    // would (after rolling back).
    mockTxRun.mockImplementationOnce(
      async (_repoRoot: string, opts: { mutate: () => Promise<void> }) => {
        await opts.mutate();
      },
    );
    mockScaffoldCell.mockRejectedValueOnce(new Error("sops failed"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("sops failed"));
    expect(mockExit).toHaveBeenCalledWith(1);
    // No success message — rollback means nothing was scaffolded
    expect(mockFormatter.success).not.toHaveBeenCalledWith(expect.stringContaining("Scaffolded"));
  });

  it("should handle parse error from ManifestParser and exit 1", async () => {
    mockManifestParse.mockImplementationOnce(() => {
      throw new Error("invalid manifest");
    });
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid manifest"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle SopsMissingError with formatDependencyError", async () => {
    mockManifestParse.mockImplementationOnce(() => {
      throw new SopsMissingError("brew install sops");
    });
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle SopsVersionError with formatDependencyError", async () => {
    mockManifestParse.mockImplementationOnce(() => {
      throw new SopsVersionError("3.0.0", "3.9.0", "brew upgrade sops");
    });
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
