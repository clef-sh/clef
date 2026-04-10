import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Command } from "commander";
import writeFileAtomic from "write-file-atomic";
import { registerInitCommand } from "./init";
import { SubprocessRunner, markPending } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { setKeychainKey } from "../keychain";

jest.mock("fs");
jest.mock("readline");
// write-file-atomic is auto-mocked via CLI's jest.config moduleNameMapper.
jest.mock("../keychain", () => ({
  setKeychainKey: jest.fn().mockResolvedValue(false),
}));
jest.mock("../label-generator", () => ({
  generateKeyLabel: jest.fn().mockReturnValue("test-label"),
}));

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    markPending: jest.fn().mockResolvedValue(undefined),
    generateRandomValue: jest.fn().mockReturnValue("b".repeat(64)),
    generateAgeIdentity: jest.fn().mockResolvedValue({
      privateKey: "AGE-SECRET-KEY-1MOCKPRIVATEKEY1234",
      publicKey: "age1mockpublickey00000000000000000000000000000000000000000000",
    }),
    formatAgeKeyFile: jest
      .fn()
      .mockReturnValue(
        "# created: 2024-01-01T00:00:00.000Z\n# public key: age1mockpublickey00000000000000000000000000000000000000000000\nAGE-SECRET-KEY-1MOCKPRIVATEKEY1234\n",
      ),
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
jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));
jest.mock("util", () => ({
  ...jest.requireActual("util"),
  promisify: jest.fn().mockImplementation(
    (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result?: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        }),
  ),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const mockSetKeychainKey = setKeychainKey as jest.Mock;

// Helpers to access mocked functions after hoisting
function getMockGenerateAgeIdentity(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@clef-sh/core").generateAgeIdentity as jest.Mock;
}

function getMockExecFile(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("child_process").execFile as jest.Mock;
}

// Helper: repoRoot IS a git repo, but key storage paths are NOT (the happy-path default)
function setupGitRepoWithSafeKeyPath(): void {
  const cwd = path.resolve(process.cwd());
  getMockExecFile().mockImplementation(
    (
      _cmd: string,
      args: string[],
      cb: (err: Error | null, result?: { stdout: string }) => void,
    ) => {
      const dir = path.resolve(args[1]); // -C <dir>
      if (dir === cwd) {
        cb(null, { stdout: "true\n" });
      } else {
        cb(new Error("not a repo"));
      }
    },
  );
}

// Helper: configure execFile so that NO directory is a git repo
function setupNotGitRepo(): void {
  getMockExecFile().mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(new Error("not a repo"));
    },
  );
}

// Helper: configure execFile so that ALL directories are git repos (including key paths)
function setupInsideGitRepo(): void {
  getMockExecFile().mockImplementation(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, result?: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "true\n" });
    },
  );
}

function mockRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerInitCommand(program, { runner });
  return program;
}

