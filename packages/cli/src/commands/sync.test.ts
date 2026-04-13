import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerSyncCommand } from "./sync";
import { SubprocessRunner, SyncManager } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    SyncManager: jest.fn(),
  };
});
jest.mock("../age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({}),
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
const MockSyncManager = SyncManager as jest.MockedClass<typeof SyncManager>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [{ name: "payments", description: "Payments" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const runner: SubprocessRunner = { run: jest.fn() };

function makeProgram(): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerSyncCommand(program, { runner });
  return program;
}

function mockPlan(overrides = {}) {
  return {
    cells: [
      {
        namespace: "payments",
        environment: "staging",
        filePath: "/repo/payments/staging.enc.yaml",
        missingKeys: ["WEBHOOK_SECRET"],
        isProtected: false,
      },
      {
        namespace: "payments",
        environment: "production",
        filePath: "/repo/payments/production.enc.yaml",
        missingKeys: ["API_KEY", "WEBHOOK_SECRET"],
        isProtected: true,
      },
    ],
    totalKeys: 3,
    hasProtectedEnvs: true,
    ...overrides,
  };
}

function mockSyncResult(overrides = {}) {
  return {
    modifiedCells: ["payments/staging", "payments/production"],
    scaffoldedKeys: {
      "payments/staging": ["WEBHOOK_SECRET"],
      "payments/production": ["API_KEY", "WEBHOOK_SECRET"],
    },
    totalKeysScaffolded: 3,
    ...overrides,
  };
}

describe("clef sync", () => {
  let mockPlanFn: jest.Mock;
  let mockSyncFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFormatter.confirm.mockResolvedValue(true);

    mockPlanFn = jest.fn().mockResolvedValue(mockPlan());
    mockSyncFn = jest.fn().mockResolvedValue(mockSyncResult());
    MockSyncManager.mockImplementation(
      () => ({ plan: mockPlanFn, sync: mockSyncFn }) as unknown as SyncManager,
    );
  });

  it("passes namespace to SyncManager", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockPlanFn).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
      namespace: "payments",
    });
    expect(mockSyncFn).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
      namespace: "payments",
    });
  });

  it("passes undefined namespace with --all", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "--all"]);

    expect(mockPlanFn).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
      namespace: undefined,
    });
  });

  it("errors when neither namespace nor --all provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Provide a namespace"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("errors when both namespace and --all provided", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments", "--all"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot specify both"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows nothing to sync when plan has 0 keys", async () => {
    mockPlanFn.mockResolvedValue(mockPlan({ cells: [], totalKeys: 0, hasProtectedEnvs: false }));
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("fully in sync"));
    expect(mockSyncFn).not.toHaveBeenCalled();
  });

  it("shows dry-run preview without executing sync", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments", "--dry-run"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("without --dry-run"));
    expect(mockSyncFn).not.toHaveBeenCalled();
  });

  it("outputs JSON for dry-run with --json", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments", "--dry-run"]);

    expect(mockFormatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, totalKeys: 3 }),
    );
    expect(mockSyncFn).not.toHaveBeenCalled();
    isJsonMode.mockReturnValue(false);
  });

  it("prompts for confirmation when plan includes protected environments", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.confirm).toHaveBeenCalledWith(expect.stringContaining("protected"));
  });

  it("aborts when confirmation is denied", async () => {
    mockFormatter.confirm.mockResolvedValueOnce(false);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.info).toHaveBeenCalledWith("Aborted.");
    expect(mockSyncFn).not.toHaveBeenCalled();
  });

  it("skips confirmation when no protected environments", async () => {
    mockPlanFn.mockResolvedValue(mockPlan({ hasProtectedEnvs: false }));
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.confirm).not.toHaveBeenCalled();
    expect(mockSyncFn).toHaveBeenCalled();
  });

  it("shows summary on success", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("3 key(s)"));
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("clef set"));
  });

  it("outputs JSON on success with --json", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "sync", "payments"]);

    expect(mockFormatter.json).toHaveBeenCalledWith(
      expect.objectContaining({
        totalKeysScaffolded: 3,
        modifiedCells: ["payments/staging", "payments/production"],
      }),
    );
    isJsonMode.mockReturnValue(false);
  });
});
