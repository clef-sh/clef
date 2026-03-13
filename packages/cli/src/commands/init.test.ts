import * as fs from "fs";
import * as readline from "readline";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerInitCommand, scaffoldSopsConfig } from "./init";
import { SubprocessRunner, markPending } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("readline");

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
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

// Helpers to access mocked functions after hoisting
function getMockGenerateAgeIdentity(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@clef-sh/core").generateAgeIdentity as jest.Mock;
}

function getMockExecFile(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("child_process").execFile as jest.Mock;
}

// Helper: configure execFile so that isInsideAnyGitRepo returns false (not a git repo)
function setupNotGitRepo(): void {
  getMockExecFile().mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(new Error("not a repo"));
    },
  );
}

// Helper: configure execFile so that isInsideAnyGitRepo returns true (inside a git repo)
function setupInsideGitRepo(): void {
  getMockExecFile().mockImplementation(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, result?: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "/some/repo\n" });
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
  program.option("--repo <path>", "Repository root");
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
    // Default: key path is not inside a git repo
    setupNotGitRepo();
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

    // clef.yaml should be written
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("version: 1"),
      "utf-8",
    );

    // .sops.yaml should be written with the mock public key
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".sops.yaml"),
      expect.any(String),
      "utf-8",
    );

    // age key should have been generated
    expect(getMockGenerateAgeIdentity()).toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("clef.yaml"));
  });

  it("should write .sops.yaml with the generated age public key", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain(
      "age1mockpublickey00000000000000000000000000000000000000000000",
    );
  });

  it("should write .clef/config.yaml with the key path", async () => {
    const runner = mockRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "init", "--namespaces", "db", "--non-interactive"]);

    const configCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes("config.yaml"),
    );
    expect(configCall).toBeDefined();
    expect(String(configCall![1])).toContain("age_key_file");
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

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("pgp"),
      "utf-8",
    );
    // age identity should NOT be generated for pgp backend
    expect(getMockGenerateAgeIdentity()).not.toHaveBeenCalled();
  });

  it("should handle awskms backend in .sops.yaml", async () => {
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

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("awskms"),
      "utf-8",
    );
    expect(getMockGenerateAgeIdentity()).not.toHaveBeenCalled();
  });

  it("should handle gcpkms backend in .sops.yaml", async () => {
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

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("gcpkms"),
      "utf-8",
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
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("api"),
      "utf-8",
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
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.stringContaining("staging"),
      "utf-8",
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
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("clef.yaml"),
      expect.any(String),
      "utf-8",
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

  it("second-dev onboarding: should use SOPS_AGE_KEY_FILE env if set", async () => {
    const origKeyFile = process.env.SOPS_AGE_KEY_FILE;
    process.env.SOPS_AGE_KEY_FILE = "/custom/keys.txt";

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
      delete process.env.SOPS_AGE_KEY_FILE;
    } else {
      process.env.SOPS_AGE_KEY_FILE = origKeyFile;
    }
  });
});

describe("scaffoldSopsConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFileSync.mockReturnValue(undefined);
  });

  it("should generate .sops.yaml from an existing manifest", () => {
    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockReturnValue(manifest);
    mockFs.existsSync.mockReturnValue(false);

    scaffoldSopsConfig("/test/repo");

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".sops.yaml"),
      expect.any(String),
      "utf-8",
    );
  });

  it("should include aws_kms_arn in .sops.yaml for awskms backend", () => {
    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockReturnValue(manifest);
    mockFs.existsSync.mockReturnValue(false);

    scaffoldSopsConfig("/test/repo");

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain("arn:aws:kms");
  });

  it("should include gcp_kms_resource_id in .sops.yaml for gcpkms backend", () => {
    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: {
        default_backend: "gcpkms",
        gcp_kms_resource_id: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
      },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockReturnValue(manifest);
    mockFs.existsSync.mockReturnValue(false);

    scaffoldSopsConfig("/test/repo");

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain("projects/p/locations/l");
  });

  it("should include pgp_fingerprint in .sops.yaml for pgp backend", () => {
    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: { default_backend: "pgp", pgp_fingerprint: "ABCDEF1234567890" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockReturnValue(manifest);
    mockFs.existsSync.mockReturnValue(false);

    scaffoldSopsConfig("/test/repo");

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain("ABCDEF1234567890");
  });

  it("should resolve age public key from SOPS_AGE_KEY_FILE env for scaffoldSopsConfig", () => {
    const origKeyFile = process.env.SOPS_AGE_KEY_FILE;
    process.env.SOPS_AGE_KEY_FILE = "/custom/age/keys.txt";

    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("clef.yaml")) return manifest;
      if (String(p) === "/custom/age/keys.txt")
        return "# public key: age1envfilekey\nAGE-SECRET-KEY-1234\n";
      return "";
    }) as typeof fs.readFileSync);

    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("clef.yaml") || s === "/custom/age/keys.txt";
    });

    scaffoldSopsConfig("/test/repo");

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain("age1envfilekey");

    if (origKeyFile === undefined) {
      delete process.env.SOPS_AGE_KEY_FILE;
    } else {
      process.env.SOPS_AGE_KEY_FILE = origKeyFile;
    }
  });

  it("should resolve age public key from SOPS_AGE_KEY env for scaffoldSopsConfig", () => {
    const origKey = process.env.SOPS_AGE_KEY;
    const origKeyFile = process.env.SOPS_AGE_KEY_FILE;
    process.env.SOPS_AGE_KEY =
      "# created: 2024-01-01\n# public key: age1envvarkey\nAGE-SECRET-KEY-1234";
    delete process.env.SOPS_AGE_KEY_FILE;

    const manifest = YAML.stringify({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "db", description: "DB" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    mockFs.readFileSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("clef.yaml")) return manifest;
      return "";
    }) as typeof fs.readFileSync);

    mockFs.existsSync.mockImplementation((p) => String(p).endsWith("clef.yaml"));

    scaffoldSopsConfig("/test/repo");

    const sopsYamlCall = mockFs.writeFileSync.mock.calls.find((c) =>
      String(c[0]).includes(".sops.yaml"),
    );
    expect(sopsYamlCall).toBeDefined();
    expect(String(sopsYamlCall![1])).toContain("age1envvarkey");

    if (origKey === undefined) {
      delete process.env.SOPS_AGE_KEY;
    } else {
      process.env.SOPS_AGE_KEY = origKey;
    }
    if (origKeyFile !== undefined) {
      process.env.SOPS_AGE_KEY_FILE = origKeyFile;
    }
  });
});
