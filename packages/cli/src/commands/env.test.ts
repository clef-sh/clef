import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerEnvCommand } from "./env";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");

const mockEditEnvironment = jest.fn();
const mockManifestParse = jest.fn();

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({ parse: mockManifestParse })),
    MatrixManager: jest.fn().mockImplementation(() => ({})),
    StructureManager: jest.fn().mockImplementation(() => ({
      editEnvironment: mockEditEnvironment,
    })),
    GitIntegration: jest.fn().mockImplementation(() => ({})),
    TransactionManager: jest.fn().mockImplementation(() => ({ run: jest.fn() })),
  };
});

jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    hint: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "payments", description: "Payments" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerEnvCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

describe("clef env edit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockEditEnvironment.mockResolvedValue(undefined);
  });

  it("renames an environment and reports success", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "dev", "--rename", "development"]);

    expect(mockEditEnvironment).toHaveBeenCalledWith(
      "dev",
      expect.objectContaining({ rename: "development" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Renamed environment 'dev' → 'development'"),
    );
  });

  it("updates a description", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "env",
      "edit",
      "dev",
      "--description",
      "Local development",
    ]);

    expect(mockEditEnvironment).toHaveBeenCalledWith(
      "dev",
      expect.objectContaining({ description: "Local development" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Updated description on environment 'dev'"),
    );
  });

  it("marks an env as protected", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "dev", "--protect"]);

    expect(mockEditEnvironment).toHaveBeenCalledWith(
      "dev",
      expect.objectContaining({ protected: true }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Marked environment 'dev' as protected"),
    );
  });

  it("removes the protected flag", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "production", "--unprotect"]);

    expect(mockEditEnvironment).toHaveBeenCalledWith(
      "production",
      expect.objectContaining({ protected: false }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Removed protected flag from environment 'production'"),
    );
  });

  it("errors when both --protect and --unprotect are passed", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "dev", "--protect", "--unprotect"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot pass --protect and --unprotect"),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockEditEnvironment).not.toHaveBeenCalled();
  });

  it("errors with exit 2 when no edit flags are passed", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "dev"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Nothing to edit"));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockEditEnvironment).not.toHaveBeenCalled();
  });

  it("outputs JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "dev", "--rename", "development"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.action).toBe("edited");
    expect(data.kind).toBe("environment");
    expect(data.name).toBe("development");
    expect(data.previousName).toBe("dev");

    isJsonMode.mockReturnValue(false);
  });

  it("propagates StructureManager errors via handleCommandError", async () => {
    mockEditEnvironment.mockRejectedValueOnce(new Error("Environment 'foo' not found"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "edit", "foo", "--rename", "bar"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Environment 'foo' not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
