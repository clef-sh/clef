import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerCompareCommand } from "./compare";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
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

function makeSopsRunner(values: Record<string, string>): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "age") {
        return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        const yamlOut = Object.entries(values)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        return { stdout: yamlOut + "\n", stderr: "", exitCode: 0 };
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
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerCompareCommand(program, { runner });
  return program;
}

describe("clef compare", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
  });

  it("should report match when values are equal", async () => {
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost", DB_POOL: "10" });
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "compare",
      "database/dev",
      "DB_URL",
      "postgres://localhost",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("values match"));
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should report mismatch when values differ (exit 1)", async () => {
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost" });
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "database/dev", "DB_URL", "wrong-value"]);

    expect(mockFormatter.failure).toHaveBeenCalledWith(
      expect.stringContaining("values do not match"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use secretPrompt when value is omitted", async () => {
    (mockFormatter.secretPrompt as jest.Mock).mockResolvedValueOnce("postgres://localhost");
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost" });
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "database/dev", "DB_URL"]);

    expect(mockFormatter.secretPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Enter value to compare"),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("values match"));
  });

  it("should warn about shell history when value is provided as argument", async () => {
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost" });
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "compare",
      "database/dev",
      "DB_URL",
      "postgres://localhost",
    ]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("shell history"));
  });

  it("should not warn when value is omitted", async () => {
    (mockFormatter.secretPrompt as jest.Mock).mockResolvedValueOnce("postgres://localhost");
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost" });
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "database/dev", "DB_URL"]);

    expect(mockFormatter.warn).not.toHaveBeenCalled();
  });

  it("should error when key is not found (exit 1)", async () => {
    const runner = makeSopsRunner({ DB_URL: "postgres://localhost" });
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "database/dev", "MISSING_KEY", "value"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Key 'MISSING_KEY' not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error on invalid target format", async () => {
    const runner = makeSopsRunner({});
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "invalid-target", "KEY", "value"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Expected format: namespace/environment"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should report mismatch when lengths differ", async () => {
    const runner = makeSopsRunner({ TOKEN: "abc" });
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "compare", "database/dev", "TOKEN", "abcd"]);

    expect(mockFormatter.failure).toHaveBeenCalledWith(
      expect.stringContaining("values do not match"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
