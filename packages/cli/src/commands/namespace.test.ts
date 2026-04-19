import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerNamespaceCommand } from "./namespace";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");

const mockEditNamespace = jest.fn();
const mockAddNamespace = jest.fn();
const mockRemoveNamespace = jest.fn();
const mockManifestParse = jest.fn();

jest.mock("../age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({
    client: {},
    cleanup: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({ parse: mockManifestParse })),
    MatrixManager: jest.fn().mockImplementation(() => ({})),
    StructureManager: jest.fn().mockImplementation(() => ({
      editNamespace: mockEditNamespace,
      addNamespace: mockAddNamespace,
      removeNamespace: mockRemoveNamespace,
    })),
    GitIntegration: jest.fn().mockImplementation(() => ({})),
    TransactionManager: jest.fn().mockImplementation(() => ({ run: jest.fn() })),
  };
});

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
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "payments", description: "Payments" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerNamespaceCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

describe("clef namespace edit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockEditNamespace.mockResolvedValue(undefined);
    mockAddNamespace.mockResolvedValue(undefined);
    mockRemoveNamespace.mockResolvedValue(undefined);
  });

  it("renames a namespace and reports success", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "edit",
      "payments",
      "--rename",
      "billing",
    ]);

    expect(mockEditNamespace).toHaveBeenCalledWith(
      "payments",
      expect.objectContaining({ rename: "billing" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Renamed namespace 'payments' → 'billing'"),
    );
  });

  it("updates a description", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "edit",
      "payments",
      "--description",
      "Payment processing secrets",
    ]);

    expect(mockEditNamespace).toHaveBeenCalledWith(
      "payments",
      expect.objectContaining({ description: "Payment processing secrets" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Updated description on namespace 'payments'"),
    );
  });

  it("sets a schema path", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "edit",
      "payments",
      "--schema",
      "schemas/payments.yaml",
    ]);

    expect(mockEditNamespace).toHaveBeenCalledWith(
      "payments",
      expect.objectContaining({ schema: "schemas/payments.yaml" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Set schema on namespace 'payments'"),
    );
  });

  it("clears a schema with empty string", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "edit", "payments", "--schema", ""]);

    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Cleared schema on namespace 'payments'"),
    );
  });

  it("errors with exit 2 when no edit flags are passed", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "edit", "payments"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Nothing to edit"));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockEditNamespace).not.toHaveBeenCalled();
  });

  it("outputs JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "edit",
      "payments",
      "--rename",
      "billing",
    ]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.action).toBe("edited");
    expect(data.kind).toBe("namespace");
    expect(data.name).toBe("billing");
    expect(data.previousName).toBe("payments");

    isJsonMode.mockReturnValue(false);
  });

  it("supports the 'ns' alias", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "ns", "edit", "payments", "--rename", "billing"]);

    expect(mockEditNamespace).toHaveBeenCalled();
  });

  it("propagates StructureManager errors via handleCommandError", async () => {
    mockEditNamespace.mockRejectedValueOnce(new Error("Namespace 'foo' not found"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "edit", "foo", "--rename", "bar"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Namespace 'foo' not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("clef namespace add", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockAddNamespace.mockResolvedValue(undefined);
  });

  it("adds a new namespace and reports the cell scaffold count", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "add",
      "billing",
      "--description",
      "Billing secrets",
    ]);

    expect(mockAddNamespace).toHaveBeenCalledWith(
      "billing",
      expect.objectContaining({ description: "Billing secrets" }),
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Added namespace 'billing'"),
    );
  });

  it("forwards a schema path", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync([
      "node",
      "clef",
      "namespace",
      "add",
      "billing",
      "--schema",
      "schemas/billing.yaml",
    ]);

    expect(mockAddNamespace).toHaveBeenCalledWith(
      "billing",
      expect.objectContaining({ schema: "schemas/billing.yaml" }),
      expect.any(Object),
      expect.any(String),
    );
  });

  it("outputs JSON with --json flag including cellsScaffolded", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as { isJsonMode: jest.Mock };
    isJsonMode.mockReturnValue(true);
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "add", "billing"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.action).toBe("added");
    expect(data.kind).toBe("namespace");
    expect(data.name).toBe("billing");
    // baseManifest has 1 env, so 1 cell scaffolded
    expect(data.cellsScaffolded).toBe(1);

    isJsonMode.mockReturnValue(false);
  });

  it("propagates StructureManager errors via handleCommandError", async () => {
    mockAddNamespace.mockRejectedValueOnce(new Error("Namespace 'billing' already exists"));
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "add", "billing"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Namespace 'billing' already exists"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("clef namespace remove", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockManifestParse.mockReturnValue(YAML.parse(validManifestYaml));
    mockRemoveNamespace.mockResolvedValue(undefined);
  });

  it("prompts for confirmation by default and removes on yes", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    realFormatter.confirm.mockResolvedValueOnce(true);

    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "remove", "payments"]);

    expect(realFormatter.confirm).toHaveBeenCalled();
    expect(mockRemoveNamespace).toHaveBeenCalledWith(
      "payments",
      expect.any(Object),
      expect.any(String),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Removed namespace 'payments'"),
    );
  });

  it("aborts when the user declines confirmation", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    realFormatter.confirm.mockResolvedValueOnce(false);

    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "remove", "payments"]);

    expect(mockRemoveNamespace).not.toHaveBeenCalled();
    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("Aborted"));
  });

  it("skips the prompt with --yes", async () => {
    const { formatter: realFormatter } = jest.requireMock("../output/formatter") as {
      formatter: { confirm: jest.Mock };
    };
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "remove", "payments", "--yes"]);

    expect(realFormatter.confirm).not.toHaveBeenCalled();
    expect(mockRemoveNamespace).toHaveBeenCalled();
  });

  it("supports the rm alias", async () => {
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "rm", "payments", "--yes"]);

    expect(mockRemoveNamespace).toHaveBeenCalled();
  });

  it("propagates StructureManager errors via handleCommandError", async () => {
    mockRemoveNamespace.mockRejectedValueOnce(
      new Error(
        "Cannot remove namespace 'payments': it is the only scope of service identity 'web-app'",
      ),
    );
    const program = makeProgram(goodRunner());

    await program.parseAsync(["node", "clef", "namespace", "remove", "payments", "--yes"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("only scope of service identity 'web-app'"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
