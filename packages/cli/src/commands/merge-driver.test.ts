import * as fs from "fs";
import { Command } from "commander";
import { registerMergeDriverCommand } from "./merge-driver";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
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

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--repo <path>", "Repository root");
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
        if (cmd === "cat") {
          return { stdout: SOPS_METADATA_YAML, stderr: "", exitCode: 0 };
        }
        if (cmd === "sops" && args[0] === "encrypt") {
          if (options?.onEncrypt && opts?.stdin) {
            options.onEncrypt(opts.stdin);
          }
          return { stdout: "encrypted-output", stderr: "", exitCode: 0 };
        }
        if (cmd === "tee") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
  };
}

describe("clef merge-driver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should merge cleanly when changes do not overlap", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = p.toString();
      if (s.includes("clef.yaml")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(
      'version: 1\nenvironments:\n  - name: production\n    description: Prod\nnamespaces:\n  - name: db\n    description: DB\nsops:\n  default_backend: age\nfile_pattern: "{namespace}/{environment}.enc.yaml"\n',
    );

    const decryptCalls: string[] = [];
    const files: Record<string, Record<string, string>> = {
      "/tmp/base": { A: "1", B: "2" },
      "/tmp/ours": { A: "changed", B: "2" },
      "/tmp/theirs": { A: "1", B: "2", C: "new" },
    };
    const runner = makeMockRunner((filePath) => {
      decryptCalls.push(filePath);
      return files[filePath] ?? {};
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

    expect(decryptCalls).toHaveLength(3);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should exit 1 on merge conflict", async () => {
    mockFs.existsSync.mockReturnValue(false);

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

  it("should exit 1 when manifest is missing and merge is clean", async () => {
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

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("clef.yaml"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit 1 on decryption failure", async () => {
    mockFs.existsSync.mockReturnValue(false);

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
        if (cmd === "cat") {
          return { stdout: SOPS_METADATA_YAML, stderr: "", exitCode: 0 };
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
      expect.stringContaining("Merge driver failed"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should report conflict details to the user", async () => {
    mockFs.existsSync.mockReturnValue(false);

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
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("X:"));
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("Resolve conflicts"));
  });
});
