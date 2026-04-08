import * as fs from "fs";
import { Command } from "commander";
import { registerDoctorCommand } from "./doctor";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    hint: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn().mockResolvedValue("secret"),
    formatDependencyError: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

function allGoodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "sops") return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      if (cmd === "git" && args[0] === "config" && args[1] === "--get") {
        return { stdout: "clef merge-driver %O %A %B", stderr: "", exitCode: 0 };
      }
      if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
      if (cmd === "cat") {
        return { stdout: "*.enc.yaml merge=sops\n*.enc.json merge=sops", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 127 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.version("0.1.0");
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerDoctorCommand(program, { runner });
  return program;
}

describe("clef doctor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: manifest exists, age key exists via config-file
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".clef/config.yaml"))
        return "age_key_file: /mock/keys.txt\nage_keychain_label: mock-label\n";
      if (pathStr.includes(".gitattributes"))
        return "*.enc.yaml merge=sops\n*.enc.json merge=sops\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });
  });

  it("should exit 0 and print success when all checks pass", async () => {
    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Everything looks good"),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should exit 1 when sops is missing", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const sopsLine = printCalls.find((l) => l.includes("sops") && l.includes("not installed"));
    expect(sopsLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 when sops is outdated", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "sops") return { stdout: "sops 3.7.2", stderr: "", exitCode: 0 };
        if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const sopsLine = printCalls.find((l) => l.includes("sops") && l.includes("3.7.2"));
    expect(sopsLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 when manifest is missing", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("clef.yaml")) return false;
      return true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const manifestLine = printCalls.find((l) => l.includes("manifest") && l.includes("not found"));
    expect(manifestLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 when age key is not configured", async () => {
    // No CLEF_AGE_KEY env var
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY_FILE;

    // No key files exist, no label in config
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr.includes("keys.txt")) return false;
      if (pathStr.includes(".clef/config.yaml")) return false;
      return true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("age key") && l.includes("not configured"));
    expect(keyLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);

    // Restore
    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
  });

  it("should output valid JSON with --json flag", async () => {
    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    expect(mockFormatter.raw).toHaveBeenCalledTimes(1);
    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.clef.version).toBe("0.1.0");
    expect(parsed.clef.ok).toBe(true);
    expect(parsed.sops.version).toBe("3.9.4");
    expect(parsed.sops.ok).toBe(true);
    expect(parsed.git.version).toBe("2.43.0");
    expect(parsed.git.ok).toBe(true);
    expect(parsed.manifest.found).toBe(true);
    expect(parsed.ageKey.ok).toBe(true);
    expect(parsed.sopsYaml).toBeUndefined();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should exit 1 when git is missing", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "sops") return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        // git not found
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const gitLine = printCalls.find((l) => l.includes("git") && l.includes("not installed"));
    expect(gitLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should warn when --fix is used but failures exist", async () => {
    // manifest missing
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("clef.yaml")) return false;
      return true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--fix"]);

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("--fix cannot resolve"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should detect age key from CLEF_AGE_KEY env var", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-1234";

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("age key") && l.includes("CLEF_AGE_KEY"));
    expect(keyLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(0);

    if (origKey === undefined) {
      delete process.env.CLEF_AGE_KEY;
    } else {
      process.env.CLEF_AGE_KEY = origKey;
    }
  });

  it("should detect age key from .clef/config.yaml", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY_FILE;

    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      // .clef/config.yaml exists
      if (s.includes(".clef/config.yaml")) return true;
      // The key file referenced in config exists
      if (s === "/custom/clef/keys.txt") return true;
      return true;
    });
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".clef/config.yaml"))
        return "age_key_file: /custom/clef/keys.txt\nage_keychain_label: coral-tiger\n";
      if (pathStr.includes(".gitattributes"))
        return "*.enc.yaml merge=sops\n*.enc.json merge=sops\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("age key") && l.includes("loaded"));
    expect(keyLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(0);

    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
  });

  it("should include label in diagnostic output for file source", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    const origKeyFile = process.env.CLEF_AGE_KEY_FILE;
    delete process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY_FILE;

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".clef/config.yaml"))
        return "age_key_file: /custom/keys.txt\nage_keychain_label: coral-tiger\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find(
      (l) => l.includes("age key") && l.includes("label: coral-tiger"),
    );
    expect(keyLine).toBeTruthy();

    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.CLEF_AGE_KEY_FILE = origKeyFile;
  });

  it("should return platform-specific install hints", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const hintCalls = mockFormatter.hint.mock.calls.map((c) => String(c[0]));
    const hintLines = hintCalls.filter((l) => l.includes("brew install") || l.includes("https://"));
    expect(hintLines.length).toBeGreaterThanOrEqual(1);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should report age key source as 'env' in JSON when CLEF_AGE_KEY is set", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    process.env.CLEF_AGE_KEY = "AGE-SECRET-KEY-1234";

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.source).toBe("env");
    expect(parsed.ageKey.ok).toBe(true);

    if (origKey === undefined) {
      delete process.env.CLEF_AGE_KEY;
    } else {
      process.env.CLEF_AGE_KEY = origKey;
    }
  });

  it("should show URL hints on non-darwin platforms when sops missing", async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const hintCalls = mockFormatter.hint.mock.calls.map((c) => String(c[0]));
    // Should show URL-based hints instead of brew
    expect(hintCalls.some((l) => l.includes("getsops/sops/releases"))).toBe(true);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("should report age key source as 'file' in JSON when loaded from file", async () => {
    const origKey = process.env.CLEF_AGE_KEY;
    delete process.env.CLEF_AGE_KEY;

    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".clef/config.yaml"))
        return "age_key_file: /some/keys.txt\nage_keychain_label: test-label\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.source).toBe("file");
    expect(parsed.ageKey.ok).toBe(true);

    if (origKey !== undefined) process.env.CLEF_AGE_KEY = origKey;
  });
});
