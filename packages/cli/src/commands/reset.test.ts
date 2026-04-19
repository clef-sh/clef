import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerResetCommand } from "./reset";
import { SubprocessRunner, ResetManager } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ResetManager: jest.fn(),
  };
});
jest.mock("../age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({
    client: {},
    cleanup: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    hint: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    formatDependencyError: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const MockResetManager = ResetManager as jest.MockedClass<typeof ResetManager>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [{ name: "database", description: "Database" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const runner: SubprocessRunner = { run: jest.fn() };

function makeProgram(): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerResetCommand(program, { runner });
  return program;
}

function mockResetResult(overrides = {}) {
  return {
    scaffoldedCells: ["/repo/database/staging.enc.yaml"],
    pendingKeysByCell: { "/repo/database/staging.enc.yaml": ["DB_URL"] },
    backendChanged: false,
    affectedEnvironments: ["staging"],
    ...overrides,
  };
}

describe("clef reset", () => {
  let mockReset: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    mockFormatter.confirm.mockResolvedValue(true);

    mockReset = jest.fn().mockResolvedValue(mockResetResult());
    MockResetManager.mockImplementation(() => ({ reset: mockReset }) as unknown as ResetManager);
  });

  describe("scope flags", () => {
    it("accepts --env and delegates to ResetManager with env scope", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { kind: "env", name: "staging" } }),
        expect.any(Object),
        expect.any(String),
      );
      expect(mockFormatter.success).toHaveBeenCalled();
    });

    it("accepts --namespace and delegates with namespace scope", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--namespace", "database"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { kind: "namespace", name: "database" } }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("accepts --cell and parses namespace/environment", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--cell", "database/staging"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { kind: "cell", namespace: "database", environment: "staging" },
        }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("refuses naked invocation with no scope", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset"]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Reset requires a scope"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("refuses multiple scope flags", async () => {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--env",
        "staging",
        "--namespace",
        "database",
      ]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("exactly one scope flag"),
      );
    });

    it("refuses malformed --cell value", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--cell", "malformed"]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid --cell value"),
      );
    });

    it("refuses scope that references unknown environment", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "nonexistent"]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Environment 'nonexistent' not found"),
      );
    });

    it("refuses scope that references unknown namespace", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--namespace", "nonexistent"]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("Namespace 'nonexistent' not found"),
      );
    });
  });

  describe("backend flags", () => {
    it("passes --aws-kms-arn as backend + key", async () => {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--env",
        "staging",
        "--aws-kms-arn",
        "arn:aws:kms:us-east-1:123:key/new",
      ]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: "awskms",
          key: "arn:aws:kms:us-east-1:123:key/new",
        }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("passes --age with no key", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging", "--age"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ backend: "age", key: undefined }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("refuses multiple backend flags", async () => {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--env",
        "staging",
        "--age",
        "--aws-kms-arn",
        "arn:aws:kms:us-east-1:123:key/new",
      ]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("at most one backend flag"),
      );
    });

    it("omits backend when no backend flag given", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ backend: undefined, key: undefined }),
        expect.any(Object),
        expect.any(String),
      );
    });
  });

  describe("--keys flag", () => {
    it("parses comma-separated keys and passes them through", async () => {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--cell",
        "database/staging",
        "--keys",
        "DB_URL,DB_PASSWORD",
      ]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ keys: ["DB_URL", "DB_PASSWORD"] }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("trims whitespace around keys", async () => {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--cell",
        "database/staging",
        "--keys",
        " DB_URL , DB_PASSWORD ",
      ]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ keys: ["DB_URL", "DB_PASSWORD"] }),
        expect.any(Object),
        expect.any(String),
      );
    });

    it("omits keys when flag not given", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockReset).toHaveBeenCalledWith(
        expect.objectContaining({ keys: undefined }),
        expect.any(Object),
        expect.any(String),
      );
    });
  });

  describe("confirmation gate", () => {
    it("aborts when the user declines", async () => {
      mockFormatter.confirm.mockResolvedValue(false);
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockReset).not.toHaveBeenCalled();
      expect(mockFormatter.info).toHaveBeenCalledWith("Reset cancelled.");
    });

    it("prompts before performing the reset", async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockFormatter.confirm).toHaveBeenCalledWith(
        expect.stringContaining("Reset env staging"),
      );
    });
  });

  describe("result reporting", () => {
    it("reports scaffolded cells and pending placeholders", async () => {
      mockReset.mockResolvedValue(
        mockResetResult({
          scaffoldedCells: [
            "/repo/database/staging.enc.yaml",
            "/repo/database/production.enc.yaml",
          ],
          pendingKeysByCell: {
            "/repo/database/staging.enc.yaml": ["DB_URL"],
            "/repo/database/production.enc.yaml": ["DB_URL", "DB_PASSWORD"],
          },
        }),
      );

      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--namespace", "database"]);

      expect(mockFormatter.success).toHaveBeenCalledWith(
        expect.stringContaining("scaffolded 2 cell(s)"),
      );
      expect(mockFormatter.info).toHaveBeenCalledWith(
        expect.stringContaining("3 pending placeholder(s)"),
      );
    });

    it("reports empty cells without a pending count", async () => {
      mockReset.mockResolvedValue(
        mockResetResult({
          scaffoldedCells: ["/repo/database/staging.enc.yaml"],
          pendingKeysByCell: {},
        }),
      );

      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--cell", "database/staging"]);

      expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("Cells are empty"));
    });

    it("reports backend change when one occurred", async () => {
      mockReset.mockResolvedValue(mockResetResult({ backendChanged: true }));
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "clef",
        "reset",
        "--env",
        "staging",
        "--aws-kms-arn",
        "arn:aws:kms:us-east-1:123:key/new",
      ]);

      expect(mockFormatter.info).toHaveBeenCalledWith(
        expect.stringContaining("Backend override written"),
      );
    });
  });

  describe("error handling", () => {
    it("exits with code 1 when ResetManager throws", async () => {
      mockReset.mockRejectedValue(new Error("transaction rollback"));
      const program = makeProgram();
      await program.parseAsync(["node", "clef", "reset", "--env", "staging"]);

      expect(mockFormatter.error).toHaveBeenCalledWith(
        expect.stringContaining("transaction rollback"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
