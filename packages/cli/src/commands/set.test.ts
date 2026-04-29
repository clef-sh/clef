import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerSetCommand } from "./set";
import {
  SubprocessRunner,
  markPendingWithRetry,
  recordRotation,
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
    recordRotation: jest.fn().mockResolvedValue(undefined),
    generateRandomValue: jest.fn().mockReturnValue("a".repeat(64)),
    GitIntegration: jest.fn().mockImplementation(() => ({
      getAuthorIdentity: jest
        .fn()
        .mockResolvedValue({ name: "Test User", email: "test@example.com" }),
    })),
    TransactionManager: jest.fn().mockImplementation(() => ({
      run: jest
        .fn()
        .mockImplementation(
          async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
            await opts.mutate();
            return { sha: null, paths: opts.paths, startedDirty: false };
          },
        ),
    })),
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
    secretPrompt: jest.fn().mockResolvedValue("prompted-secret"),
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

function sopsRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "age") {
        return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        return { stdout: "EXISTING: old_value\n", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args.includes("encrypt")) {
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
  program.option("--dir <path>", "Path to a local Clef repository root");
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
    // The "git add" hint is gone — TransactionManager auto-commits.

    // Verify the secret value never appears in any formatter channel
    const channels = ["success", "print", "error", "warn", "info", "hint", "raw"] as const;
    for (const channel of channels) {
      for (const call of (mockFormatter[channel] as jest.Mock).mock.calls) {
        expect(call[0]).not.toContain("sk_test_123");
      }
    }
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "STRIPE_KEY", "sk_test_123"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.key).toBe("STRIPE_KEY");
    expect(data.namespace).toBe("payments");
    expect(data.environment).toBe("dev");
    expect(data.action).toBe("created");
    expect(data.pending).toBe(false);

    isJsonMode.mockReturnValue(false);
  });

  it("should output JSON with pending=true for --random --json", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "API_KEY", "--random"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.key).toBe("API_KEY");
    expect(data.namespace).toBe("payments");
    expect(data.environment).toBe("dev");
    expect(data.action).toBe("created");
    expect(data.pending).toBe(true);

    isJsonMode.mockReturnValue(false);
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

  it("should record rotation with author identity on normal set", async () => {
    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "STRIPE_KEY", "sk_live_real"]);

    // Normal set is a rotation: we record it and the author identity
    // flows from git config through to the stored `rotated_by`.
    expect(recordRotation).toHaveBeenCalledWith(
      expect.stringContaining("payments/dev.enc.yaml"),
      ["STRIPE_KEY"],
      "Test User <test@example.com>",
    );
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

  it("propagates markPendingWithRetry failure so the transaction can roll back", async () => {
    const mockMarkPendingWithRetry = markPendingWithRetry as jest.Mock;
    mockMarkPendingWithRetry.mockRejectedValueOnce(new Error("disk full"));

    const runner = sopsRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "set", "payments/dev", "KEY", "--random"]);

    // The pending-metadata write now lives inside tx.run alongside the
    // encrypt, so a metadata failure tears the whole transaction down via
    // git reset. handleCommandError surfaces the underlying error and
    // exits non-zero; the manual "encrypted-but-pending-failed" rollback
    // dance is gone.
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("does not call markPending when encrypt fails", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
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
        if (cmd === "sops" && args.includes("encrypt")) {
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
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
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
        if (cmd === "sops" && args.includes("encrypt")) {
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

  describe("--all-envs", () => {
    it("should output JSON with --json flag for --all-envs", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      mockFormatter.secretPrompt.mockResolvedValue("shared-secret");
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "set", "payments", "API_KEY", "--all-envs"]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.key).toBe("API_KEY");
      expect(data.namespace).toBe("payments");
      expect(data.action).toBe("created");
      expect(data.pending).toBe(false);
      expect(data.environments).toBeDefined();

      isJsonMode.mockReturnValue(false);
    });

    it("should set the same value in all environments", async () => {
      mockFormatter.secretPrompt.mockResolvedValue("shared-secret");
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "set", "payments", "API_KEY", "--all-envs"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("payments across all environments"),
      );
      // sops encrypt called once per environment
      const encryptCalls = (runner.run as jest.Mock).mock.calls.filter(
        (c) => c[0] === "sops" && (c[1] as string[]).includes("encrypt"),
      );
      expect(encryptCalls.length).toBe(2); // dev + production
    });

    it("should output JSON with --json flag for --random --all-envs", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "set",
        "payments",
        "WEBHOOK_SECRET",
        "--all-envs",
        "--random",
      ]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.key).toBe("WEBHOOK_SECRET");
      expect(data.namespace).toBe("payments");
      expect(data.action).toBe("created");
      expect(data.pending).toBe(true);

      isJsonMode.mockReturnValue(false);
    });

    it("should generate distinct random values per env with --random --all-envs", async () => {
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "set",
        "payments",
        "WEBHOOK_SECRET",
        "--all-envs",
        "--random",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("payments across all environments"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("pending"));
    });

    it("should prompt for confirmation when protected envs exist", async () => {
      mockFormatter.confirm.mockResolvedValueOnce(false);
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "set", "payments", "API_KEY", "--all-envs"]);

      expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    });

    it("should accept namespace/env format and extract namespace", async () => {
      mockFormatter.secretPrompt.mockResolvedValue("value");
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "set", "payments/dev", "API_KEY", "--all-envs"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("payments across all environments"),
      );
    });

    it("should warn when value is passed as CLI argument", async () => {
      const runner = sopsRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "set",
        "payments",
        "API_KEY",
        "plain-text",
        "--all-envs",
      ]);

      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("shell history"));
    });
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
