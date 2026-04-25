import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import { SubprocessRunner, NamespaceSchema } from "@clef-sh/core";
import { registerSchemaCommand } from "./index";
import { formatter } from "../../output/formatter";

jest.mock("fs");

const mockManifestParse = jest.fn();
const mockLoadSchema = jest.fn();

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
    SchemaValidator: jest.fn().mockImplementation(() => ({ loadSchema: mockLoadSchema })),
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

function manifest(schemaPath?: string) {
  return {
    version: 1,
    environments: [{ name: "dev", description: "" }],
    namespaces: [{ name: "auth", description: "", ...(schemaPath ? { schema: schemaPath } : {}) }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

function makeProgram(): Command {
  const runner: SubprocessRunner = {
    run: jest.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
  const program = new Command();
  program.option("--dir <path>", "repo root");
  program.exitOverride();
  registerSchemaCommand(program, { runner });
  return program;
}

const populatedSchema: NamespaceSchema = {
  keys: {
    API_KEY: {
      type: "string",
      required: true,
      pattern: "^sk_",
      description: "Stripe key",
    },
    FLAG: { type: "boolean", required: false },
  },
};

describe("clef schema show", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest("schemas/auth.yaml")));
    isJsonMode.mockReturnValue(false);
  });

  it("prints a hint when the namespace has no attached schema", async () => {
    mockManifestParse.mockReturnValue(manifest()); // no schema
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("no schema attached"));
    expect(mockFormatter.hint).toHaveBeenCalledWith(
      expect.stringContaining("clef schema new auth"),
    );
  });

  it("errors when the namespace does not exist", async () => {
    mockManifestParse.mockReturnValue(manifest());
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "ghost"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("'ghost' not found"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("errors when the attached schema file is missing on disk", async () => {
    mockManifestParse.mockReturnValue(manifest("schemas/auth.yaml"));
    mockFs.existsSync.mockReturnValue(false);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("renders a human-readable table for a populated schema", async () => {
    mockManifestParse.mockReturnValue(manifest("schemas/auth.yaml"));
    mockLoadSchema.mockReturnValue(populatedSchema);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockLoadSchema).toHaveBeenCalledWith(path.resolve("/repo", "schemas/auth.yaml"));
    const printed = mockFormatter.print.mock.calls.map((c) => c[0]);
    expect(printed[0]).toBe("auth (schemas/auth.yaml)");
    expect(printed.some((line) => line.includes("API_KEY") && line.includes("required"))).toBe(
      true,
    );
    expect(printed.some((line) => line.includes("pattern: ^sk_"))).toBe(true);
    expect(printed.some((line) => line.includes("FLAG") && line.includes("optional"))).toBe(true);
  });

  it("hints when the attached schema has zero keys", async () => {
    mockManifestParse.mockReturnValue(manifest("schemas/auth.yaml"));
    mockLoadSchema.mockReturnValue({ keys: {} });
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("no keys declared"));
  });

  it("emits { namespace, path: null, keys: {} } when no schema is attached and --json is set", async () => {
    mockManifestParse.mockReturnValue(manifest());
    isJsonMode.mockReturnValue(true);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockFormatter.json).toHaveBeenCalledWith({
      namespace: "auth",
      path: null,
      keys: {},
    });
  });

  it("emits the loaded schema in JSON mode when attached", async () => {
    mockManifestParse.mockReturnValue(manifest("schemas/auth.yaml"));
    mockLoadSchema.mockReturnValue(populatedSchema);
    isJsonMode.mockReturnValue(true);
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "--dir", "/repo", "schema", "show", "auth"]);

    expect(mockFormatter.json).toHaveBeenCalledWith({
      namespace: "auth",
      path: path.resolve("/repo", "schemas/auth.yaml"),
      keys: populatedSchema.keys,
    });
  });
});
