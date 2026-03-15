import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerServiceCommand } from "./service";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock(
  "age-encryption",
  () => ({
    generateIdentity: jest
      .fn()
      .mockResolvedValue("AGE-SECRET-KEY-1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L"),
    identityToRecipient: jest
      .fn()
      .mockResolvedValue("age1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn5"),
  }),
  { virtual: true },
);
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
    table: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

// Valid bech32 public keys for testing
const VALID_KEY_DEV = "age1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn5";
const VALID_KEY_STG = "age1x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce";

const manifestWithIdentity = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "staging", description: "Staging" },
  ],
  namespaces: [{ name: "api", description: "API" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
  service_identities: [
    {
      name: "existing-svc",
      description: "Existing service",
      namespaces: ["api"],
      environments: {
        dev: { recipient: VALID_KEY_DEV },
        staging: { recipient: VALID_KEY_STG },
      },
    },
  ],
};

const sopsFileContent = YAML.stringify({
  sops: {
    age: [{ recipient: "age1qpzry9x8gf2tvdw0s3jn54khce6mua7l" }],
    lastmodified: "2024-01-15T00:00:00Z",
  },
});

function makeRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "cat") {
        return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerServiceCommand(program, { runner });
  return program;
}

describe("clef service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(YAML.stringify(manifestWithIdentity));
    mockFs.existsSync.mockReturnValue(true);
    mockFs.writeFileSync.mockImplementation(() => {});
  });

  describe("list", () => {
    it("should list service identities", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "list"]);

      expect(mockFormatter.table).toHaveBeenCalled();
      const rows = (mockFormatter.table as jest.Mock).mock.calls[0][0];
      expect(rows[0][0]).toBe("existing-svc");
    });

    it("should show info when no identities configured", async () => {
      const noIdentities = { ...manifestWithIdentity };
      delete (noIdentities as Record<string, unknown>).service_identities;
      mockFs.readFileSync.mockReturnValue(YAML.stringify(noIdentities));
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "list"]);

      expect(mockFormatter.info).toHaveBeenCalledWith(
        expect.stringContaining("No service identities"),
      );
    });
  });

  describe("show", () => {
    it("should show identity details", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "show", "existing-svc"]);

      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("existing-svc"));

      // Should not leak private keys or full public keys
      const allPrintCalls = (mockFormatter.print as jest.Mock).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(allPrintCalls).not.toContain("AGE-SECRET-KEY-");
      expect(allPrintCalls).not.toContain(VALID_KEY_DEV);
      expect(allPrintCalls).not.toContain(VALID_KEY_STG);
    });

    it("should error on unknown identity", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "show", "unknown"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("create", () => {
    it("should create a service identity and print private keys", async () => {
      const noIdentities = {
        version: 1,
        environments: [
          { name: "dev", description: "Dev" },
          { name: "staging", description: "Staging" },
        ],
        namespaces: [{ name: "api", description: "API" }],
        sops: { default_backend: "age" },
        file_pattern: "{namespace}/{environment}.enc.yaml",
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(noIdentities));
      mockFs.existsSync.mockReturnValue(false);

      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "create",
        "new-svc",
        "--namespaces",
        "api",
        "--description",
        "New service",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("new-svc"));
      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("ONCE"));
      expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("AGE-SECRET-KEY-"));
    });

    it("should error when namespace not found", async () => {
      const noIdentities = {
        version: 1,
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "api", description: "API" }],
        sops: { default_backend: "age" },
        file_pattern: "{namespace}/{environment}.enc.yaml",
      };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(noIdentities));
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "create",
        "new-svc",
        "--namespaces",
        "nonexistent",
      ]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("rotate", () => {
    it("should rotate and print new keys", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "rotate", "existing-svc"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("rotated"));
      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("ONCE"));
    });

    it("should error on unknown identity", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "rotate", "unknown"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should support --environment flag", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "rotate",
        "existing-svc",
        "--environment",
        "dev",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("rotated"));
    });
  });
});
