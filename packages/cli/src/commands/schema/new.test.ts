import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { registerSchemaCommand } from "./index";
import { formatter } from "../../output/formatter";

jest.mock("fs");

const mockEditNamespace = jest.fn();
const mockManifestParse = jest.fn();
const mockWriteSchemaRaw = jest.fn();

jest.mock("../../age-credential", () => ({
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
    StructureManager: jest.fn().mockImplementation(() => ({ editNamespace: mockEditNamespace })),
    GitIntegration: jest.fn().mockImplementation(() => ({})),
    TransactionManager: jest.fn().mockImplementation(() => ({ run: jest.fn() })),
    writeSchemaRaw: (filePath: string, contents: string) => mockWriteSchemaRaw(filePath, contents),
  };
});

jest.mock("../../output/formatter", () => ({
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
const { isJsonMode } = jest.requireMock("../../output/formatter") as {
  isJsonMode: jest.Mock;
};

const manifestWith = (overrides: Partial<Record<string, unknown>> = {}) => ({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "auth", description: "Auth" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
  ...overrides,
});

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "repo root");
  program.exitOverride();
  registerSchemaCommand(program, { runner });
  return program;
}

function goodRunner(): SubprocessRunner {
  return { run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }) };
}

describe("clef schema new", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue(YAML.stringify(manifestWith()));
    mockManifestParse.mockReturnValue(manifestWith());
    mockEditNamespace.mockResolvedValue(undefined);
    isJsonMode.mockReturnValue(false);
  });

  it("scaffolds a schema, attaches it to the namespace, and reports both paths", async () => {
    const program = makeProgram(goodRunner());
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "new", "auth"]);

    expect(mockWriteSchemaRaw).toHaveBeenCalledTimes(1);
    const [writtenPath, contents] = mockWriteSchemaRaw.mock.calls[0];
    expect(writtenPath).toBe(path.resolve("/repo", "schemas/auth.yaml"));
    expect(contents).toMatch(/namespace 'auth'/);

    expect(mockEditNamespace).toHaveBeenCalledWith(
      "auth",
      { schema: "schemas/auth.yaml" },
      expect.anything(),
      "/repo",
    );

    const successMessages = mockFormatter.success.mock.calls.map((c) => c[0]);
    expect(successMessages[0]).toContain(path.resolve("/repo", "schemas/auth.yaml"));
    expect(successMessages[1]).toContain(path.join("/repo", "clef.yaml"));
    expect(successMessages[1]).toContain("'auth'");
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("clef ui"));
  });

  it("respects --path and normalises it to a repo-relative string", async () => {
    const program = makeProgram(goodRunner());
    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/repo",
      "schema",
      "new",
      "auth",
      "--path",
      "schemas/custom/auth.yaml",
    ]);

    expect(mockWriteSchemaRaw).toHaveBeenCalledWith(
      path.resolve("/repo", "schemas/custom/auth.yaml"),
      expect.any(String),
    );
    expect(mockEditNamespace).toHaveBeenCalledWith(
      "auth",
      { schema: "schemas/custom/auth.yaml" },
      expect.anything(),
      "/repo",
    );
  });

  it("writes the example template when --template example is passed", async () => {
    const program = makeProgram(goodRunner());
    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/repo",
      "schema",
      "new",
      "auth",
      "--template",
      "example",
    ]);

    const [, contents] = mockWriteSchemaRaw.mock.calls[0];
    expect(contents).toMatch(/#\s+API_KEY:/);
  });

  it("rejects an invalid --template value", async () => {
    const program = makeProgram(goodRunner());
    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/repo",
      "schema",
      "new",
      "auth",
      "--template",
      "fancy",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("--template"));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockWriteSchemaRaw).not.toHaveBeenCalled();
  });

  it("errors when the namespace does not exist", async () => {
    const program = makeProgram(goodRunner());
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "new", "missing"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("'missing' not found"),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockWriteSchemaRaw).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing schema file without --force", async () => {
    mockFs.existsSync.mockReturnValue(true);
    const program = makeProgram(goodRunner());
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "new", "auth"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("--force"));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockWriteSchemaRaw).not.toHaveBeenCalled();
  });

  it("refuses when the namespace already has a schema attachment without --force", async () => {
    mockManifestParse.mockReturnValue(
      manifestWith({
        namespaces: [{ name: "auth", description: "", schema: "schemas/auth.yaml" }],
      }),
    );
    const program = makeProgram(goodRunner());
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "new", "auth"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("already has schema"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("proceeds with --force even when both file and attachment exist", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockManifestParse.mockReturnValue(
      manifestWith({
        namespaces: [{ name: "auth", description: "", schema: "schemas/auth.yaml" }],
      }),
    );
    const program = makeProgram(goodRunner());
    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/repo",
      "schema",
      "new",
      "auth",
      "--force",
    ]);

    expect(mockWriteSchemaRaw).toHaveBeenCalledTimes(1);
    expect(mockEditNamespace).toHaveBeenCalledTimes(1);
  });

  it("emits structured JSON with schemaPath and manifestPath when --json is set", async () => {
    isJsonMode.mockReturnValue(true);
    const program = makeProgram(goodRunner());
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "new", "auth"]);

    expect(mockFormatter.json).toHaveBeenCalledWith({
      action: "created",
      kind: "schema",
      namespace: "auth",
      template: "empty",
      schemaPath: path.resolve("/repo", "schemas/auth.yaml"),
      manifestPath: path.join("/repo", "clef.yaml"),
    });
  });
});
