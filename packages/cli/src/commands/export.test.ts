import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerExportCommand } from "./export";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../clipboard", () => ({
  copyToClipboard: jest.fn().mockReturnValue(true),
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
  namespaces: [{ name: "payments", description: "Payments" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const sopsFileContent = YAML.stringify({
  sops: {
    age: [{ recipient: "age1abc" }],
    lastmodified: "2024-01-15T00:00:00Z",
  },
});

function makeRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "age") {
        return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        return {
          stdout: YAML.stringify({
            DATABASE_URL: "postgres://localhost",
            API_KEY: "sk-123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (cmd === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (cmd === "cat") {
        return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerExportCommand(program, { runner });
  return program;
}

// Save original platform
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

describe("clef export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
  });

  afterAll(() => {
    // Restore platform
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("should output export statements for all keys with --raw", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--raw"]);

    expect(mockFormatter.raw).toHaveBeenCalledTimes(1);
    const output = mockFormatter.raw.mock.calls[0][0] as string;
    expect(output).toContain("export DATABASE_URL='postgres://localhost'");
    expect(output).toContain("export API_KEY='sk-123'");
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.namespace).toBe("payments");
    expect(data.environment).toBe("dev");
    expect(data.pairs).toEqual([
      { key: "DATABASE_URL", value: "postgres://localhost" },
      { key: "API_KEY", value: "sk-123" },
    ]);

    isJsonMode.mockReturnValue(false);
  });

  it("should handle special characters with proper quoting", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return {
            stdout: YAML.stringify({ PASSWORD: "p@ss'w\"rd$!" }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        if (cmd === "cat") {
          return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--raw"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    // Single quotes in values are escaped as '\''
    expect(output).toContain("export PASSWORD='p@ss'\\''w\"rd$!'");
  });

  it("should omit export keyword with --no-export", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--no-export", "--raw"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    expect(output).not.toContain("export ");
    expect(output).toContain("DATABASE_URL='postgres://localhost'");
    expect(output).toContain("API_KEY='sk-123'");
  });

  it("should reject dotenv format with explanation", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--format", "dotenv"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not supported"));
    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("plaintext secrets to disk"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should reject unknown format", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--format", "xml"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Unknown format"));
    expect(mockExit).toHaveBeenCalledWith(1);
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

    await program.parseAsync(["node", "clef", "export", "payments/dev"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 on invalid target", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "invalid"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid target"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  // Linux /proc warning tests

  it("should print /proc warning to stderr on Linux with --raw", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--raw"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("/proc/<pid>/environ"));
    expect(mockFormatter.raw).toHaveBeenCalled();
  });

  it("should not print /proc warning on non-Linux platforms with --raw", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "export", "payments/dev", "--raw"]);

    expect(mockFormatter.warn).not.toHaveBeenCalledWith(expect.stringContaining("/proc"));
    expect(mockFormatter.raw).toHaveBeenCalled();
  });

  // --dir flag test

  it("should use --dir path instead of cwd for manifest lookup", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/custom/secrets",
      "export",
      "payments/dev",
    ]);

    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("/custom/secrets/clef.yaml"),
      "utf-8",
    );
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

    await program.parseAsync(["node", "clef", "export", "payments/dev"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
