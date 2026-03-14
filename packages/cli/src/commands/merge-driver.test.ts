import * as fs from "fs";
import { Command } from "commander";
import { registerMergeDriverCommand } from "./merge-driver";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const SOPS_METADATA_YAML =
  "A: ENC[test]\nsops:\n  age:\n    - recipient: age1test\n  lastmodified: '2026-01-01'\n  mac: ENC[test]\n  version: 3.9.0\n";

const MANIFEST_YAML =
  'version: 1\nenvironments:\n  - name: production\n    description: Prod\nnamespaces:\n  - name: db\n    description: DB\nsops:\n  default_backend: age\nfile_pattern: "{namespace}/{environment}.enc.yaml"\n';

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerMergeDriverCommand(program, { runner });
  return program;
}

/** Build a mock runner that handles sops --version and other boilerplate commands. */
function makeMockRunner(
  onDecrypt: (filePath: string) => Record<string, string>,
  options?: {
    onEncrypt?: (stdin: string) => void;
  },
): SubprocessRunner {
  return {
    run: jest
      .fn()
      .mockImplementation(async (cmd: string, args: string[], opts?: { stdin?: string }) => {
        // sops --version check (assertSops)
        if (cmd === "sops" && args.includes("--version")) {
          return { stdout: "sops 3.9.0", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          const filePath = args[args.length - 1];
          const values = onDecrypt(filePath);
          const yaml = Object.entries(values)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
          return { stdout: yaml, stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "not supported", exitCode: 1 };
        }
        if (cmd === "sops" && args[0] === "encrypt") {
          if (options?.onEncrypt && opts?.stdin) {
            options.onEncrypt(opts.stdin);
          }
          return { stdout: "encrypted-output", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
  };
}

describe("clef merge-driver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default fs mocks — SopsClient uses fs.readFileSync for metadata and fs.writeFileSync for encrypt
    mockFs.readFileSync.mockImplementation(((p: fs.PathOrFileDescriptor) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    }) as typeof fs.readFileSync);
    mockFs.writeFileSync.mockReturnValue(undefined);
  });

  it("should merge cleanly when changes do not overlap", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    const decryptCalls: string[] = [];
    let encryptStdin: string | undefined;
    const files: Record<string, Record<string, string>> = {
      "/tmp/base": { A: "1", B: "2" },
      "/tmp/ours": { A: "changed", B: "2" },
      "/tmp/theirs": { A: "1", B: "2", C: "new" },
    };
    const runner = makeMockRunner(
      (filePath) => {
        decryptCalls.push(filePath);
        return files[filePath] ?? {};
      },
      {
        onEncrypt: (stdin: string) => {
          encryptStdin = stdin;
        },
      },
    );

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(decryptCalls).toHaveLength(3);
    expect(mockExit).toHaveBeenCalledWith(0);

    // Verify encrypt was called and the merged values are correct
    const runCalls = (runner.run as jest.Mock).mock.calls;
    const encryptCalls = runCalls.filter(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
    );
    expect(encryptCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the encrypted content contains the expected merged values
    expect(encryptStdin).toBeDefined();
    const YAML = await import("yaml");
    const parsed = YAML.parse(encryptStdin!);
    expect(parsed).toEqual({ A: "changed", B: "2", C: "new" });
  });

  it("should exit 1 on merge conflict", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    const runner = makeMockRunner((filePath) => {
      if (filePath === "/tmp/base") return { A: "original" };
      if (filePath === "/tmp/ours") return { A: "alice" };
      return { A: "bob" };
    });

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Merge conflict"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 when clef.yaml is not found in any parent directory", async () => {
    mockFs.existsSync.mockReturnValue(false);

    const runner = makeMockRunner(() => ({ A: "same" }));

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Merge driver failed. Run 'clef doctor' to verify setup."),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 on decryption failure", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === "sops" && args.includes("--version")) {
          return { stdout: "sops 3.9.0", stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "decrypt") {
          return { stdout: "", stderr: "could not find key", exitCode: 1 };
        }
        if (cmd === "sops" && args[0] === "filestatus") {
          return { stdout: "", stderr: "", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Merge driver failed. Run 'clef doctor' to verify setup."),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should merge cleanly when one side deletes a key", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    let encryptStdin: string | undefined;
    const runner = makeMockRunner(
      (filePath): Record<string, string> => {
        if (filePath === "/tmp/base") return { A: "1", B: "2", C: "3" };
        if (filePath === "/tmp/ours") return { A: "1", B: "2" }; // C deleted
        return { A: "1", B: "2", C: "3" }; // theirs unchanged
      },
      {
        onEncrypt: (stdin: string) => {
          encryptStdin = stdin;
        },
      },
    );

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(encryptStdin).toBeDefined();
    const YAML = await import("yaml");
    const parsed = YAML.parse(encryptStdin!);
    expect(parsed).toEqual({ A: "1", B: "2" }); // C should be deleted
  });

  it("should merge cleanly when both sides add different keys", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    let encryptStdin: string | undefined;
    const runner = makeMockRunner(
      (filePath): Record<string, string> => {
        if (filePath === "/tmp/base") return { A: "1" };
        if (filePath === "/tmp/ours") return { A: "1", B: "from-ours" };
        return { A: "1", C: "from-theirs" };
      },
      {
        onEncrypt: (stdin: string) => {
          encryptStdin = stdin;
        },
      },
    );

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(encryptStdin).toBeDefined();
    const YAML = await import("yaml");
    const parsed = YAML.parse(encryptStdin!);
    expect(parsed).toEqual({ A: "1", B: "from-ours", C: "from-theirs" });
  });

  it("should report conflict details to the user", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return MANIFEST_YAML;
      return SOPS_METADATA_YAML;
    });

    const runner = makeMockRunner((filePath) => {
      if (filePath === "/tmp/base") return { X: "1", Y: "2" };
      if (filePath === "/tmp/ours") return { X: "alice-X", Y: "2" };
      return { X: "bob-X", Y: "changed-Y" };
    });

    const program = makeProgram(runner);
    await program.parseAsync([
      "node",
      "clef",
      "merge-driver",
      "/tmp/base",
      "/tmp/ours",
      "/tmp/theirs",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("1 key(s) conflict"));
    // Conflict details must go to stderr via formatter.failure, not stdout via formatter.print
    expect(mockFormatter.failure).toHaveBeenCalledWith(expect.stringContaining("X:"));
    expect(mockFormatter.failure).toHaveBeenCalledWith(expect.stringContaining("base:"));
    expect(mockFormatter.failure).toHaveBeenCalledWith(expect.stringContaining("ours:"));
    expect(mockFormatter.failure).toHaveBeenCalledWith(expect.stringContaining("theirs:"));
    // Values must NOT appear in the output — only "(has value)" / "(deleted)" / "(absent)"
    const allFailureCalls = mockFormatter.failure.mock.calls.map((c) => c[0]);
    for (const msg of allFailureCalls) {
      expect(msg).not.toContain("alice-X");
      expect(msg).not.toContain("bob-X");
      expect(msg).not.toContain("original");
    }
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("Resolve conflicts"));
  });
});
