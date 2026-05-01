import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerServiceCommand } from "./service";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
// Stub TransactionManager so the test doesn't try to acquire lock files,
// run git preflight, or commit. The mutate callback runs inline; real
// transaction semantics live in transaction-manager.test.ts.
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    GitIntegration: jest.fn().mockImplementation(() => ({})),
    TransactionManager: jest.fn().mockImplementation(() => ({
      run: jest
        .fn()
        .mockImplementation(
          async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
            await opts.mutate();
            return { sha: null, paths: opts.paths, startedDirty: false };
          },
        ),
    })),
  };
});
jest.mock("../clipboard", () => ({
  copyToClipboard: jest.fn().mockReturnValue(true),
  maskedPlaceholder: jest.fn().mockReturnValue("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"),
}));
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
    json: jest.fn(),
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
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
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
        return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
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

    it("should output JSON with --json flag", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "list"]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("existing-svc");

      isJsonMode.mockReturnValue(false);
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

    it("should output JSON with --json flag for show", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "show", "existing-svc"]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.name).toBe("existing-svc");

      isJsonMode.mockReturnValue(false);
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
      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("clipboard"));
    });

    it("should output JSON with --json flag for create", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

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

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.action).toBe("created");
      expect(data.identity).toBe("new-svc");

      isJsonMode.mockReturnValue(false);
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

    it("should print one shared key with --shared-recipient", async () => {
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
        "shared-svc",
        "--namespaces",
        "api",
        "--shared-recipient",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("shared-svc"));
      // Warn message should mention CLEF_AGE_KEY (shared key hint) not per-env keys
      const warnCalls = (mockFormatter.warn as jest.Mock).mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(warnCalls.some((m) => m.includes("Shared"))).toBe(true);
      // Should not print separate per-env key lines
      const printCalls = (mockFormatter.print as jest.Mock).mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(printCalls.some((m) => m.includes("CLEF_AGE_KEY"))).toBe(true);
      expect(printCalls.some((m) => m.startsWith("  dev:"))).toBe(false);
      expect(printCalls.some((m) => m.startsWith("  staging:"))).toBe(false);
    });

    it("should create a runtime identity with --runtime flag", async () => {
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
        "lambda-svc",
        "--namespaces",
        "api",
        "--runtime",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("lambda-svc"));
      const printCalls = (mockFormatter.print as jest.Mock).mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      // Should show runtime mode
      expect(printCalls.some((m) => m.includes("runtime"))).toBe(true);
      // Runtime default is per-env keys (not shared), so individual env lines should appear
      expect(printCalls.some((m) => m.includes("dev:"))).toBe(true);
    });

    it("should default to shared-recipient for CI (no --runtime)", async () => {
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
        "ci-svc",
        "--namespaces",
        "api",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("ci-svc"));
      // CI default is shared-recipient, so should see CLEF_AGE_KEY
      const warnCalls = (mockFormatter.warn as jest.Mock).mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(warnCalls.some((m) => m.includes("Shared"))).toBe(true);
      const printCalls = (mockFormatter.print as jest.Mock).mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(printCalls.some((m) => m.includes("CI"))).toBe(true);
    });
  });

  describe("rotate", () => {
    it("should rotate and print new keys", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "rotate", "existing-svc"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("rotated"));
      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("clipboard"));
    });

    it("should output JSON with --json flag for rotate", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "rotate", "existing-svc"]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.action).toBe("rotated");
      expect(data.identity).toBe("existing-svc");

      isJsonMode.mockReturnValue(false);
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

  describe("update", () => {
    it("should update an environment to KMS", async () => {
      mockFs.existsSync.mockReturnValue(false);
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "update",
        "existing-svc",
        "--kms-env",
        "dev=aws:arn:aws:kms:us-east-1:123456789012:key/test",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("updated"));
    });

    it("should output JSON with --json flag for update", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      mockFs.existsSync.mockReturnValue(false);
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "update",
        "existing-svc",
        "--kms-env",
        "dev=aws:arn:aws:kms:us-east-1:123456789012:key/test",
      ]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.action).toBe("updated");
      expect(data.identity).toBe("existing-svc");

      isJsonMode.mockReturnValue(false);
    });

    it("should error with no --kms-env flags", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync(["node", "clef", "service", "update", "existing-svc"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Nothing to update"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should error on duplicate --kms-env for same environment", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "update",
        "existing-svc",
        "--kms-env",
        "production=aws:arn:aws:kms:key1",
        "--kms-env",
        "production=aws:arn:aws:kms:key2",
      ]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Duplicate"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should error on unknown identity", async () => {
      const runner = makeRunner();
      const program = makeProgram(runner);

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "update",
        "nonexistent",
        "--kms-env",
        "production=aws:arn:aws:kms:key1",
      ]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("add-env", () => {
    /**
     * Manifest with an SI that's missing a config for `staging` — exactly
     * the gap `clef service add-env` fills.
     */
    const manifestMissingEnv = {
      ...manifestWithIdentity,
      environments: [
        { name: "dev", description: "Dev" },
        { name: "staging", description: "Staging" },
      ],
      service_identities: [
        {
          name: "existing-svc",
          description: "Existing service",
          namespaces: ["api"],
          environments: {
            // Only dev — staging is missing on purpose
            dev: { recipient: VALID_KEY_DEV },
          },
        },
      ],
    };

    beforeEach(() => {
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifestMissingEnv));
    });

    it("adds an env with a generated age key by default and prints the new key", async () => {
      const program = makeProgram(makeRunner());

      await program.parseAsync(["node", "clef", "service", "add-env", "existing-svc", "staging"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Added 'staging' to service identity 'existing-svc'"),
      );
      // Either copied to clipboard or printed; both paths warn the user
      expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("Store it"));
      // mockExit was not called with 1
      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it("supports --kms with a provider:keyId mapping", async () => {
      const program = makeProgram(makeRunner());

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "add-env",
        "existing-svc",
        "staging",
        "--kms",
        "aws:arn:aws:kms:us-east-1:123456789012:key/abc",
      ]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("Added 'staging' to service identity 'existing-svc'"),
      );
      // Should NOT print/copy a private key — KMS path returns undefined
      expect(mockFormatter.warn).not.toHaveBeenCalledWith(expect.stringContaining("Store it"));
    });

    it("errors with exit 2 on malformed --kms format", async () => {
      const program = makeProgram(makeRunner());

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "add-env",
        "existing-svc",
        "staging",
        "--kms",
        "noColonHere",
      ]);

      expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid --kms"));
      expect(mockExit).toHaveBeenCalledWith(2);
    });

    it("errors with exit 2 on unknown KMS provider", async () => {
      const program = makeProgram(makeRunner());

      await program.parseAsync([
        "node",
        "clef",
        "service",
        "add-env",
        "existing-svc",
        "staging",
        "--kms",
        "made-up-provider:keyid",
      ]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid KMS provider"),
      );
      expect(mockExit).toHaveBeenCalledWith(2);
    });

    it("outputs JSON with --json flag", async () => {
      const { isJsonMode } = jest.requireMock("../output/formatter") as {
        isJsonMode: jest.Mock;
      };
      isJsonMode.mockReturnValue(true);

      const program = makeProgram(makeRunner());

      await program.parseAsync(["node", "clef", "service", "add-env", "existing-svc", "staging"]);

      expect(mockFormatter.json).toHaveBeenCalled();
      const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
      expect(data.action).toBe("env-added");
      expect(data.identity).toBe("existing-svc");
      expect(data.environment).toBe("staging");
      expect(data.backend).toBe("age");

      isJsonMode.mockReturnValue(false);
    });
  });
});
