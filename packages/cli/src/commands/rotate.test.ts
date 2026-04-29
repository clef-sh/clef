import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerRotateCommand } from "./rotate";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
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
    confirm: jest.fn(),
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
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "payments", description: "Pay" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerRotateCommand(program, { runner });
  return program;
}

describe("clef rotate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
  });

  it("should rotate key and show confirmation", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "rotate") return { stdout: "", stderr: "", exitCode: 0 };
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1old\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "rotate", "payments/dev", "--new-key", "age1newkey"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Rotated"));
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("Rotating payments/dev"),
    );
    expect(mockFormatter.hint).toHaveBeenCalledWith(
      expect.stringContaining("git add payments/dev.enc.yaml"),
    );
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
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "rotate") return { stdout: "", stderr: "", exitCode: 0 };
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1old\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "rotate", "payments/dev", "--new-key", "age1newkey"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.namespace).toBe("payments");
    expect(data.environment).toBe("dev");
    expect(data.file).toBe("payments/dev.enc.yaml");
    expect(data.action).toBe("rotated");

    isJsonMode.mockReturnValue(false);
  });

  it("should show confirm prompt for protected environments", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "rotate") return { stdout: "", stderr: "", exitCode: 0 };
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1old\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "rotate",
      "payments/production",
      "--new-key",
      "age1new",
    ]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("protected"));
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Rotated"));
  });

  it("should cancel rotation when user declines confirmation", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "rotate",
      "payments/production",
      "--new-key",
      "age1new",
    ]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Rotation cancelled.");
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockFormatter.success).not.toHaveBeenCalled();
    // No SOPS calls should be made after declining
    const sopsRotateCalls = (runner.run as jest.Mock).mock.calls.filter(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "rotate",
    );
    expect(sopsRotateCalls).toHaveLength(0);
  });

  it("should not prompt for non-protected environments", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "rotate") return { stdout: "", stderr: "", exitCode: 0 };
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1old\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "rotate", "payments/dev", "--new-key", "age1newkey"]);

    expect(mockFormatter.confirm).not.toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Rotated"));
  });

  it("should exit 1 on rotation failure", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "rotate")
          return { stdout: "", stderr: "rotation failed", exitCode: 1 };
        if (cmd === "sops" && args[0] === "filestatus")
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd === "cat") {
          return {
            stdout: "sops:\n  age:\n    - recipient: age1old\n  lastmodified: '2024-01-15'\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "rotate", "payments/dev", "--new-key", "age1new"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 on invalid target", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "rotate", "bad", "--new-key", "k"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
