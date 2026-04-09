import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { registerSearchCommand } from "./search";
import { formatter } from "../output/formatter";
import { RegistryIndex } from "../registry/client";

jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

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
    {
      name: "sts-assume-role",
      version: "1.0.0",
      description: "Generate temporary AWS credentials",
      author: "clef-sh",
      provider: "aws",
      tier: 1,
      path: "aws/sts-assume-role",
      outputKeys: ["AWS_ACCESS_KEY_ID"],
    },
    {
      name: "sql-database",
      version: "1.0.0",
      description: "Dynamic SQL credentials",
      author: "clef-sh",
      provider: "agnostic",
      tier: 2,
      path: "agnostic/sql-database",
      outputKeys: ["DB_USER", "DB_PASSWORD"],
    },
  ],
};

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

function makeProgram(): Command {
  const program = new Command();
  program.option("--dir <path>");
  program.exitOverride();
  const runner = { run: jest.fn() } as unknown as SubprocessRunner;
  registerSearchCommand(program, { runner });
  return program;
}

describe("clef search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockIndex,
    } as Response);
  });

  it("lists all brokers when no query", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("3 brokers available"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("rds-iam"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("sts-assume-role"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("sql-database"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(3);
    expect(data[0].name).toBe("rds-iam");
    expect(data[1].name).toBe("sts-assume-role");
    expect(data[2].name).toBe("sql-database");
    expect(mockExit).toHaveBeenCalledWith(0);

    isJsonMode.mockReturnValue(false);
  });

  it("filters by text query", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search", "rds"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("1 broker found"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("rds-iam"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("filters by provider", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search", "--provider", "aws"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("2 brokers found"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("filters by tier", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search", "--tier", "2"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("1 broker found"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("sql-database"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("shows message when no results", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search", "nonexistent"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("No brokers found"));
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("exits 1 on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search"]);

    expect(mockFormatter.error).toHaveBeenCalledWith("Network error");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("combines query and provider filter", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "clef", "search", "credentials", "--provider", "aws"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("1 broker found"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("sts-assume-role"));
  });
});
