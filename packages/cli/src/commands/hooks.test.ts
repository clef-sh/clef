import * as fs from "fs";
import { Command } from "commander";
import { registerHooksCommand } from "./hooks";
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

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerHooksCommand(program, { runner });
  return program;
}

describe("clef hooks install", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should install pre-commit hook", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Pre-commit hook installed"),
    );
  });

  it("should ask before overwriting existing clef hook", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("#!/bin/sh\n# clef pre-commit hook");
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(mockFormatter.success).toHaveBeenCalled();
  });

  it("should ask before overwriting non-clef hook", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("#!/bin/sh\necho custom hook");
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("not Clef"));
  });

  it("should abort when confirmation denied for clef hook", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("#!/bin/sh\n# clef hook");
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should abort with info message when non-clef hook overwrite is declined", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("#!/bin/sh\necho custom hook");
    (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(
      expect.stringContaining("manually add Clef checks"),
    );
    expect(mockFormatter.success).not.toHaveBeenCalled();
  });

  it("should exit 1 on install failure", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "no .git dir", exitCode: 1 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "hooks", "install"]);

    expect(mockFormatter.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
