import * as readline from "readline";
import { SopsMissingError, SopsVersionError } from "@clef-sh/core";
import { formatter } from "./formatter";
import { setPlainMode, isPlainMode } from "./symbols";

// Mock readline so we can control createInterface
jest.mock("readline", () => {
  const actual = jest.requireActual("readline");
  return {
    ...actual,
    createInterface: jest.fn(),
  };
});

const mockCreateInterface = readline.createInterface as jest.Mock;

describe("formatter", () => {
  let stdoutWrite: jest.SpyInstance;
  let stderrWrite: jest.SpyInstance;

  beforeEach(() => {
    stdoutWrite = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrWrite = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    setPlainMode(false);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    setPlainMode(false);
    delete process.env.NO_COLOR;
    delete process.env.TERM;
  });

  describe("success", () => {
    it("should write a green checkmark message to stdout", () => {
      formatter.success("All done");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("All done");
      expect(output).toContain("\u2713");
    });

    it("should use [ok] in plain mode", () => {
      setPlainMode(true);
      formatter.success("All done");
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("[ok]");
      expect(output).toContain("All done");
      expect(output).not.toContain("\u2713");
    });
  });

  describe("failure", () => {
    it("should write a failure message to stderr", () => {
      formatter.failure("Something broke");
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("Something broke");
      expect(output).toContain("\u2717");
    });

    it("should use [fail] in plain mode", () => {
      setPlainMode(true);
      formatter.failure("Something broke");
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("[fail]");
      expect(output).not.toContain("\u2717");
    });
  });

  describe("error", () => {
    it("should write error message to stderr", () => {
      formatter.error("Something failed");
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("Error:");
      expect(output).toContain("Something failed");
    });

    it("should use [fail] prefix in plain mode", () => {
      setPlainMode(true);
      formatter.error("Something failed");
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("[fail]");
      expect(output).toContain("Error:");
    });
  });

  describe("warn", () => {
    it("should write warning message to stderr", () => {
      formatter.warn("Be careful");
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("\u26A0");
      expect(output).toContain("Be careful");
    });

    it("should use [warn] in plain mode", () => {
      setPlainMode(true);
      formatter.warn("Be careful");
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("[warn]");
      expect(output).not.toContain("\u26A0");
    });
  });

  describe("info", () => {
    it("should write info message to stdout", () => {
      formatter.info("FYI");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("FYI");
      expect(output).toContain("\u2139");
    });

    it("should use [info] in plain mode", () => {
      setPlainMode(true);
      formatter.info("FYI");
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("[info]");
    });
  });

  describe("hint", () => {
    it("should write a hint with arrow prefix to stdout", () => {
      formatter.hint("clef set payments/staging KEY");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("\u2192");
      expect(output).toContain("clef set payments/staging KEY");
    });

    it("should use --> in plain mode", () => {
      setPlainMode(true);
      formatter.hint("clef set payments/staging KEY");
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("-->");
      expect(output).not.toContain("\u2192");
    });
  });

  describe("keyValue", () => {
    it("should write key → value with key emoji", () => {
      formatter.keyValue("DB_HOST", "localhost");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("DB_HOST");
      expect(output).toContain("localhost");
      expect(output).toContain("\u2192");
      expect(output).toContain("\uD83D\uDD11");
    });

    it("should strip emoji in plain mode", () => {
      setPlainMode(true);
      formatter.keyValue("DB_HOST", "localhost");
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("DB_HOST");
      expect(output).toContain("localhost");
      expect(output).toContain("-->");
      expect(output).not.toContain("\uD83D\uDD11");
    });
  });

  describe("pendingItem", () => {
    it("should write pending item with hourglass", () => {
      formatter.pendingItem("DB_PASSWORD", 5);
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("DB_PASSWORD");
      expect(output).toContain("5 days pending");
      expect(output).toContain("\u23F3");
    });

    it("should handle singular day", () => {
      formatter.pendingItem("KEY", 1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("1 day pending");
      expect(output).not.toContain("days");
    });

    it("should use [pending] in plain mode", () => {
      setPlainMode(true);
      formatter.pendingItem("DB_PASSWORD", 5);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("[pending]");
      expect(output).not.toContain("\u23F3");
    });
  });

  describe("recipientItem", () => {
    it("should write recipient with person emoji", () => {
      formatter.recipientItem("Alice", "age1\u2026xyz1");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("Alice");
      expect(output).toContain("age1\u2026xyz1");
      expect(output).toContain("\uD83D\uDC64");
    });

    it("should strip emoji in plain mode", () => {
      setPlainMode(true);
      formatter.recipientItem("Alice", "age1\u2026xyz1");
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toContain("Alice");
      expect(output).not.toContain("\uD83D\uDC64");
    });
  });

  describe("section", () => {
    it("should write a section header with spacing", () => {
      formatter.section("Next steps:");
      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      const output = stdoutWrite.mock.calls[0][0] as string;
      expect(output).toBe("\nNext steps:\n\n");
    });
  });

  describe("print", () => {
    it("should write plain message to stdout", () => {
      formatter.print("hello world");
      expect(stdoutWrite).toHaveBeenCalledWith("hello world\n");
    });
  });

  describe("raw", () => {
    it("should write raw string without newline to stdout", () => {
      formatter.raw("raw-data");
      expect(stdoutWrite).toHaveBeenCalledWith("raw-data");
    });
  });

  describe("table", () => {
    it("should render a formatted table with headers", () => {
      formatter.table(
        [
          ["KEY_A", "value1", "value2"],
          ["KEY_B", "x", "y"],
        ],
        ["Key", "Dev", "Prod"],
      );

      // Header + separator + 2 data rows = 4 writes
      expect(stdoutWrite.mock.calls.length).toBe(4);
      const header = stdoutWrite.mock.calls[0][0] as string;
      expect(header).toContain("Key");
      expect(header).toContain("Dev");
      expect(header).toContain("Prod");
    });

    it("should handle empty rows", () => {
      formatter.table([], ["Key", "Value"]);
      // Header + separator = 2 writes
      expect(stdoutWrite.mock.calls.length).toBe(2);
    });

    it("should not use bold in plain mode", () => {
      setPlainMode(true);
      formatter.table([["a", "b"]], ["Col1", "Col2"]);
      const header = stdoutWrite.mock.calls[0][0] as string;
      // Should not contain ANSI escape codes
      // eslint-disable-next-line no-control-regex
      expect(header).not.toMatch(/\u001B\[/);
    });
  });

  describe("confirm", () => {
    it("should return true when user answers 'y'", async () => {
      const stdinPause = jest.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
      const mockRl = {
        question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
          cb("y");
        }),
        close: jest.fn(),
      };
      mockCreateInterface.mockReturnValue(mockRl);

      const result = await formatter.confirm("Are you sure?");
      expect(result).toBe(true);
      expect(mockRl.close).toHaveBeenCalled();
      stdinPause.mockRestore();
    });

    it("should pause stdin after confirm to prevent process hang", async () => {
      const stdinPause = jest.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
      const mockRl = {
        question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
          cb("n");
        }),
        close: jest.fn(),
      };
      mockCreateInterface.mockReturnValue(mockRl);

      await formatter.confirm("Continue?");
      expect(stdinPause).toHaveBeenCalled();
      stdinPause.mockRestore();
    });

    it("should return true when user answers 'yes'", async () => {
      const mockRl = {
        question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
          cb("yes");
        }),
        close: jest.fn(),
      };
      mockCreateInterface.mockReturnValue(mockRl);

      const result = await formatter.confirm("Are you sure?");
      expect(result).toBe(true);
    });

    it("should return false when user answers 'n'", async () => {
      const mockRl = {
        question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
          cb("n");
        }),
        close: jest.fn(),
      };
      mockCreateInterface.mockReturnValue(mockRl);

      const result = await formatter.confirm("Are you sure?");
      expect(result).toBe(false);
    });

    it("should return false when user answers empty string", async () => {
      const mockRl = {
        question: jest.fn((_prompt: string, cb: (answer: string) => void) => {
          cb("");
        }),
        close: jest.fn(),
      };
      mockCreateInterface.mockReturnValue(mockRl);

      const result = await formatter.confirm("Are you sure?");
      expect(result).toBe(false);
    });
  });

  describe("formatDependencyError", () => {
    it("should format SopsMissingError correctly", () => {
      const err = new SopsMissingError("brew install sops");
      formatter.formatDependencyError(err);

      const output = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("sops is not installed");
      expect(output).toContain("brew install sops");
      expect(output).toContain("clef doctor");
    });

    it("should format SopsVersionError correctly", () => {
      const err = new SopsVersionError("3.7.0", "3.8.0", "brew upgrade sops");
      formatter.formatDependencyError(err);

      const output = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("sops");
      expect(output).toContain("3.7.0");
      expect(output).toContain("3.8.0");
      expect(output).toContain("brew upgrade sops");
    });

    it("should use plain symbols in plain mode", () => {
      setPlainMode(true);
      const err = new SopsMissingError("brew install sops");
      formatter.formatDependencyError(err);

      const output = stderrWrite.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("[fail]");
      expect(output).toContain("-->");
      // eslint-disable-next-line no-control-regex
      expect(output).not.toMatch(/\u001B\[/);
    });
  });

  describe("plain mode detection", () => {
    it("should detect NO_COLOR=1", () => {
      process.env.NO_COLOR = "1";
      expect(isPlainMode()).toBe(true);
    });

    it("should detect TERM=dumb", () => {
      process.env.TERM = "dumb";
      expect(isPlainMode()).toBe(true);
    });

    it("should detect setPlainMode(true)", () => {
      setPlainMode(true);
      expect(isPlainMode()).toBe(true);
    });

    it("should not be plain by default", () => {
      expect(isPlainMode()).toBe(false);
    });

    it("NO_COLOR=1 should produce same output as --plain", () => {
      // Test with setPlainMode
      setPlainMode(true);
      formatter.success("test");
      const plainOutput = stdoutWrite.mock.calls[0][0] as string;
      stdoutWrite.mockClear();

      // Test with NO_COLOR
      setPlainMode(false);
      process.env.NO_COLOR = "1";
      formatter.success("test");
      const noColorOutput = stdoutWrite.mock.calls[0][0] as string;

      expect(plainOutput).toBe(noColorOutput);
    });

    it("TERM=dumb should produce same output as --plain", () => {
      setPlainMode(true);
      formatter.warn("test");
      const plainOutput = stderrWrite.mock.calls[0][0] as string;
      stderrWrite.mockClear();

      setPlainMode(false);
      process.env.TERM = "dumb";
      formatter.warn("test");
      const dumbOutput = stderrWrite.mock.calls[0][0] as string;

      expect(plainOutput).toBe(dumbOutput);
    });
  });

  describe("secretPrompt", () => {
    let stdinOnSpy: jest.SpyInstance;
    let stdinRemoveListenerSpy: jest.SpyInstance;

    afterEach(() => {
      if (stdinOnSpy) stdinOnSpy.mockRestore();
      if (stdinRemoveListenerSpy) stdinRemoveListenerSpy.mockRestore();
    });

    it("should collect characters and resolve on enter (TTY mode)", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      const setRawMode = jest.fn();
      const origSetRawMode = process.stdin.setRawMode;
      process.stdin.setRawMode = setRawMode;

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("s"));
      dataHandler(Buffer.from("e"));
      dataHandler(Buffer.from("c"));
      dataHandler(Buffer.from("\n"));

      const result = await promise;
      expect(result).toBe("sec");
      expect(setRawMode).toHaveBeenCalledWith(true);
      expect(setRawMode).toHaveBeenCalledWith(false);

      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      process.stdin.setRawMode = origSetRawMode;
    });

    it("should reject on Ctrl+C", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("\u0003"));

      await expect(promise).rejects.toThrow("User cancelled input");

      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    });

    it("should handle backspace by removing last character", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("a"));
      dataHandler(Buffer.from("b"));
      dataHandler(Buffer.from("c"));
      dataHandler(Buffer.from("\u007f"));
      dataHandler(Buffer.from("d"));
      dataHandler(Buffer.from("\r"));

      const result = await promise;
      expect(result).toBe("abd");

      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    });

    it("should handle EOT (Ctrl+D) as end of input", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("x"));
      dataHandler(Buffer.from("\u0004"));

      const result = await promise;
      expect(result).toBe("x");

      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    });

    it("should pause stdin after input to prevent process hang", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const stdinPause = jest.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("v"));
      dataHandler(Buffer.from("\n"));

      await promise;
      expect(stdinPause).toHaveBeenCalled();

      stdinPause.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    });

    it("should handle Ctrl+C in TTY mode by disabling raw mode first", async () => {
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      const setRawMode = jest.fn();
      const origSetRawMode = process.stdin.setRawMode;
      process.stdin.setRawMode = setRawMode;

      const listeners: Map<string, (chunk: Buffer) => void> = new Map();
      stdinOnSpy = jest
        .spyOn(process.stdin, "on")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((event: any, handler: any) => {
          listeners.set(event, handler);
          return process.stdin;
        });
      stdinRemoveListenerSpy = jest
        .spyOn(process.stdin, "removeListener")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overloaded signature
        .mockImplementation((_event: any, _handler: any) => {
          return process.stdin;
        });

      const promise = formatter.secretPrompt("Enter secret");

      const dataHandler = listeners.get("data")!;
      dataHandler(Buffer.from("\u0003"));

      await expect(promise).rejects.toThrow("User cancelled input");
      expect(setRawMode).toHaveBeenCalledWith(false);

      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      process.stdin.setRawMode = origSetRawMode;
    });
  });
});
