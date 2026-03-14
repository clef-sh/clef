import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerRecipientsCommand } from "./recipients";
import { SubprocessRunner, RecipientManager } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("readline", () => ({
  createInterface: jest.fn().mockReturnValue({
    question: jest.fn((_q: string, cb: (answer: string) => void) => cb("")),
    close: jest.fn(),
  }),
}));
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    RecipientManager: jest.fn().mockImplementation(() => ({
      list: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue({
        added: { key: "age1testkey12345678", preview: "age1\u202612345678" },
        recipients: [],
        reEncryptedFiles: [],
        failedFiles: [],
        warnings: [],
      }),
      remove: jest.fn().mockResolvedValue({
        removed: { key: "age1testkey12345678", preview: "age1\u202612345678" },
        recipients: [],
        reEncryptedFiles: [],
        failedFiles: [],
        warnings: [],
      }),
    })),
  };
});
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
    formatDependencyError: jest.fn(),
    table: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    recipientItem: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "staging", description: "Staging" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [
    { name: "database", description: "Database" },
    { name: "payments", description: "Payments" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const defaultRunner: SubprocessRunner = {
  run: jest.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "age") return { stdout: "v1.1.1", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  }),
};

function makeProgram(runner: SubprocessRunner = defaultRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerRecipientsCommand(program, { runner });
  return program;
}

function mockRecipientManager(overrides: Record<string, unknown> = {}): void {
  const defaults = {
    list: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue({
      added: { key: "age1testkey12345678", preview: "age1\u202612345678" },
      recipients: [],
      reEncryptedFiles: ["/repo/database/dev.enc.yaml", "/repo/database/staging.enc.yaml"],
      failedFiles: [],
      warnings: [],
    }),
    remove: jest.fn().mockResolvedValue({
      removed: { key: "age1testkey12345678", preview: "age1\u202612345678" },
      recipients: [],
      reEncryptedFiles: ["/repo/database/dev.enc.yaml", "/repo/database/staging.enc.yaml"],
      failedFiles: [],
      warnings: [],
    }),
  };
  (RecipientManager as jest.Mock).mockImplementation(() => ({
    ...defaults,
    ...overrides,
  }));
}

