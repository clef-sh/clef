import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerDiffCommand } from "./diff";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";

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
    table: jest.fn(),
    confirm: jest.fn(),
    secretPrompt: jest.fn(),
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
    { name: "production", description: "Prod" },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function diffRunner(devVals: string, prodVals: string): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "age") {
        return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        const filePath = args[args.length - 1];
        if (filePath.includes("dev")) return { stdout: devVals, stderr: "", exitCode: 0 };
        return { stdout: prodVals, stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (cmd === "cat") {
        return {
          stdout: "sops:\n  age:\n    - recipient: age1\n  lastmodified: '2024-01-15'\n",
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
  registerDiffCommand(program, { runner });
  return program;
}

describe("clef diff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
  });

  it("should display diff table with masked values by default", async () => {
    const runner = diffRunner("KEY: dev_val\nDEV_ONLY: x\n", "KEY: prod_val\nPROD_ONLY: y\n");
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);

    expect(mockFormatter.table).toHaveBeenCalled();
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("changed"));
    expect(mockExit).toHaveBeenCalledWith(1);

    // Values should be masked by default — the actual values should NOT appear in the table
    const tableRows = (mockFormatter.table as jest.Mock).mock.calls[0][0];
    for (const row of tableRows) {
      // row[1] and row[2] are the values — should contain mask characters
      expect(row[1]).not.toContain("dev_val");
      expect(row[2]).not.toContain("prod_val");
    }
  });

  it("should show plaintext values with --show-values", async () => {
    const runner = diffRunner("KEY: dev_val\n", "KEY: prod_val\n");
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "diff",
      "database",
      "dev",
      "production",
      "--show-values",
    ]);

    expect(mockFormatter.table).toHaveBeenCalled();
    const tableRows = (mockFormatter.table as jest.Mock).mock.calls[0][0];
    // With --show-values, actual values should appear
    expect(tableRows[0][1]).toContain("dev_val");
    expect(tableRows[0][2]).toContain("prod_val");
  });

  it("should exit 0 when no differences", async () => {
    const runner = diffRunner("KEY: same\n", "KEY: same\n");
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("No differences"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should output JSON with --json flag and mask values by default", async () => {
    const runner = diffRunner("KEY: a\n", "KEY: b\n");
    const program = makeProgram(runner);

    (isJsonMode as jest.Mock).mockReturnValue(true);
    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);
    (isJsonMode as jest.Mock).mockReturnValue(false);

    expect(mockFormatter.json).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertion
    const parsed = mockFormatter.json.mock.calls[0][0] as any;
    expect(parsed.rows).toBeDefined();
    expect(parsed.envA).toBe("dev");
    // JSON output should mask values and include masked: true
    expect(parsed.rows[0].masked).toBe(true);
    expect(parsed.rows[0].valueA).not.toBe("a");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output JSON with --show-values and --json flag", async () => {
    const runner = diffRunner("KEY: a\n", "KEY: b\n");
    const program = makeProgram(runner);

    (isJsonMode as jest.Mock).mockReturnValue(true);
    await program.parseAsync([
      "node",
      "clef",
      "diff",
      "database",
      "dev",
      "production",
      "--show-values",
    ]);
    (isJsonMode as jest.Mock).mockReturnValue(false);

    expect(mockFormatter.json).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertion
    const parsed = mockFormatter.json.mock.calls[0][0] as any;
    // With --show-values, the JSON output should NOT add masked: true
    expect(parsed.rows[0].masked).toBeUndefined();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output JSON with missing keys and null values", async () => {
    const runner = diffRunner("DEV_ONLY: x\nSHARED: same\n", "PROD_ONLY: y\nSHARED: same\n");
    const program = makeProgram(runner);

    (isJsonMode as jest.Mock).mockReturnValue(true);
    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);
    (isJsonMode as jest.Mock).mockReturnValue(false);

    expect(mockFormatter.json).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertion
    const parsed = mockFormatter.json.mock.calls[0][0] as any;
    const rows = parsed.rows as Array<{
      key: string;
      valueA: string | null;
      valueB: string | null;
    }>;
    const devOnly = rows.find((r) => r.key === "DEV_ONLY");
    const prodOnly = rows.find((r) => r.key === "PROD_ONLY");
    // Missing values should be masked (not null) when not using --show-values
    expect(devOnly).toBeDefined();
    expect(prodOnly).toBeDefined();
  });

  it("should warn when --show-values on protected environment", async () => {
    const protectedManifestYaml = YAML.stringify({
      version: 1,
      environments: [
        { name: "dev", description: "Dev" },
        { name: "production", description: "Prod", protected: true },
      ],
      namespaces: [{ name: "database", description: "DB" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });
    mockFs.readFileSync.mockReturnValue(protectedManifestYaml);

    const runner = diffRunner("KEY: a\n", "KEY: b\n");
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "diff",
      "database",
      "dev",
      "production",
      "--show-values",
    ]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("printing plaintext values for protected environment"),
    );
  });

  it("should exit 0 for identical files with --json", async () => {
    const runner = diffRunner("KEY: same\n", "KEY: same\n");
    const program = makeProgram(runner);

    (isJsonMode as jest.Mock).mockReturnValue(true);
    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);
    (isJsonMode as jest.Mock).mockReturnValue(false);

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should show fix commands for missing keys", async () => {
    const runner = diffRunner("DEV_ONLY: val\n", "");
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);

    expect(mockFormatter.hint).toHaveBeenCalledWith("Fix:");
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("clef set"));
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
        return { stdout: "", stderr: "decrypt error", exitCode: 1 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should include identical rows with --show-identical", async () => {
    const runner = diffRunner("KEY: same\nOTHER: diff_a\n", "KEY: same\nOTHER: diff_b\n");
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "diff",
      "database",
      "dev",
      "production",
      "--show-identical",
    ]);

    expect(mockFormatter.table).toHaveBeenCalled();
    const tableRows = (mockFormatter.table as jest.Mock).mock.calls[0][0];
    expect(tableRows.length).toBe(2); // both rows shown
  });

  it("should use --dir path instead of cwd for manifest lookup", async () => {
    const runner = diffRunner("KEY: same\n", "KEY: same\n");
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/custom/repo",
      "diff",
      "database",
      "dev",
      "production",
    ]);

    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("/custom/repo/clef.yaml"),
      "utf-8",
    );
  });

  it("should handle dependency error and call formatDependencyError", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "age") return { stdout: "", stderr: "not found", exitCode: 127 };
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "diff", "database", "dev", "production"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
