import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerEnvCommand } from "./env";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");

const mockEditEnvironment = jest.fn();
const mockAddEnvironment = jest.fn();
const mockRemoveEnvironment = jest.fn();
const mockManifestParse = jest.fn();

jest.mock("../age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({
    client: {},
    cleanup: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({ parse: mockManifestParse })),
    MatrixManager: jest.fn().mockImplementation(() => ({})),
    StructureManager: jest.fn().mockImplementation(() => ({
      editEnvironment: mockEditEnvironment,
      addEnvironment: mockAddEnvironment,
      removeEnvironment: mockRemoveEnvironment,
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
    confirm: jest.fn().mockResolvedValue(true),
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
    mockAddEnvironment.mockResolvedValue(undefined);
    mockRemoveEnvironment.mockResolvedValue(undefined);
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

describe("clef env add", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockAddEnvironment.mockResolvedValue(undefined);
  });

  it("adds a new environment and reports the cell scaffold count", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "add", "staging", "--description", "Staging"]);

    expect(mockAddEnvironment).toHaveBeenCalledWith(
      "staging",
      expect.objectContaining({ description: "Staging" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Added environment 'staging'"),
    );
  });

  it("forwards --protect", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "add", "canary", "--protect"]);

    expect(mockAddEnvironment).toHaveBeenCalledWith(
      "canary",
      expect.objectContaining({ protected: true }),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("outputs JSON with --json flag including cellsScaffolded", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "add", "staging"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.action).toBe("added");
    expect(data.kind).toBe("environment");
    expect(data.name).toBe("staging");
    // baseManifest has 1 namespace, so 1 cell scaffolded
    expect(data.cellsScaffolded).toBe(1);

    isJsonMode.mockReturnValue(false);
  });

  it("propagates StructureManager errors via handleCommandError", async () => {
    mockAddEnvironment.mockRejectedValueOnce(new Error("Environment 'staging' already exists"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "add", "staging"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Environment 'staging' already exists"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("clef env remove", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockRemoveEnvironment.mockResolvedValue(undefined);
  });

  it("prompts for confirmation by default and removes on yes", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    realFormatter.confirm.mockResolvedValueOnce(true);

    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "remove", "dev"]);

    expect(realFormatter.confirm).toHaveBeenCalled();
    expect(mockRemoveEnvironment).toHaveBeenCalledWith(
      "dev",
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Removed environment 'dev'"),
    );
  });

  it("aborts when the user declines confirmation", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    realFormatter.confirm.mockResolvedValueOnce(false);

    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "remove", "dev"]);

    expect(mockRemoveEnvironment).not.toHaveBeenCalled();
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("Aborted"));
  });

  it("skips the prompt with --yes", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "remove", "dev", "--yes"]);

    expect(realFormatter.confirm).not.toHaveBeenCalled();
    expect(mockRemoveEnvironment).toHaveBeenCalled();
  });

  it("propagates a protected-env error from StructureManager", async () => {
    mockRemoveEnvironment.mockRejectedValueOnce(
      new Error("Environment 'production' is protected. Cannot remove a protected environment."),
    );
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "env", "remove", "production", "--yes"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Environment 'production' is protected"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