describe("clef recipients", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
  });

  describe("list", () => {
    it("should show correct output format with labels", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([
          { key: "age1key1abcdefgh", preview: "age1\u2026abcdefgh", label: "Alice" },
          { key: "age1key2ijklmnop", preview: "age1\u2026ijklmnop", label: "Bob" },
          { key: "age1key3qrstuvwx", preview: "age1\u2026qrstuvwx", label: "CI deploy key" },
        ]),
      });
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "list"]);

      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("3 recipients"));
      expect(mockFormatter.recipientItem).toHaveBeenCalledWith("Alice", "age1\u2026abcdefgh");
      expect(mockFormatter.recipientItem).toHaveBeenCalledWith("Bob", "age1\u2026ijklmnop");
      expect(mockFormatter.recipientItem).toHaveBeenCalledWith(
        "CI deploy key",
        "age1\u2026qrstuvwx",
      );
    });

    it("should show correct output format without labels", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([
          { key: "age1key1abcdefgh", preview: "age1\u2026abcdefgh" },
          { key: "age1key2ijklmnop", preview: "age1\u2026ijklmnop" },
        ]),
      });
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "list"]);

      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("2 recipients"));
      // Without labels, preview is used as the label and keyPreview is empty
      expect(mockFormatter.recipientItem).toHaveBeenCalledWith("age1\u2026abcdefgh", "");
      expect(mockFormatter.recipientItem).toHaveBeenCalledWith("age1\u2026ijklmnop", "");
    });
  });

  describe("add", () => {
    const validKey = "age1qqnv7zhqs7fqmnqf8kfr33n32tyxdsacrpwlsnt0yeqyqvc2jmyqsyjssv";

    it("should show confirmation prompt", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([]),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", validKey, "--label", "Alice"]);

      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("Add recipient to this repository?"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Label:  Alice"));
      expect(mockFormatter.confirm).toHaveBeenCalledWith("Proceed?");
    });

    it("should reject invalid key format before confirmation (exit 2)", async () => {
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", "not-a-valid-key"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("age1"));
      expect(mockExit).toHaveBeenCalledWith(2);
      expect(mockFormatter.confirm).not.toHaveBeenCalled();
    });

    it("should reject duplicate key (exit 2)", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([{ key: validKey, preview: "age1\u2026jmyqsyjssv" }]),
      });
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", validKey]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("already present"));
      expect(mockExit).toHaveBeenCalledWith(2);
    });

    it("should show progress during re-encryption", async () => {
      const cwd = process.cwd();
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({
          added: { key: validKey, preview: "age1\u2026jmyqsyjssv" },
          recipients: [],
          reEncryptedFiles: [`${cwd}/database/dev.enc.yaml`, `${cwd}/database/staging.enc.yaml`],
          failedFiles: [],
          warnings: [],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValue(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", validKey]);

      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("Re-encrypting matrix..."),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("\u2713  database/dev.enc.yaml"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("\u2713  database/staging.enc.yaml"),
      );
    });

    it("should show commit hint after success", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({
          added: { key: validKey, preview: "age1\u2026jmyqsyjssv", label: "Alice" },
          recipients: [],
          reEncryptedFiles: ["/repo/database/dev.enc.yaml"],
          failedFiles: [],
          warnings: [],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", validKey, "--label", "Alice"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("1 files re-encrypted"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining(
          'git add clef.yaml && git add -A && git commit -m "add recipient: Alice"',
        ),
      );
    });

    it("should show rollback output on failure (exit 1)", async () => {
      mockRecipientManager({
        list: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({
          added: { key: validKey, preview: "age1\u2026jmyqsyjssv" },
          recipients: [],
          reEncryptedFiles: [],
          failedFiles: ["/repo/payments/production.enc.yaml"],
          warnings: ["Rollback completed: manifest and re-encrypted files have been restored."],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "add", validKey]);

      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("\u2717 Re-encryption failed"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Rolling back..."));
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("clef.yaml restored"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("No changes were applied"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("remove", () => {
    const targetKey = "age1qqnv7zhqs7fqmnqf8kfr33n32tyxdsacrpwlsnt0yeqyqvc2jmyqsyjssv";

    it("should show re-encryption warning before confirmation", async () => {
      const originalTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      mockRecipientManager({
        list: jest
          .fn()
          .mockResolvedValue([{ key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" }]),
        remove: jest.fn().mockResolvedValue({
          removed: { key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" },
          recipients: [],
          reEncryptedFiles: ["/repo/database/dev.enc.yaml"],
          failedFiles: [],
          warnings: [],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "remove", targetKey]);

      expect(mockFormatter.warn).toHaveBeenCalledWith(
        expect.stringContaining("re-encryption is not full revocation"),
      );
      // Confirm should be called after the warning
      expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("Proceed?"));

      Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
    });

    it("should list actual namespaces from manifest in rotation reminder", async () => {
      const originalTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      mockRecipientManager({
        list: jest
          .fn()
          .mockResolvedValue([{ key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" }]),
        remove: jest.fn().mockResolvedValue({
          removed: { key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" },
          recipients: [],
          reEncryptedFiles: ["/repo/database/dev.enc.yaml"],
          failedFiles: [],
          warnings: [],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "remove", targetKey]);

      // Check that actual namespace/environment combos are listed via hint()
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate database/dev"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate database/staging"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate database/production"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate payments/dev"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate payments/staging"),
      );
      expect(mockFormatter.hint).toHaveBeenCalledWith(
        expect.stringContaining("clef rotate payments/production"),
      );

      Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
    });

    it("should exit with code 2 in non-TTY environment", async () => {
      const originalTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "remove", targetKey]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("requires interactive input"),
      );
      expect(mockExit).toHaveBeenCalledWith(2);

      Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
    });

    it("should show rollback output on failure (exit 1)", async () => {
      const originalTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      mockRecipientManager({
        list: jest
          .fn()
          .mockResolvedValue([{ key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" }]),
        remove: jest.fn().mockResolvedValue({
          removed: { key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" },
          recipients: [],
          reEncryptedFiles: [],
          failedFiles: ["/repo/payments/production.enc.yaml"],
          warnings: ["Rollback completed: manifest and re-encrypted files have been restored."],
        }),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(true);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "remove", targetKey]);

      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("\u2717 Re-encryption failed"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Rolling back..."));
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("clef.yaml restored"),
      );
      expect(mockFormatter.print).toHaveBeenCalledWith(
        expect.stringContaining("No changes were applied"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
    });

    it("should not make changes when user declines confirmation (exit 0)", async () => {
      const originalTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      mockRecipientManager({
        list: jest
          .fn()
          .mockResolvedValue([{ key: targetKey, preview: "age1\u2026jmyqsyjssv", label: "Bob" }]),
      });
      (mockFormatter.confirm as jest.Mock).mockResolvedValueOnce(false);
      const program = makeProgram();

      await program.parseAsync(["node", "clef", "recipients", "remove", targetKey]);

      expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
      expect(mockExit).toHaveBeenCalledWith(0);
      // RecipientManager.remove should NOT have been called
      const rmInstance = (RecipientManager as jest.Mock).mock.results[0].value;
      expect(rmInstance.remove).not.toHaveBeenCalled();

      Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
    });
  });
});
