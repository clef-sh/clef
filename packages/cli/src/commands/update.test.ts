import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerUpdateCommand } from "./update";
import { SubprocessRunner, SopsMissingError, SopsVersionError, SopsClient } from "@clef-sh/core";
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

const mockResolveMatrix = jest.fn();
const mockScaffoldCell = jest.fn();
const mockManifestParse = jest.fn().mockReturnValue({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({
      parse: mockManifestParse,
    })),
    MatrixManager: jest.fn().mockImplementation(() => ({
      resolveMatrix: mockResolveMatrix,
      scaffoldCell: mockScaffoldCell,
    })),
    SopsClient: jest.fn().mockImplementation(() => ({})),
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
      { namespace: "database", environment: "dev", exists: false },
      { namespace: "database", environment: "staging", exists: false },
    ]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockScaffoldCell).toHaveBeenCalledTimes(2);
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Scaffolded 2"));
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

  it("should warn when a cell cannot be scaffolded", async () => {
    mockResolveMatrix.mockReturnValue([
      { namespace: "database", environment: "dev", exists: false },
    ]);
    mockScaffoldCell.mockRejectedValue(new Error("sops failed"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("sops failed"));
    // No success message since none scaffolded
    expect(mockFormatter.success).not.toHaveBeenCalledWith(expect.stringContaining("Scaffolded"));
  });

  it("should read ageKeyFile from .clef/config.yaml when no env vars set", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY_FILE;

    const localConfig = YAML.stringify({ age_key_file: "/home/user/.config/clef/keys.txt" });
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("clef.yaml") || s.includes(".clef");
    });
    mockFs.readFileSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("clef.yaml")) return validManifestYaml;
      if (String(p).includes("config.yaml")) return localConfig;
      return "";
    }) as typeof fs.readFileSync);

    mockResolveMatrix.mockReturnValue([]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(SopsClient as jest.Mock).toHaveBeenCalledWith(
      expect.anything(),
      "/home/user/.config/clef/keys.txt",
      undefined,
    );

    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
  });

  it("should pass CLEF_AGE_KEY_FILE to SopsClient when env var is set", async () => {
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    process.env.CLEF_AGE_KEY_FILE = "/from/env/keys.txt";

    mockResolveMatrix.mockReturnValue([]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    // SopsClient should be called with the file path from CLEF_AGE_KEY_FILE
    expect(SopsClient as jest.Mock).toHaveBeenCalledWith(
      expect.anything(),
      "/from/env/keys.txt",
      undefined,
    );

    if (origKeyFile === undefined) {
      delete process.env.CLEF_AGE_KEY_FILE;
    } else {
      process.env.CLEF_AGE_KEY_FILE = origKeyFile;
    }
  });

  it("should pass CLEF_AGE_KEY to SopsClient when env var is set", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-INLINE";
    delete process.env.CLEF_AGE_KEY_FILE;

    mockResolveMatrix.mockReturnValue([]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    expect(SopsClient as jest.Mock).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "AGE-SECRET-KEY-INLINE",
    );

    if (origKey === undefined) {
      delete process.env.CLEF_AGE_KEY;
    } else {
      process.env.CLEF_AGE_KEY = origKey;
    }
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
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

  it("should skip reading .clef/config.yaml for non-age backends", async () => {
    mockManifestParse.mockReturnValueOnce({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "database", description: "DB" }],
      sops: { default_backend: "awskms" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });
    mockResolveMatrix.mockReturnValue([]);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "update"]);

    // SopsClient should be called with undefined ageKeyFile and ageKey for non-age backend
    expect(SopsClient as jest.Mock).toHaveBeenCalledWith(expect.anything(), undefined, undefined);
  });

  it("should handle .clef/config.yaml parse error gracefully", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY_FILE;

    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("clef.yaml") || s.includes(".clef");
    });
    mockFs.readFileSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("clef.yaml")) return validManifestYaml;
      if (String(p).includes("config.yaml")) throw new Error("permission denied");
      return "";
    }) as typeof fs.readFileSync);

    mockResolveMatrix.mockReturnValue([]);
    const program = makeProgram(goodRunner());

    // Should not throw — parse errors in .clef/config.yaml are silently ignored
    await program.parseAsync(["node", "clef", "update"]);

    expect(mockExit).not.toHaveBeenCalledWith(1);

    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
  });
});
