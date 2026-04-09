import { SubprocessRunner } from "@clef-sh/core";
import { getKeychainKey, setKeychainKey } from "./keychain";
import { formatter } from "./output/formatter";

jest.mock("./output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    failure: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockWarn = formatter.warn as jest.Mock;

const FAKE_KEY = "AGE-SECRET-KEY-1QFNJ04MG0GY93XAGNHXQ4RCSSMNDCZPLGUXK9TLMD0Z4MRAWEQSZ9J7NF";
const TEST_LABEL = "coral-tiger";

function mockRunner(impl?: SubprocessRunner["run"]): SubprocessRunner {
  return { run: jest.fn(impl) };
}

beforeEach(() => mockWarn.mockClear());

function setPlatform(value: string): string {
  const orig = process.platform;
  Object.defineProperty(process, "platform", { value, configurable: true });
  return orig;
}

// ── darwin ──────────────────────────────────────────────────────────────────

describe("keychain – darwin", () => {
  let origPlatform: string;
  beforeAll(() => {
    origPlatform = setPlatform("darwin");
  });
  afterAll(() => {
    setPlatform(origPlatform);
  });

  describe("getKeychainKey", () => {
    it("returns the key on success", async () => {
      const runner = mockRunner(async () => ({
        stdout: `${FAKE_KEY}\n`,
        stderr: "",
        exitCode: 0,
      }));
      expect(await getKeychainKey(runner, TEST_LABEL)).toBe(FAKE_KEY);
      expect(runner.run).toHaveBeenCalledWith("security", [
        "find-generic-password",
        "-a",
        `age-private-key:${TEST_LABEL}`,
        "-s",
        "clef",
        "-w",
      ]);
    });

    it("returns null on non-zero exit", async () => {
      const runner = mockRunner(async () => ({ stdout: "", stderr: "not found", exitCode: 44 }));
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    });

    it("returns null and warns when output is not a valid age key", async () => {
      const runner = mockRunner(async () => ({
        stdout: "not-an-age-key",
        stderr: "",
        exitCode: 0,
      }));
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("invalid key data"));
    });

    it("returns null when the command throws", async () => {
      const runner = mockRunner(async () => {
        throw new Error("security not found");
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    });
  });

  describe("setKeychainKey", () => {
    it("deletes, adds with -w argument, and verifies by reading back", async () => {
      const calls: { args: string[]; opts?: Record<string, unknown> }[] = [];
      const runner = mockRunner(async (_cmd, args, opts) => {
        calls.push({ args, opts: opts as Record<string, unknown> | undefined });
        if (args[0] === "find-generic-password") {
          return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(true);
      expect(calls).toHaveLength(3); // delete, add, verify
      expect(calls[0].args[0]).toBe("delete-generic-password");
      expect(calls[0].args).toContain(`age-private-key:${TEST_LABEL}`);
      expect(calls[1].args[0]).toBe("add-generic-password");
      // Key passed as -w argument
      expect(calls[1].args).toContain("-w");
      expect(calls[1].args).toContain(FAKE_KEY);
      expect(calls[2].args[0]).toBe("find-generic-password"); // verification
    });

    it("succeeds even if delete fails (no existing entry)", async () => {
      const runner = mockRunner(async (_cmd, args) => {
        if (args[0] === "delete-generic-password") throw new Error("not found");
        if (args[0] === "find-generic-password") {
          return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(true);
    });

    it("returns false when add fails", async () => {
      const runner = mockRunner(async (_cmd, args) => {
        if (args[0] === "delete-generic-password") return { stdout: "", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "error", exitCode: 1 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    });

    it("returns false and cleans up when verification detects truncation", async () => {
      const calls: string[][] = [];
      const runner = mockRunner(async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "add-generic-password") return { stdout: "", stderr: "", exitCode: 0 };
        // Verification returns truncated key (does not start with AGE-SECRET-KEY-)
        if (args[0] === "find-generic-password") {
          return { stdout: "AGE-SECRET-\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
      // Should have 4 calls: delete, add, verify, cleanup delete
      expect(calls).toHaveLength(4);
      expect(calls[3][0]).toBe("delete-generic-password");
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("read-back verification"));
    });
  });
});

// ── linux ───────────────────────────────────────────────────────────────────

describe("keychain – linux", () => {
  let origPlatform: string;
  beforeAll(() => {
    origPlatform = setPlatform("linux");
  });
  afterAll(() => {
    setPlatform(origPlatform);
  });

  describe("getKeychainKey", () => {
    it("returns the key on success", async () => {
      const runner = mockRunner(async () => ({
        stdout: `${FAKE_KEY}\n`,
        stderr: "",
        exitCode: 0,
      }));
      expect(await getKeychainKey(runner, TEST_LABEL)).toBe(FAKE_KEY);
      expect(runner.run).toHaveBeenCalledWith("secret-tool", [
        "lookup",
        "service",
        "clef",
        "account",
        `age-private-key:${TEST_LABEL}`,
      ]);
    });

    it("returns null when secret-tool is not installed", async () => {
      const runner = mockRunner(async () => {
        throw new Error("ENOENT");
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    });

    it("returns null and warns when output is not a valid age key", async () => {
      const runner = mockRunner(async () => ({
        stdout: "garbage",
        stderr: "",
        exitCode: 0,
      }));
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("invalid key data"));
    });
  });

  describe("setKeychainKey", () => {
    it("passes key via stdin and returns true on success", async () => {
      const runner = mockRunner(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(true);
      expect(runner.run).toHaveBeenCalledWith(
        "secret-tool",
        [
          "store",
          "--label",
          "Clef age private key",
          "service",
          "clef",
          "account",
          `age-private-key:${TEST_LABEL}`,
        ],
        { stdin: FAKE_KEY },
      );
    });

    it("returns false when secret-tool is not installed", async () => {
      const runner = mockRunner(async () => {
        throw new Error("ENOENT");
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    });
  });
});

// ── win32 ───────────────────────────────────────────────────────────────────

describe("keychain – win32", () => {
  let origPlatform: string;
  beforeAll(() => {
    origPlatform = setPlatform("win32");
  });
  afterAll(() => {
    setPlatform(origPlatform);
  });

  describe("getKeychainKey", () => {
    it("returns null when no PowerShell is available", async () => {
      const runner = mockRunner(async () => {
        throw new Error("ENOENT");
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    });

    it("prefers pwsh over powershell.exe", async () => {
      const calls: string[] = [];
      const runner = mockRunner(async (cmd, args) => {
        calls.push(cmd);
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        if (cmd === "pwsh") {
          return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBe(FAKE_KEY);
      expect(calls.filter((c) => c === "pwsh")).toHaveLength(2); // probe + read
      expect(calls).not.toContain("powershell.exe");
    });

    it("falls back to powershell.exe when pwsh is unavailable", async () => {
      const calls: string[] = [];
      const runner = mockRunner(async (cmd, args) => {
        calls.push(cmd);
        if (cmd === "pwsh") throw new Error("ENOENT");
        if (cmd === "powershell.exe" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        if (cmd === "powershell.exe") {
          return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBe(FAKE_KEY);
      expect(calls).toContain("powershell.exe");
    });

    it("returns the key on success", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
      });
      const key = await getKeychainKey(runner, TEST_LABEL);
      expect(key).toBe(FAKE_KEY);
    });

    it("passes correct Add-Type command with labeled credential target", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: `${FAKE_KEY}\n`, stderr: "", exitCode: 0 };
      });
      await getKeychainKey(runner, TEST_LABEL);
      const readCall = (runner.run as jest.Mock).mock.calls.find(
        ([cmd, args]: [string, string[]]) => cmd === "pwsh" && !args.includes("1"),
      );
      expect(readCall).toBeDefined();
      const [, args] = readCall;
      expect(args).toContain("-NonInteractive");
      expect(args).toContain("-NoProfile");
      expect(args).toContain("-Command");
      const command = args[args.indexOf("-Command") + 1];
      expect(command).toContain("Add-Type");
      expect(command).toContain("CredHelper");
      expect(command).toContain(`clef:age-private-key:${TEST_LABEL}`);
    });

    it("returns null on non-zero exit", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "error", exitCode: 1 };
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    });

    it("returns null and warns when output is not a valid age key", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "not-a-key", stderr: "", exitCode: 0 };
      });
      expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("Windows Credential Manager"));
    });
  });

  describe("setKeychainKey", () => {
    it("returns false when no PowerShell is available", async () => {
      const runner = mockRunner(async () => {
        throw new Error("ENOENT");
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    });

    it("returns true on success", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(true);
    });

    it("passes key via stdin, not in command args", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      await setKeychainKey(runner, FAKE_KEY, TEST_LABEL);
      const writeCall = (runner.run as jest.Mock).mock.calls.find(
        ([cmd, args]: [string, string[]]) => cmd === "pwsh" && !args.includes("1"),
      );
      expect(writeCall).toBeDefined();
      const [, args, opts] = writeCall;
      // Key must NOT appear in command-line args (security)
      const command = args[args.indexOf("-Command") + 1];
      expect(command).not.toContain(FAKE_KEY);
      // Key must be passed via stdin
      expect(opts).toEqual({ stdin: FAKE_KEY });
    });

    it("includes labeled target in PowerShell command", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      await setKeychainKey(runner, FAKE_KEY, TEST_LABEL);
      const writeCall = (runner.run as jest.Mock).mock.calls.find(
        ([cmd, args]: [string, string[]]) => cmd === "pwsh" && !args.includes("1"),
      );
      const [, args] = writeCall;
      const command = args[args.indexOf("-Command") + 1];
      expect(command).toContain(`clef:age-private-key:${TEST_LABEL}`);
    });

    it("returns false when PowerShell exits non-zero", async () => {
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "error", exitCode: 1 };
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    });

    it("returns false when PowerShell throws", async () => {
      let probed = false;
      const runner = mockRunner(async (cmd, args) => {
        if (cmd === "pwsh" && args.includes("1")) {
          probed = true;
          return { stdout: "1", stderr: "", exitCode: 0 };
        }
        if (probed) throw new Error("unexpected error");
        throw new Error("ENOENT");
      });
      expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    });
  });
});

// ── unsupported platform ────────────────────────────────────────────────────

describe("keychain – unsupported platform", () => {
  let origPlatform: string;
  beforeAll(() => {
    origPlatform = setPlatform("freebsd");
  });
  afterAll(() => {
    setPlatform(origPlatform);
  });

  it("getKeychainKey returns null", async () => {
    const runner = mockRunner();
    expect(await getKeychainKey(runner, TEST_LABEL)).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("setKeychainKey returns false", async () => {
    const runner = mockRunner();
    expect(await setKeychainKey(runner, FAKE_KEY, TEST_LABEL)).toBe(false);
    expect(runner.run).not.toHaveBeenCalled();
  });
});
