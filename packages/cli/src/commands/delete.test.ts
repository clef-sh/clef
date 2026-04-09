import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerDeleteCommand } from "./delete";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    markResolved: jest.fn().mockResolvedValue(undefined),
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
    secretPrompt: jest.fn(),
    formatDependencyError: jest.fn(),
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
    { name: "staging", description: "Stg" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "database", description: "DB" }],
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
      if (cmd === "sops" && args[0] === "decrypt") {
        return { stdout: "KEY_TO_DELETE: val\nKEEP: keep\n", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args.includes("encrypt"))
        return { stdout: "enc", stderr: "", exitCode: 0 };
      if (cmd === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (cmd === "cat") {
        return {
          stdout: "sops:\n  age:\n    - recipient: age1\n  lastmodified: '2024-01-15'\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (cmd === "tee") return { stdout: "", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerDeleteCommand(program, { runner });
  return program;
}

describe("clef delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
  });

  it("should delete a key from a single file with confirmation", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY_TO_DELETE"]);

    expect(mockFormatter.confirm).toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Deleted 'KEY_TO_DELETE'"),
    );
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY_TO_DELETE"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.key).toBe("KEY_TO_DELETE");
    expect(data.namespace).toBe("database");
    expect(data.environment).toBe("dev");
    expect(data.action).toBe("deleted");

    isJsonMode.mockReturnValue(false);
  });

  it("should abort when confirmation is denied", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY_TO_DELETE"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should error when key does not exist", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "NONEXISTENT"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output JSON with --json flag for --all-envs", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database", "KEY_TO_DELETE", "--all-envs"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.key).toBe("KEY_TO_DELETE");
    expect(data.namespace).toBe("database");
    expect(data.action).toBe("deleted");
    expect(data.environments).toBeDefined();

    isJsonMode.mockReturnValue(false);
  });

  it("should delete from all environments with --all-envs", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database", "KEY_TO_DELETE", "--all-envs"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("environments"));
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("all environments"));
  });

  it("should abort --all-envs when confirmation denied", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database", "KEY", "--all-envs"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
  });

  it("should show confirmation for protected environment on single delete", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/production", "KEY_TO_DELETE"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("protected"));
  });

  it("should abort single delete on protected env when declined", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/production", "KEY_TO_DELETE"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should list protected envs in --all-envs confirmation", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database", "KEY_TO_DELETE", "--all-envs"]);

    const confirmCall = (mockFormatter.confirm as jest.Mock).mock.calls[0][0];
    expect(confirmCall).toContain("protected environments: production");
  });

  it("should abort --all-envs with protected envs when declined", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database", "KEY", "--all-envs"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should exit 1 on invalid target without --all-envs", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "bad", "KEY"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle dependency error and call formatDependencyError", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        if (cmd === "sops" && args[0] === "--version")
          return { stdout: "", stderr: "not found", exitCode: 127 };
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should call markResolved after successful single delete", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY_TO_DELETE"]);

    const { markResolved: mockMarkResolved } = jest.requireMock("@clef-sh/core");
    expect(mockMarkResolved).toHaveBeenCalledWith(
      expect.stringContaining("database/dev.enc.yaml"),
      ["KEY_TO_DELETE"],
    );
  });

  it("should warn but succeed when markResolved fails after delete", async () => {
    const { markResolved: mockMarkResolved } = jest.requireMock("@clef-sh/core");
    mockMarkResolved.mockRejectedValueOnce(new Error("disk full"));
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "delete", "database/dev", "KEY_TO_DELETE"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("pending metadata could not be cleaned up"),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Deleted"));
  });
});
