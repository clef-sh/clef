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

// Mock @clef-sh/agent so no real network calls or servers are started in tests
jest.mock("@clef-sh/agent", () => {
  const mockDaemon = {
    start: jest.fn().mockResolvedValue(undefined),
    waitForShutdown: jest.fn().mockResolvedValue(undefined),
  };
  const mockServer = {
    url: "http://127.0.0.1:19700",
    stop: jest.fn().mockResolvedValue(undefined),
    address: jest.fn().mockReturnValue({ address: "127.0.0.1", port: 19700, family: "IPv4" }),
  };
  return {
    resolveConfig: jest.fn().mockReturnValue({
      source: "https://example.com/artifact.json",
      port: 19700,
      token: "test-token-12345678",
      pollInterval: 30,
      ageKey: "AGE-SECRET-KEY-1TESTKEY",
      ageKeyFile: undefined,
    }),
    SecretsCache: jest.fn().mockImplementation(() => ({})),
    AgeDecryptor: jest.fn().mockImplementation(() => ({
      resolveKey: jest.fn().mockReturnValue("age-private-key"),
    })),
    ArtifactPoller: jest.fn().mockImplementation(() => ({
      fetchAndDecrypt: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
    })),
    startAgentServer: jest.fn().mockResolvedValue(mockServer),
    Daemon: jest.fn().mockImplementation(() => mockDaemon),
  };
});

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

describe("clef agent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLEF_AGENT_SOURCE = "https://bucket.example.com/artifact.json";
    process.env.CLEF_AGENT_AGE_KEY = "AGE-SECRET-KEY-1TESTKEY";
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

  it("should truncate token in output", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "agent", "start"]);

    // Token must not be fully exposed in printed output
    const allPrintCalls = mockFormatter.print.mock.calls.map((c) => c[0]);
    for (const msg of allPrintCalls) {
      expect(msg).not.toContain("test-token-12345678");
    }
  });
});
