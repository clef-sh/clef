import { Command } from "commander";
import { registerAgentCommand } from "./agent";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

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

const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const _mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

function makeRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerAgentCommand(program, { runner });
  return program;
}

// Mock process.on to auto-resolve the SIGINT wait so tests don't hang
function mockProcessSignals(): void {
  jest.spyOn(process, "on").mockImplementation(function (
    this: NodeJS.Process,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching overloaded process.on signature
    event: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching overloaded process.on signature
    listener: any,
  ) {
    if (event === "SIGINT") {
      setTimeout(() => listener(), 10);
    }
    return this;
  } as NodeJS.Process["on"]);
}

describe("clef agent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLEF_AGENT_SOURCE = "https://bucket.example.com/artifact.json";
    process.env.CLEF_AGENT_AGE_KEY = "AGE-SECRET-KEY-1TESTKEY";
    mockProcessSignals();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("should start the agent and print configuration", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "agent", "start"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("Starting Clef Agent"),
    );
  });

  it("should accept --source flag", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "agent",
      "start",
      "--source",
      "./local-artifact.json",
    ]);

    expect(process.env.CLEF_AGENT_SOURCE).toBe("./local-artifact.json");
  });

  it("should accept --port flag", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "agent", "start", "--port", "8080"]);

    expect(process.env.CLEF_AGENT_PORT).toBe("8080");
  });

  it("should accept --poll-interval flag", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "agent", "start", "--poll-interval", "60"]);

    expect(process.env.CLEF_AGENT_POLL_INTERVAL).toBe("60");
  });
});
