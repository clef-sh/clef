import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerMigrateBackendCommand } from "./migrate-backend";
import { SubprocessRunner, BackendMigrator } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    BackendMigrator: jest.fn(),
  };
});
jest.mock("../age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({}),
}));
jest.mock("./init", () => ({
  scaffoldSopsConfig: jest.fn(),
}));
jest.mock("../output/formatter", () => ({
  formatter: {
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    hint: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn(),
    formatDependencyError: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const MockBackendMigrator = BackendMigrator as jest.MockedClass<typeof BackendMigrator>;
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
  registerMigrateBackendCommand(program, { runner });
  return program;
}

function mockMigrateResult(overrides = {}) {
  return {
    migratedFiles: ["/repo/database/staging.enc.yaml", "/repo/database/production.enc.yaml"],
    skippedFiles: [],
    rolledBack: false,
    verifiedFiles: ["/repo/database/staging.enc.yaml", "/repo/database/production.enc.yaml"],
    warnings: [],
    ...overrides,
  };
}

describe("clef migrate-backend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    mockFormatter.confirm.mockResolvedValue(true);

    const mockMigrate = jest.fn().mockResolvedValue(mockMigrateResult());
    MockBackendMigrator.mockImplementation(
      () => ({ migrate: mockMigrate }) as unknown as BackendMigrator,
    );
  });

  it("should migrate to AWS KMS and show success", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "migrate-backend",
      "--aws-kms-arn",
      "arn:aws:kms:us-east-1:123:key/abc",
    ]);

    expect(mockFormatter.confirm).toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Migrated 2"));
    expect(mockFormatter.hint).toHaveBeenCalled();
  });

  it("should show environments in confirmation prompt", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "migrate-backend", "--aws-kms-arn", "arn:..."]);

    // Should print summary with environments
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("staging, production"),
    );
    // Should warn about protected environment
    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("production"));
  });

  it("should cancel when user declines confirmation", async () => {
    mockFormatter.confirm.mockResolvedValue(false);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "migrate-backend", "--aws-kms-arn", "arn:..."]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Migration cancelled.");
    expect(MockBackendMigrator).not.toHaveBeenCalled();
  });

  it("should not prompt in dry-run mode", async () => {
    const mockMigrate = jest.fn().mockResolvedValue(mockMigrateResult({ migratedFiles: [] }));
    MockBackendMigrator.mockImplementation(
      () => ({ migrate: mockMigrate }) as unknown as BackendMigrator,
    );

    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "migrate-backend",
      "--aws-kms-arn",
      "arn:...",
      "--dry-run",
    ]);

    expect(mockFormatter.confirm).not.toHaveBeenCalled();
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });

  it("should error when no backend flag is provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "migrate-backend"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("No target backend"));
  });

  it("should error when multiple backend flags are provided", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "migrate-backend",
      "--aws-kms-arn",
      "arn:...",
      "--age",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Multiple target backends"),
    );
  });

  it("should exit with code 1 on rollback", async () => {
    const mockMigrate = jest
      .fn()
      .mockResolvedValue(
        mockMigrateResult({ rolledBack: true, error: "KMS access denied", migratedFiles: [] }),
      );
    MockBackendMigrator.mockImplementation(
      () => ({ migrate: mockMigrate }) as unknown as BackendMigrator,
    );

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "migrate-backend", "--aws-kms-arn", "arn:..."]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("KMS access denied"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should scope to a single environment with -e", async () => {
    const program = makeProgram();
    await program.parseAsync([
      "node",
      "clef",
      "migrate-backend",
      "--aws-kms-arn",
      "arn:...",
      "-e",
      "production",
    ]);

    // Summary should show only production
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("production"));
  });
});
