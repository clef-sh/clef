import * as fs from "fs";
import * as YAML from "yaml";
import * as childProcess from "child_process";
import { EventEmitter } from "events";
import { Command } from "commander";
import { registerExecCommand } from "./exec";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("child_process");
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
const mockSpawn = childProcess.spawn as jest.Mock;

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [
    { name: "payments", description: "Payments" },
    { name: "auth", description: "Auth" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

// Per-namespace cell blob content, used both as the bytes
// `FilesystemStorageBackend.readBlob` returns and as a marker the runner
// mock keys off (since `sops decrypt` now reads from `/dev/stdin` —
// the cell-distinguishing filePath is no longer in argv).
const authCellBlob = YAML.stringify({
  __marker: "auth-cell",
  sops: { age: [{ recipient: "age1abc" }], lastmodified: "2024-01-15T00:00:00Z" },
});
const paymentsCellBlob = YAML.stringify({
  __marker: "payments-cell",
  sops: { age: [{ recipient: "age1abc" }], lastmodified: "2024-01-15T00:00:00Z" },
});

function makeRunner(): SubprocessRunner {
  return {
    run: jest
      .fn()
      .mockImplementation(async (cmd: string, args: string[], opts?: { stdin?: string }) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          // After the SecretSource flip the input file is /dev/stdin and
          // the cell-distinguishing content arrives via opts.stdin.
          const stdin = opts?.stdin ?? "";
          if (stdin.includes("auth-cell")) {
            return {
              stdout: YAML.stringify({ AUTH_TOKEN: "tok-789", API_KEY: "auth-override" }),
              stderr: "",
              exitCode: 0,
            };
          }
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
          return { stdout: paymentsCellBlob, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
  };
}

function makeChildEmitter(exitCode: number): EventEmitter {
  const child = new EventEmitter();
  Object.defineProperty(child, "kill", {
    value: jest.fn(),
    writable: true,
    configurable: true,
  });
  // Simulate async exit
  setTimeout(() => child.emit("exit", exitCode, null), 10);
  return child;
}

function makeSignalChildEmitter(signal: string): EventEmitter {
  const child = new EventEmitter();
  Object.defineProperty(child, "kill", {
    value: jest.fn(),
    writable: true,
    configurable: true,
  });
  // Simulate async exit via signal (exitCode is null when killed by signal)
  setTimeout(() => child.emit("exit", null, signal), 10);
  return child;
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerExecCommand(program, { runner });
  return program;
}

// Save original process.argv
const originalArgv = process.argv;

describe("clef exec", () => {
  let sigtermListeners: NodeJS.SignalsListener[];
  let sigintListeners: NodeJS.SignalsListener[];

  beforeEach(() => {
    jest.clearAllMocks();
    // Dispatch by path: the manifest needs to round-trip as a manifest;
    // cell paths return per-namespace cell blobs so the SecretSource ->
    // SopsClient.decryptBlob pipeline sees realistic-shaped ciphertext.
    mockFs.readFileSync.mockImplementation(((p: fs.PathOrFileDescriptor): string => {
      const ps = String(p);
      if (ps.endsWith("clef.yaml")) return validManifestYaml;
      if (ps.includes("/auth/")) return authCellBlob;
      if (ps.includes("/payments/")) return paymentsCellBlob;
      return validManifestYaml;
    }) as never);
    mockFs.existsSync.mockReturnValue(true);
    process.argv = originalArgv;
    // Record existing signal listeners before each test
    sigtermListeners = process.listeners("SIGTERM") as NodeJS.SignalsListener[];
    sigintListeners = process.listeners("SIGINT") as NodeJS.SignalsListener[];
  });

  afterEach(() => {
    // Remove any signal listeners added during the test to prevent leaks
    const currentSigterm = process.listeners("SIGTERM") as NodeJS.SignalsListener[];
    const currentSigint = process.listeners("SIGINT") as NodeJS.SignalsListener[];
    for (const listener of currentSigterm) {
      if (!sigtermListeners.includes(listener)) {
        process.removeListener("SIGTERM", listener);
      }
    }
    for (const listener of currentSigint) {
      if (!sigintListeners.includes(listener)) {
        process.removeListener("SIGINT", listener);
      }
    }
  });

  afterAll(() => {
    process.argv = originalArgv;
  });

  it("should spawn child with correct environment variables", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    // Simulate process.argv with --
    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "node",
      ["server.js"],
      expect.objectContaining({ stdio: "inherit" }),
    );

    // Verify env contains the decrypted values
    const spawnCall = mockSpawn.mock.calls[0];
    const env = spawnCall[2].env;
    expect(env.DATABASE_URL).toBe("postgres://localhost");
    expect(env.API_KEY).toBe("sk-123");
  });

  it("should filter keys with --only flag", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--only", "DATABASE_URL", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--only",
      "DATABASE_URL",
      "--",
      "env",
    ]);

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.DATABASE_URL).toBe("postgres://localhost");
    expect(env.API_KEY).toBeUndefined();
  });

  it("should prefix keys with --prefix flag", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--prefix", "APP_", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--prefix",
      "APP_",
      "--",
      "env",
    ]);

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.APP_DATABASE_URL).toBe("postgres://localhost");
    expect(env.APP_API_KEY).toBe("sk-123");
  });

  it("should not override existing env vars with --no-override", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    // Set an existing env var
    const origDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "already-set";

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--no-override", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--no-override",
      "--",
      "env",
    ]);

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.DATABASE_URL).toBe("already-set");
    expect(env.API_KEY).toBe("sk-123");

    // Restore
    if (origDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = origDbUrl;
    }
  });

  it("should forward child process exit code", async () => {
    const child = makeChildEmitter(42);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "exit", "42"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "exit", "42"]);

    expect(mockExit).toHaveBeenCalledWith(42);
  });

  it("should show error on SOPS decryption failure without leaking values", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "decrypt failed", exitCode: 1 };
      }),
    };
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
    // Ensure no decrypted values appear in error messages
    const errorCalls = mockFormatter.error.mock.calls.map((c) => String(c[0]));
    for (const msg of errorCalls) {
      expect(msg).not.toContain("postgres://");
      expect(msg).not.toContain("sk-123");
    }
  });

  it("should show helpful error when -- separator is missing", async () => {
    // Mock process.exit to throw so execution stops
    mockExit.mockImplementationOnce(() => {
      throw new Error("process.exit");
    });

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev"];

    try {
      await program.parseAsync(["node", "clef", "exec", "payments/dev"]);
    } catch {
      // Expected — mockExit throws
    }

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Missing command"));
    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("--"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should warn on protected environment but not block", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/production", "--", "node", "server.js"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/production",
      "--",
      "node",
      "server.js",
    ]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("protected"));
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("should handle spawn error gracefully without leaking values", async () => {
    const child = new EventEmitter();
    mockSpawn.mockReturnValue(child);
    setTimeout(() => child.emit("error", new Error("ENOENT")), 10);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "nonexistent-command"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "nonexistent-command"]);

    expect(mockExit).toHaveBeenCalledWith(1);

    // Assert decrypted values are absent from ALL error output
    const allErrorCalls = mockFormatter.error.mock.calls.flat().join(" ");
    expect(allErrorCalls).not.toContain("postgres://");
    expect(allErrorCalls).not.toContain("sk-123");

    // Also check warn and info channels
    const allOtherOutput = [
      ...mockFormatter.warn.mock.calls.flat(),
      ...mockFormatter.info.mock.calls.flat(),
    ].join(" ");
    expect(allOtherOutput).not.toContain("postgres://");
    expect(allOtherOutput).not.toContain("sk-123");
  });

  // --also flag tests

  it("should merge values from --also targets with correct precedence", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    // auth/dev has API_KEY: "auth-override" which should override payments/dev API_KEY: "sk-123"
    process.argv = ["node", "clef", "exec", "payments/dev", "--also", "auth/dev", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--also",
      "auth/dev",
      "--",
      "env",
    ]);

    const env = mockSpawn.mock.calls[0][2].env;
    // Primary target's unique key
    expect(env.DATABASE_URL).toBe("postgres://localhost");
    // --also target's unique key
    expect(env.AUTH_TOKEN).toBe("tok-789");
    // Duplicate key: --also overrides primary
    expect(env.API_KEY).toBe("auth-override");
  });

  it("should respect --no-override with --also targets", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    // Set an existing env var that conflicts
    const origApiKey = process.env.API_KEY;
    process.env.API_KEY = "existing-key";

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = [
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--also",
      "auth/dev",
      "--no-override",
      "--",
      "env",
    ];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--also",
      "auth/dev",
      "--no-override",
      "--",
      "env",
    ]);

    const env = mockSpawn.mock.calls[0][2].env;
    // Existing env var preserved with --no-override
    expect(env.API_KEY).toBe("existing-key");
    // New keys from primary and --also still injected
    expect(env.DATABASE_URL).toBe("postgres://localhost");
    expect(env.AUTH_TOKEN).toBe("tok-789");

    // Restore
    if (origApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = origApiKey;
    }
  });

  it("should exit 1 when --also target fails to decrypt", async () => {
    const runner: SubprocessRunner = {
      run: jest
        .fn()
        .mockImplementation(async (cmd: string, args: string[], opts?: { stdin?: string }) => {
          if (cmd === "age") {
            return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
          }
          if (cmd === "sops" && args[0] === "--version") {
            return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
          }
          if (cmd === "sops" && args[0] === "decrypt") {
            const stdin = opts?.stdin ?? "";
            if (stdin.includes("auth-cell")) {
              return { stdout: "", stderr: "decrypt failed for auth", exitCode: 1 };
            }
            return {
              stdout: YAML.stringify({ DATABASE_URL: "postgres://localhost" }),
              stderr: "",
              exitCode: 0,
            };
          }
          if (cmd === "sops" && args[0] === "filestatus") {
            return { stdout: "", stderr: "", exitCode: 1 };
          }
          if (cmd === "cat") {
            return { stdout: paymentsCellBlob, stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
    };

    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--also", "auth/dev", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--also",
      "auth/dev",
      "--",
      "env",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("--also 'auth/dev'"));
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("should remove signal handlers after child exits", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const listenerCountBefore = process.listenerCount("SIGTERM");

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    // After child exits, signal handlers should be cleaned up
    expect(process.listenerCount("SIGTERM")).toBe(listenerCountBefore);
  });

  // Signal exit code mapping tests

  it("should exit with code 143 when child is killed by SIGTERM", async () => {
    const child = makeSignalChildEmitter("SIGTERM");
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    expect(mockExit).toHaveBeenCalledWith(143);
  });

  it("should exit with code 130 when child is killed by SIGINT", async () => {
    const child = makeSignalChildEmitter("SIGINT");
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    expect(mockExit).toHaveBeenCalledWith(130);
  });

  // --dir flag test

  it("should use --dir path instead of cwd for manifest lookup", async () => {
    const child = makeChildEmitter(0);
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "--dir", "/custom/repo", "exec", "payments/dev", "--", "env"];
    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/custom/repo",
      "exec",
      "payments/dev",
      "--",
      "env",
    ]);

    // Verify manifest was loaded from /custom/repo
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("/custom/repo/clef.yaml"),
      "utf-8",
    );
  });

  it("should error when empty command is given after --", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    // process.argv has -- but nothing after it
    process.argv = ["node", "clef", "exec", "payments/dev", "--"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing command to execute after"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle dependency error (SopsMissingError) and call formatDependencyError", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "age") {
          return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "", stderr: "not found", exitCode: 127 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "echo", "hello"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "echo", "hello"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should handle spawn throwing synchronously", async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "nonexistent"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "nonexistent"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to start command"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should forward SIGTERM to child process", async () => {
    const killMock = jest.fn();
    const child = new EventEmitter();
    // Define kill as own property on the emitter to simulate ChildProcess
    Object.defineProperty(child, "kill", { value: killMock, writable: true, configurable: true });
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    const promise = program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--",
      "node",
      "server.js",
    ]);

    // Wait for spawn to occur, then emit SIGTERM
    await new Promise((r) => setTimeout(r, 50));
    process.emit("SIGTERM", "SIGTERM");

    expect(killMock).toHaveBeenCalledWith("SIGTERM");

    // Now let the child exit so the test can finish
    child.emit("exit", 143, "SIGTERM");
    await promise;
  });

  it("should forward SIGINT to child process", async () => {
    const killMock = jest.fn();
    const child = new EventEmitter();
    Object.defineProperty(child, "kill", { value: killMock, writable: true, configurable: true });
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    const promise = program.parseAsync([
      "node",
      "clef",
      "exec",
      "payments/dev",
      "--",
      "node",
      "server.js",
    ]);

    // Wait for spawn to occur, then emit SIGINT
    await new Promise((r) => setTimeout(r, 50));
    process.emit("SIGINT", "SIGINT");

    expect(killMock).toHaveBeenCalledWith("SIGINT");

    // Now let the child exit so the test can finish
    child.emit("exit", 130, "SIGINT");
    await promise;
  });

  it("should error on invalid target format", async () => {
    // Mock process.exit to throw so execution stops
    mockExit.mockImplementationOnce(() => {
      throw new Error("process.exit");
    });

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "invalidtarget", "--", "echo", "hello"];
    try {
      await program.parseAsync(["node", "clef", "exec", "invalidtarget", "--", "echo", "hello"]);
    } catch {
      // Expected — mockExit throws
    }

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid target"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should map SIGHUP to exit code 129", async () => {
    const child = makeSignalChildEmitter("SIGHUP");
    mockSpawn.mockReturnValue(child);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    expect(mockExit).toHaveBeenCalledWith(129);
  });

  it("should exit with correct 128+N code for any signal", async () => {
    const child = new EventEmitter();
    mockSpawn.mockReturnValue(child);
    setTimeout(() => child.emit("exit", null, "SIGUSR1"), 10);

    const runner = makeRunner();
    const program = makeProgram(runner);

    process.argv = ["node", "clef", "exec", "payments/dev", "--", "node", "server.js"];
    await program.parseAsync(["node", "clef", "exec", "payments/dev", "--", "node", "server.js"]);

    // SIGUSR1 = signal 30 on macOS, 10 on Linux — the exact code varies by OS
    const exitCode = mockExit.mock.calls[0][0] as number;
    expect(exitCode).toBeGreaterThan(128);
    expect(exitCode).toBeLessThanOrEqual(128 + 64);
  });
});
