import * as fs from "fs";
import { Command } from "commander";
import { registerDoctorCommand } from "./doctor";
import * as initModule from "./init";
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
    run: jest.fn().mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "sops":
          return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        case "git":
          return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        default:
          return { stdout: "", stderr: "", exitCode: 127 };
      }
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.version("0.1.0");
  program.option("--repo <path>", "Path to the Clef repository root");
  program.exitOverride();
  registerDoctorCommand(program, { runner });
  return program;
}

describe("clef doctor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: manifest and .sops.yaml exist, age key exists
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("version: 1\nsops:\n  default_backend: age\n");
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
    // No SOPS_AGE_KEY env var
    const origKey = process.env.SOPS_AGE_KEY;
    const origKeyFile = process.env.SOPS_AGE_KEY_FILE;
    delete process.env.SOPS_AGE_KEY;
    delete process.env.SOPS_AGE_KEY_FILE;

    // No key files exist
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr.includes("keys.txt")) return false;
      if (pathStr.includes("sops/age")) return false;
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
    if (origKey !== undefined) process.env.SOPS_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.SOPS_AGE_KEY_FILE = origKeyFile;
  });

  it("should output valid JSON with --json flag and count age recipients", async () => {
    const sopsYamlContent =
      "creation_rules:\n" +
      "  - path_regex: 'app/dev\\.enc\\.yaml$'\n" +
      "    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p\n" +
      "  - path_regex: 'app/staging\\.enc\\.yaml$'\n" +
      "    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p\n" +
      "  - path_regex: 'app/production\\.enc\\.yaml$'\n" +
      "    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p,age1second00000000000000000000000000000000000000000000000000000\n";

    const manifestContent = "version: 1\nsops:\n  default_backend: age\n";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded readFileSync needs loose typing for the mock
    (mockFs.readFileSync as jest.Mock).mockImplementation((...args: any[]) => {
      const p = String(args[0]);
      if (p.includes(".sops.yaml")) return sopsYamlContent;
      return manifestContent;
    });

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
    expect(parsed.sopsYaml.found).toBe(true);
    expect(parsed.ageKey.recipients).toBe(2);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should call scaffoldSopsConfig directly when --fix is used and only .sops.yaml is missing", async () => {
    // .sops.yaml doesn't exist initially, but all other checks pass
    let sopsYamlExists = false;
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(".sops.yaml")) return sopsYamlExists;
      return true;
    });

    // Mock scaffoldSopsConfig to simulate writing .sops.yaml
    const scaffoldSpy = jest.spyOn(initModule, "scaffoldSopsConfig").mockImplementation(() => {
      sopsYamlExists = true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--fix"]);

    expect(scaffoldSpy).toHaveBeenCalledWith(expect.any(String));
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("Attempting to fix"));
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining(".sops.yaml created"),
    );

    scaffoldSpy.mockRestore();
  });

  it("should include fix hint in JSON when .sops.yaml is missing", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(".sops.yaml")) return false;
      return true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.sopsYaml.found).toBe(false);
    expect(parsed.sopsYaml.ok).toBe(false);
    expect(parsed.sopsYaml.fix).toBe("clef init");
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

  it("should warn when --fix is used but multiple failures exist", async () => {
    // Both manifest and .sops.yaml missing
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.includes("clef.yaml")) return false;
      if (s.includes(".sops.yaml")) return false;
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

  it("should handle --fix when scaffoldSopsConfig throws", async () => {
    const sopsYamlExists = false;
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(".sops.yaml")) return sopsYamlExists;
      return true;
    });

    const scaffoldSpy = jest.spyOn(initModule, "scaffoldSopsConfig").mockImplementation(() => {
      throw new Error("manifest parse failed");
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--fix"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate .sops.yaml"),
    );

    scaffoldSpy.mockRestore();
  });

  it("should detect age key from SOPS_AGE_KEY env var", async () => {
    const origKey = process.env.SOPS_AGE_KEY;
    process.env.SOPS_AGE_KEY = "AGE-SECRET-KEY-1234";

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("age key") && l.includes("SOPS_AGE_KEY"));
    expect(keyLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(0);

    if (origKey === undefined) {
      delete process.env.SOPS_AGE_KEY;
    } else {
      process.env.SOPS_AGE_KEY = origKey;
    }
  });

  it("should detect age key from .clef/config.yaml", async () => {
    const origKey = process.env.SOPS_AGE_KEY;
    const origKeyFile = process.env.SOPS_AGE_KEY_FILE;
    delete process.env.SOPS_AGE_KEY;
    delete process.env.SOPS_AGE_KEY_FILE;

    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      // Default age key path does not exist
      if (s.includes(".config/sops/age/keys.txt")) return false;
      // .clef/config.yaml exists
      if (s.includes(".clef/config.yaml")) return true;
      // The key file referenced in config exists
      if (s === "/custom/clef/keys.txt") return true;
      return true;
    });
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".clef/config.yaml")) return "age_key_file: /custom/clef/keys.txt\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const printCalls = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const keyLine = printCalls.find((l) => l.includes("age key") && l.includes("loaded"));
    expect(keyLine).toBeTruthy();
    expect(mockExit).toHaveBeenCalledWith(0);

    if (origKey !== undefined) process.env.SOPS_AGE_KEY = origKey;
    if (origKeyFile !== undefined) process.env.SOPS_AGE_KEY_FILE = origKeyFile;
  });

  it("should count zero recipients when .sops.yaml has no creation_rules", async () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".sops.yaml")) return "some_other_key: true\n";
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.recipients).toBe(0);
  });

  it("should count zero recipients when .sops.yaml does not exist", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(".sops.yaml")) return false;
      return true;
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.recipients).toBe(0);
  });

  it("should handle countAgeRecipients when readFileSync throws", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      const pathStr = String(p);
      if (pathStr.includes(".sops.yaml")) throw new Error("read error");
      return "version: 1\nsops:\n  default_backend: age\n";
    });

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.recipients).toBe(0);
  });

  it("should return platform-specific install hints", async () => {
    // This test covers getSopsInstallHint
    // On darwin, it returns brew hints. On other platforms, URL hints.
    // We test by having sops missing, which triggers the hint display.
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "git") return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor"]);

    const hintCalls = mockFormatter.hint.mock.calls.map((c) => String(c[0]));
    // Should have hint line for sops
    const hintLines = hintCalls.filter((l) => l.includes("brew install") || l.includes("https://"));
    expect(hintLines.length).toBeGreaterThanOrEqual(1);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should report age key source as 'env' in JSON when SOPS_AGE_KEY is set", async () => {
    const origKey = process.env.SOPS_AGE_KEY;
    process.env.SOPS_AGE_KEY = "AGE-SECRET-KEY-1234";

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.source).toBe("env");
    expect(parsed.ageKey.ok).toBe(true);

    if (origKey === undefined) {
      delete process.env.SOPS_AGE_KEY;
    } else {
      process.env.SOPS_AGE_KEY = origKey;
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
    const urlHints = hintCalls.filter((l) => l.includes("https://github.com/getsops/sops"));
    expect(urlHints.length).toBeGreaterThanOrEqual(1);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("should report age key source as 'file' in JSON when loaded from file", async () => {
    const origKey = process.env.SOPS_AGE_KEY;
    delete process.env.SOPS_AGE_KEY;

    const runner = allGoodRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "doctor", "--json"]);

    const output = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.ageKey.source).toBe("file");
    expect(parsed.ageKey.ok).toBe(true);

    if (origKey !== undefined) process.env.SOPS_AGE_KEY = origKey;
  });
});
