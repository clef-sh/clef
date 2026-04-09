import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerGetCommand } from "./get";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../clipboard", () => ({
  copyToClipboard: jest.fn().mockReturnValue(true),
  maskedPlaceholder: jest.fn().mockReturnValue("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"),
}));
jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    keyValue: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn().mockResolvedValue("secret"),
    formatDependencyError: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
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
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerGetCommand(program, { runner });
  return program;
}

describe("clef get", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
  });

  it("should print the raw value to stdout", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "DB_URL: postgres://localhost\nDB_POOL: 10\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1test\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "get", "database/dev", "DB_URL"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("clipboard"));
  });

  it("should exit 1 when key does not exist", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "OTHER_KEY: value\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1test\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "get", "database/dev", "MISSING_KEY"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 on invalid target format", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "get", "invalid-target", "KEY"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid target"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "DB_URL: postgres://localhost\nDB_POOL: 10\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1test\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "get", "database/dev", "DB_URL"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.key).toBe("DB_URL");
    expect(data.value).toBe("postgres://localhost");
    expect(data.namespace).toBe("database");
    expect(data.environment).toBe("dev");

    isJsonMode.mockReturnValue(false);
  });

  it("should exit 1 on decryption error", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "decrypt failed", exitCode: 1 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "get", "database/dev", "KEY"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
