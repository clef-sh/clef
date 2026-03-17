import { Command } from "commander";
import { registerUiCommand, isHeadless } from "./ui";
import { SubprocessRunner } from "@clef-sh/core";
import { startServer } from "@clef-sh/ui/dist/server";
import { formatter } from "../output/formatter";

jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    confirm: jest.fn(),
    secretPrompt: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerUiCommand(program, { runner });
  return program;
}

describe("clef ui", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should print the server URL and respond to SIGINT", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    // Run the command but simulate SIGINT shortly after to avoid hanging
    const parsePromise = program.parseAsync(["node", "clef", "ui", "--no-open"]);
    // Give it a moment to start, then emit SIGINT
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 50);

    await parsePromise;

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:7777"),
    );
  });

  it("should print the full URL with token embedded as a query param", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui", "--no-open"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 50);

    await parsePromise;

    // Should show one line with both the server address and the token embedded
    const calls = (mockFormatter.print as jest.Mock).mock.calls.flat();
    const urlLine = calls.find(
      (s: string) =>
        typeof s === "string" && s.includes("http://127.0.0.1:7777") && s.includes("?token="),
    );
    expect(urlLine).toBeDefined();
    // The bare token and a separate "Token" label should NOT appear
    expect(calls.join(" ")).not.toMatch(/\bToken\s/);
  });

  it("should accept custom port", async () => {
    (startServer as jest.Mock).mockResolvedValue({
      url: "http://127.0.0.1:8888",
      token: "a".repeat(64),
      stop: jest.fn().mockResolvedValue(undefined),
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui", "--port", "8888", "--no-open"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 50);

    await parsePromise;

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:8888"),
    );
  });

  it("should error on invalid port", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "ui", "--port", "invalid", "--no-open"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should skip auto-open when --no-open is passed", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui", "--no-open"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 50);

    await parsePromise;

    // runner.run should not be called with 'open' (the browser open command)
    const runCalls = (runner.run as jest.Mock).mock.calls;
    const openCalls = runCalls.filter(
      ([cmd]: [string]) => cmd === "open" || cmd === "xdg-open" || cmd === "start",
    );
    expect(openCalls).toHaveLength(0);
  });

  it("should handle server start failure", async () => {
    (startServer as jest.Mock).mockRejectedValueOnce(new Error("EADDRINUSE"));

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "ui", "--no-open"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to start UI server"),
    );
    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("EADDRINUSE"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should warn when browser open fails", async () => {
    const origCI = process.env.CI;
    delete process.env.CI;
    const origSSH = process.env.SSH_TTY;
    delete process.env.SSH_TTY;
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    (startServer as jest.Mock).mockResolvedValue({
      url: "http://127.0.0.1:7777",
      token: "a".repeat(64),
      stop: jest.fn().mockResolvedValue(undefined),
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockRejectedValue(new Error("open failed")),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 100);

    await parsePromise;

    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not open browser"),
    );

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    if (origCI !== undefined) process.env.CI = origCI;
    if (origSSH !== undefined) process.env.SSH_TTY = origSSH;
  });

  it("should open browser with xdg-open on linux", async () => {
    const origCI = process.env.CI;
    delete process.env.CI;
    const origSSH = process.env.SSH_TTY;
    delete process.env.SSH_TTY;
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    // On linux, must have DISPLAY to not be headless
    process.env.DISPLAY = ":0";

    (startServer as jest.Mock).mockResolvedValue({
      url: "http://127.0.0.1:7777",
      token: "a".repeat(64),
      stop: jest.fn().mockResolvedValue(undefined),
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 100);

    await parsePromise;

    // Should have called xdg-open
    const runCalls = (runner.run as jest.Mock).mock.calls;
    const xdgCalls = runCalls.filter(([cmd]: [string]) => cmd === "xdg-open");
    expect(xdgCalls).toHaveLength(1);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    if (origCI !== undefined) process.env.CI = origCI;
    if (origSSH !== undefined) process.env.SSH_TTY = origSSH;
    delete process.env.DISPLAY;
  });

  it("should open browser with start on windows", async () => {
    const origCI = process.env.CI;
    delete process.env.CI;
    const origSSH = process.env.SSH_TTY;
    delete process.env.SSH_TTY;
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    (startServer as jest.Mock).mockResolvedValue({
      url: "http://127.0.0.1:7777",
      token: "a".repeat(64),
      stop: jest.fn().mockResolvedValue(undefined),
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 100);

    await parsePromise;

    const runCalls = (runner.run as jest.Mock).mock.calls;
    const startCalls = runCalls.filter(([cmd]: [string]) => cmd === "start");
    expect(startCalls).toHaveLength(1);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    if (origCI !== undefined) process.env.CI = origCI;
    if (origSSH !== undefined) process.env.SSH_TTY = origSSH;
  });

  it("should skip browser open on unsupported platform", async () => {
    const origCI = process.env.CI;
    delete process.env.CI;
    const origSSH = process.env.SSH_TTY;
    delete process.env.SSH_TTY;
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "freebsd", configurable: true });

    (startServer as jest.Mock).mockResolvedValue({
      url: "http://127.0.0.1:7777",
      token: "a".repeat(64),
      stop: jest.fn().mockResolvedValue(undefined),
    });

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 100);

    await parsePromise;

    // No browser open command should have been called
    const runCalls = (runner.run as jest.Mock).mock.calls;
    const browserCalls = runCalls.filter(
      ([cmd]: [string]) => cmd === "open" || cmd === "xdg-open" || cmd === "start",
    );
    expect(browserCalls).toHaveLength(0);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    if (origCI !== undefined) process.env.CI = origCI;
    if (origSSH !== undefined) process.env.SSH_TTY = origSSH;
  });

  it("should respond to SIGTERM for graceful shutdown", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    const parsePromise = program.parseAsync(["node", "clef", "ui", "--no-open"]);
    setTimeout(() => process.emit("SIGTERM", "SIGTERM"), 50);

    await parsePromise;

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Shutting down"));
  });

  it("should skip auto-open when CI=true and show info message", async () => {
    const origCI = process.env.CI;
    process.env.CI = "true";

    const runner: SubprocessRunner = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const program = makeProgram(runner);

    // Without --no-open, but in CI
    const parsePromise = program.parseAsync(["node", "clef", "ui"]);
    setTimeout(() => process.emit("SIGINT", "SIGINT"), 50);

    await parsePromise;

    expect(mockFormatter.info).toHaveBeenCalledWith(
      expect.stringContaining("Browser auto-open skipped"),
    );

    if (origCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = origCI;
    }
  });
});

describe("isHeadless", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return true when CI is set", () => {
    process.env.CI = "true";
    delete process.env.SSH_TTY;
    expect(isHeadless()).toBe(true);
  });

  it("should return true when SSH_TTY is set", () => {
    delete process.env.CI;
    process.env.SSH_TTY = "/dev/pts/0";
    expect(isHeadless()).toBe(true);
  });

  it("should return false in normal environment", () => {
    delete process.env.CI;
    delete process.env.SSH_TTY;
    // On macOS (darwin), DISPLAY check is skipped, so this should return false
    if (process.platform === "darwin") {
      expect(isHeadless()).toBe(false);
    }
  });

  it("should return true on linux without DISPLAY or WAYLAND_DISPLAY", () => {
    delete process.env.CI;
    delete process.env.SSH_TTY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;

    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    expect(isHeadless()).toBe(true);

    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });
});
