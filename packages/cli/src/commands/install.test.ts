import * as fs from "fs";
import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { registerInstallCommand } from "./install";
import { formatter } from "../output/formatter";
import { RegistryIndex } from "../registry/client";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    hint: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    keyValue: jest.fn(),
    section: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const mockIndex: RegistryIndex = {
  version: 1,
  generatedAt: "2026-03-24T00:00:00.000Z",
  brokers: [
    {
      name: "rds-iam",
      version: "1.0.0",
      description: "Generate RDS IAM tokens",
      author: "clef-sh",
      provider: "aws",
      tier: 1,
      path: "aws/rds-iam",
      outputKeys: ["DB_TOKEN"],
    },
  ],
};

const brokerYaml = `name: rds-iam
version: 1.0.0
description: Generate RDS IAM tokens
author: clef-sh
license: MIT
provider: aws
tier: 1
inputs:
  - name: DB_ENDPOINT
    description: RDS endpoint
    secret: false
  - name: DB_PORT
    description: Database port
    secret: false
    default: "5432"
output:
  identity: rds-primary
  ttl: 900
  keys: [DB_TOKEN]
runtime:
  permissions:
    - rds-db:connect`;

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

function makeProgram(): Command {
  const program = new Command();
  program.option("--dir <path>");
  program.exitOverride();
  const runner = { run: jest.fn() } as unknown as SubprocessRunner;
  registerInstallCommand(program, { runner });
  return program;
}

describe("clef install", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined as unknown as string);
    mockFs.writeFileSync.mockReturnValue(undefined);
  });

  it("installs a broker successfully", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockIndex } as Response) // index
      .mockResolvedValueOnce({ ok: true, text: async () => brokerYaml } as Response) // broker.yaml
      .mockResolvedValueOnce({ ok: true, text: async () => "handler code" } as Response) // handler.ts
      .mockResolvedValueOnce({ ok: true, text: async () => "# README" } as Response); // README.md

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam"]);

    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
    expect(mockFormatter.keyValue).toHaveBeenCalledWith("  Name", "rds-iam");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockIndex } as Response) // index
      .mockResolvedValueOnce({ ok: true, text: async () => brokerYaml } as Response) // broker.yaml
      .mockResolvedValueOnce({ ok: true, text: async () => "handler code" } as Response) // handler.ts
      .mockResolvedValueOnce({ ok: true, text: async () => "# README" } as Response); // README.md

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.broker).toBe("rds-iam");
    expect(data.provider).toBe("aws");
    expect(data.tier).toBe(1);
    expect(data.files).toBeDefined();
    expect(data.files).toHaveLength(3);
    expect(mockExit).toHaveBeenCalledWith(0);

    isJsonMode.mockReturnValue(false);
  });

  it("exits 1 when broker not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIndex,
    } as Response);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "nonexistent"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam"]);

    expect(mockFormatter.error).toHaveBeenCalledWith("Network error");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("prompts when directory exists and respects cancellation", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIndex,
    } as Response);
    mockFs.existsSync.mockReturnValue(true);
    mockFormatter.confirm.mockResolvedValueOnce(false);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam"]);

    expect(mockFormatter.confirm).toHaveBeenCalled();
    expect(mockFormatter.info).toHaveBeenCalledWith("Installation cancelled.");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("skips prompt with --force", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockIndex } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => brokerYaml } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "handler code" } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "# README" } as Response);
    mockFs.existsSync.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam", "--force"]);

    expect(mockFormatter.confirm).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3);
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("prints input summary with defaults", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockIndex } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => brokerYaml } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "handler" } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "# README" } as Response);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "install", "rds-iam"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("DB_ENDPOINT"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("(required)"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("default: 5432"));
  });
});
