import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerSetCommand } from "./set";
import {
  SubprocessRunner,
  markPendingWithRetry,
  markResolved,
  generateRandomValue,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    markPendingWithRetry: jest.fn().mockResolvedValue(undefined),
    markResolved: jest.fn().mockResolvedValue(undefined),
    generateRandomValue: jest.fn().mockReturnValue("a".repeat(64)),
  };
});
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    hint: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn().mockResolvedValue("prompted-secret"),
    formatDependencyError: jest.fn(),
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
  namespaces: [{ name: "payments", description: "Pay" }],
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
        return { stdout: "EXISTING: old_value\n", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "encrypt") {
        return { stdout: "encrypted-content", stderr: "", exitCode: 0 };
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
      if (cmd === "tee") return { stdout: "", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--repo <path>", "Repository root");
  program.exitOverride();
  registerSetCommand(program, { runner });
  return program;
}

describe("clef set", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
  });

  it("should set a value and confirm without printing the value", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "STRIPE_KEY", "sk_test_123"]);

    expect(mockFormatter.success).toHaveBeenCalledWith("STRIPE_KEY set in payments/dev");
    expect(mockFormatter.hint).toHaveBeenCalledWith("Commit: git add payments/dev.enc.yaml");

    // Verify the secret value never appears in stdout
    for (const call of (mockFormatter.success as jest.Mock).mock.calls) {
      expect(call[0]).not.toContain("sk_test_123");
    }
    for (const call of (mockFormatter.print as jest.Mock).mock.calls) {
      expect(call[0]).not.toContain("sk_test_123");
    }
  });

  it("should prompt for value when not provided", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "STRIPE_KEY"]);

    expect(mockFormatter.secretPrompt).toHaveBeenCalledWith(expect.stringContaining("STRIPE_KEY"));
    expect(mockFormatter.success).toHaveBeenCalledWith("STRIPE_KEY set in payments/dev");
  });

  it("should require confirmation for protected environments", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/production", "KEY", "value"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("protected"));
  });

  it("should abort when confirmation is denied for protected env", async () => {
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/production", "KEY", "value"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should exit 1 on invalid target", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "bad", "KEY", "val"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should generate random value and mark pending with --random flag", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "API_KEY", "--random"]);

    expect(generateRandomValue).toHaveBeenCalled();
    expect(markPendingWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("payments/dev.enc.yaml"),
      ["API_KEY"],
      "clef set --random",
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("API_KEY set in payments/dev"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Marked as pending"));
    expect(mockFormatter.hint).toHaveBeenCalledWith("clef set payments/dev API_KEY");
  });

  it("should call markResolved on normal set", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "STRIPE_KEY", "sk_live_real"]);

    expect(markResolved).toHaveBeenCalledWith(expect.stringContaining("payments/dev.enc.yaml"), [
      "STRIPE_KEY",
    ]);
  });

  it("should reject --random with an explicit value", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "set",
      "payments/dev",
      "KEY",
      "some-value",
      "--random",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot use --random and provide a value simultaneously"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("warns when encrypt succeeds but markPendingWithRetry fails", async () => {
    const mockMarkPendingWithRetry = markPendingWithRetry as jest.Mock;
    mockMarkPendingWithRetry.mockRejectedValueOnce(new Error("disk full"));

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "KEY", "--random"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("encrypted but pending state could not be recorded"),
    );
    // Should still report success
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("KEY set in payments/dev"),
    );
  });

  it("does not call markPending when encrypt fails", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "KEY: old\n", stderr: "", exitCode: 0 };
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
        if (cmd === "sops" && args[0] === "encrypt") {
          return { stdout: "", stderr: "encryption failed", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "KEY", "--random"]);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(markPendingWithRetry).not.toHaveBeenCalled();
  });

  it("should exit 1 on encryption error", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "KEY: old\n", stderr: "", exitCode: 0 };
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
        if (cmd === "sops" && args[0] === "encrypt") {
          return { stdout: "", stderr: "encrypt failed", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "KEY", "val"]);

    expect(mockFormatter.error).toHaveBeenCalled();
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

    await program.parseAsync(["node", "clef", "set", "payments/dev", "KEY", "val"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