describe("clef init", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.mkdirSync.mockReturnValue(undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    // Default: repoRoot is a git repo, key paths are not
    setupGitRepoWithSafeKeyPath();
    // Default: keychain store fails (filesystem fallback)
    mockSetKeychainKey.mockResolvedValue(false);
    // Clean up env vars that may be set by keychain-success tests
    delete process.env.CLEF_AGE_KEY;
  });

  it("should print 'Already initialised' when both clef.yaml and .clef/config.yaml exist", async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.includes("clef.yaml") || s.includes(".clef");
    });
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("Already initialised"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should run second-dev onboarding when manifest exists but .clef/config.yaml does not", async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue("");
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    // Should have written .clef/config.yaml
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.yaml"),
      expect.any(String),
      "utf-8",
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining(".clef/config.yaml"),
    );
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  it("should create clef.yaml and generate age key in full setup", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "database,auth",
      "--non-interactive",
    ]);

    // clef.yaml should be written via write-file-atomic
    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("version: 1"),
    );

    // age key should have been generated
    expect(getMockGenerateAgeIdentity()).toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("clef.yaml"));
  });

  it("should write .clef/config.yaml with the key path and label", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const configContent = String(configCall![1]);
    expect(configContent).toContain("age_key_file");
    expect(configContent).toContain("age_keychain_label: test-label");
  });

  it("should write .clef/.gitignore during full setup", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const gitignoreCall = mockFs.writeFileSync.mock.calls.find(
      (c) => String(c[0]).includes(".clef") && String(c[0]).includes(".gitignore"),
    );
    expect(gitignoreCall).toBeDefined();
    expect(String(gitignoreCall![1])).toBe("*\n");
  });

  it("should error when no namespaces provided", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("namespace"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should fail when not inside a git repository", async () => {
    setupNotGitRepo();
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("git repository"));
    expect(mockExit).toHaveBeenCalledWith(1);
    // Should not have written any files
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should fail when not in a git repo even for second-dev onboarding", async () => {
    setupNotGitRepo();
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("clef.yaml")) return true;
      return false;
    });
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("git repository"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use custom --secrets-dir in file_pattern", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "db",
      "--secrets-dir",
      "config/encrypted",
      "--non-interactive",
    ]);

    const manifestCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
      String(c[0]).includes("clef.yaml"),
    );
    expect(manifestCall).toBeDefined();
    expect(String(manifestCall![1])).toContain(
      "config/encrypted/{namespace}/{environment}.enc.yaml",
    );
  });

  it("should use default secrets dir when --secrets-dir is not provided", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const manifestCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
      String(c[0]).includes("clef.yaml"),
    );
    expect(manifestCall).toBeDefined();
    expect(String(manifestCall![1])).toContain("secrets/{namespace}/{environment}.enc.yaml");
  });

  it("should prompt for secrets directory in interactive mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1)
          cb("dev"); // environments
        else if (questionCallCount === 2)
          cb("db"); // namespaces
        else if (questionCallCount === 3)
          cb("vault"); // secrets dir
        else cb(""); // key path
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init"]);

    const manifestCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
      String(c[0]).includes("clef.yaml"),
    );
    expect(manifestCall).toBeDefined();
    expect(String(manifestCall![1])).toContain("vault/{namespace}/{environment}.enc.yaml");

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should handle custom backend (pgp) — no age key generated", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "db",
      "--backend",
      "pgp",
      "--non-interactive",
    ]);

    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("pgp"),
    );
    // age identity should NOT be generated for pgp backend
    expect(getMockGenerateAgeIdentity()).not.toHaveBeenCalled();
  });

  it("should handle awskms backend", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "db",
      "--backend",
      "awskms",
      "--non-interactive",
    ]);

    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("awskms"),
    );
    expect(getMockGenerateAgeIdentity()).not.toHaveBeenCalled();
  });

  it("should handle gcpkms backend", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "db",
      "--backend",
      "gcpkms",
      "--non-interactive",
    ]);

    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("gcpkms"),
    );
    expect(getMockGenerateAgeIdentity()).not.toHaveBeenCalled();
  });

  it("should warn when pre-commit hook install fails", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        }
        if (cmd === "tee") return { stdout: "", stderr: "no .git", exitCode: 1 };
        return { stdout: "encrypted", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("git hooks"));
  });

  it("should handle SopsMissingError and call formatDependencyError", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "sops" && args[0] === "--version") {
          return { stdout: "", stderr: "not found", exitCode: 127 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.formatDependencyError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should accept --random-values flag and skip when no schemas", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "sops" && args[0] === "--version")
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        return { stdout: "encrypted", stderr: "", exitCode: 0 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "init",
      "--namespaces",
      "database",
      "--random-values",
      "--non-interactive",
    ]);

    // No schemas on init-created namespaces, so markPending should NOT be called
    expect(markPending).not.toHaveBeenCalled();
    // Warning should be shown for schema-less namespace
    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("no schema defined"));
  });

  it("should run interactive prompts when stdin is TTY and --non-interactive is not set", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1) {
          // environments prompt
          cb("dev,prod");
        } else if (questionCallCount === 2) {
          // namespaces prompt
          cb("api,web");
        } else if (questionCallCount === 3) {
          // secrets dir prompt (accept default)
          cb("");
        } else {
          // key path prompt (accept default)
          cb("");
        }
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init"]);

    // The manifest should contain the interactively provided namespaces
    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("api"),
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should use default values when user presses enter in interactive mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1) {
          // environments prompt - empty answer uses default
          cb("");
        } else if (questionCallCount === 2) {
          // namespaces prompt
          cb("myns");
        } else if (questionCallCount === 3) {
          // secrets dir prompt - accept default
          cb("");
        } else {
          // key path prompt
          cb("");
        }
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init"]);

    // Default environments (dev,staging,production) should be used
    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("staging"),
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should run interactive prompts with namespaces already provided", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1) {
          // Only environments prompt; namespaces already provided via flag
          cb("dev,staging");
        } else if (questionCallCount === 2) {
          // secrets dir prompt - accept default
          cb("");
        } else {
          // key path prompt
          cb("");
        }
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    mockFs.existsSync.mockReturnValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db"]);

    // manifest should be written
    expect(mockWriteFileAtomicSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.any(String),
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should error when age key path is inside a git repo", async () => {
    setupInsideGitRepo();

    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("git repository"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("second-dev onboarding: should write .clef/.gitignore if it does not exist", async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue("");
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    const gitignoreCall = mockFs.writeFileSync.mock.calls.find(
      (c) => String(c[0]).includes(".clef") && String(c[0]).includes(".gitignore"),
    );
    expect(gitignoreCall).toBeDefined();
    expect(String(gitignoreCall![1])).toBe("*\n");
  });

  it("should store key in keychain and skip filesystem when keychain succeeds", async () => {
    mockSetKeychainKey.mockResolvedValue(true);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockSetKeychainKey).toHaveBeenCalledWith(
      runner,
      "AGE-SECRET-KEY-1MOCKPRIVATEKEY1234",
      "test-label",
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("OS keychain"));
    // No key file should be written to disk
    const keyFileCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("keys.txt"),
    );
    expect(keyFileCall).toBeUndefined();
  });

  it("should not set CLEF_AGE_KEY in process.env when keychain succeeds (no env leakage)", async () => {
    mockSetKeychainKey.mockResolvedValue(true);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    // The key should NOT be leaked into process.env — it is passed directly
    // to SopsClient via the ageKey constructor parameter
    expect(process.env.CLEF_AGE_KEY).toBeUndefined();
  });

  it("should write age_key_storage: keychain and label in config.yaml when keychain succeeds", async () => {
    mockSetKeychainKey.mockResolvedValue(true);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const configContent = String(configCall![1]);
    expect(configContent).not.toContain("age_key_file");
    expect(configContent).toContain("age_key_storage: keychain");
    expect(configContent).toContain("age_keychain_label: test-label");
  });

  it("should write age_key_storage: file and label in config.yaml when keychain fails", async () => {
    mockSetKeychainKey.mockResolvedValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const configContent = String(configCall![1]);
    expect(configContent).toContain("age_key_file");
    expect(configContent).toContain("age_key_storage: file");
    expect(configContent).toContain("age_keychain_label: test-label");
  });

  it("should use labeled filesystem path when keychain fails", async () => {
    mockSetKeychainKey.mockResolvedValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const configContent = String(configCall![1]);
    expect(configContent).toContain("keys/test-label/keys.txt");
  });

  it("should warn with docs link when keychain fails", async () => {
    mockSetKeychainKey.mockResolvedValue(false);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("https://docs.clef.sh/guide/key-storage"),
    );
  });

  it("should prompt for confirmation before filesystem write in interactive mode", async () => {
    mockSetKeychainKey.mockResolvedValue(false);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1)
          cb("dev"); // environments
        else if (questionCallCount === 2)
          cb("db"); // namespaces
        else if (questionCallCount === 3)
          cb(""); // secrets dir
        else cb(""); // key path
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("filesystem"));

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should abort when user declines filesystem storage", async () => {
    mockSetKeychainKey.mockResolvedValue(false);
    mockFormatter.confirm.mockResolvedValueOnce(false);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    let questionCallCount = 0;
    const mockRl = {
      question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallCount++;
        if (questionCallCount === 1)
          cb("dev"); // environments
        else if (questionCallCount === 2)
          cb("db"); // namespaces
        else if (questionCallCount === 3)
          cb(""); // secrets dir
        else cb(""); // key path
      }),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Aborted"));
    expect(mockExit).toHaveBeenCalledWith(1);

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("should print key label during full setup", async () => {
    mockSetKeychainKey.mockResolvedValue(true);
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    expect(mockFormatter.success).toHaveBeenCalledWith("Key label: test-label");
  });

  it("second-dev onboarding: should generate fresh key and label", async () => {
    mockSetKeychainKey.mockResolvedValue(true);
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue("");
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    // Should always generate a new key
    expect(getMockGenerateAgeIdentity()).toHaveBeenCalled();
    // Should store with label
    expect(mockSetKeychainKey).toHaveBeenCalledWith(
      runner,
      "AGE-SECRET-KEY-1MOCKPRIVATEKEY1234",
      "test-label",
    );
    // Config should include label
    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    const configContent = String(configCall![1]);
    expect(configContent).toContain("age_keychain_label: test-label");
    // Should print the label
    expect(mockFormatter.success).toHaveBeenCalledWith("Key label: test-label");
  });

  it("second-dev onboarding: should use CLEF_AGE_KEY_FILE env if set (filesystem fallback)", async () => {
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    process.env.CLEF_AGE_KEY_FILE = "/custom/keys.txt";

    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue("");
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    expect(String(configCall![1])).toContain("/custom/keys.txt");

    if (origKeyFile === undefined) {
      delete process.env.CLEF_AGE_KEY_FILE;
    } else {
      process.env.CLEF_AGE_KEY_FILE = origKeyFile;
    }
  });
});
