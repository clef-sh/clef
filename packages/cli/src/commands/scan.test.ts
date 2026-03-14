import { Command } from "commander";
import { registerScanCommand } from "./scan";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({
      parse: jest.fn().mockReturnValue({
        version: 1,
        environments: [{ name: "dev", description: "Dev" }],
        namespaces: [{ name: "database", description: "DB" }],
        sops: { default_backend: "age" },
        file_pattern: "{namespace}/{environment}.enc.yaml",
      }),
    })),
    ScanRunner: jest.fn().mockImplementation(() => ({
      scan: jest.fn().mockResolvedValue({
        matches: [],
        unencryptedMatrixFiles: [],
        filesScanned: 10,
        filesSkipped: 2,
        durationMs: 120,
      }),
    })),
  };
});

jest.mock("../output/formatter", () => ({
  formatter: {
    print: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    hint: jest.fn(),
    raw: jest.fn(),
    formatDependencyError: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
}));

const mockFormatter = formatter as jest.Mocked<typeof formatter>;

function makeProgram() {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root").allowUnknownOption();
  const runner = { run: jest.fn() };
  registerScanCommand(program, { runner });
  return { program, runner };
}

function getCoreMock() {
  return jest.requireMock("@clef-sh/core") as {
    ScanRunner: jest.MockedClass<{ new (): { scan: jest.Mock } }>;
    ManifestParser: jest.MockedClass<{ new (): { parse: jest.Mock } }>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

async function runScan(args: string[]): Promise<void> {
  const { program } = makeProgram();
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
  try {
    await program.parseAsync(["node", "clef", "scan", ...args]);
  } finally {
    exitSpy.mockRestore();
  }
}

describe("clef scan — clean repo", () => {
  it("exits 0 and prints no issues when scan returns clean", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "scan"]);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it("shows success message", async () => {
    await runScan([]);
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("No issues found"));
  });
});

describe("clef scan — unencrypted matrix file", () => {
  beforeEach(() => {
    getCoreMock().ScanRunner.mockImplementation(
      () =>
        ({
          scan: jest.fn().mockResolvedValue({
            matches: [],
            unencryptedMatrixFiles: ["database/dev.enc.yaml"],
            filesScanned: 5,
            filesSkipped: 1,
            durationMs: 80,
          }),
        }) as unknown as { scan: jest.Mock },
    );
  });

  it("exits 1 when unencrypted matrix file is found", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "scan"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("prints the file name and fix hint", async () => {
    await runScan([]);
    const allPrints = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    const hasFile = allPrints.some((s) => s.includes("database/dev.enc.yaml"));
    expect(hasFile).toBe(true);
  });
});

describe("clef scan — pattern match", () => {
  beforeEach(() => {
    getCoreMock().ScanRunner.mockImplementation(
      () =>
        ({
          scan: jest.fn().mockResolvedValue({
            matches: [
              {
                file: "src/config.ts",
                line: 5,
                column: 1,
                matchType: "pattern",
                patternName: "AWS access key",
                preview: "AKIA\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              },
            ],
            unencryptedMatrixFiles: [],
            filesScanned: 10,
            filesSkipped: 0,
            durationMs: 100,
          }),
        }) as unknown as { scan: jest.Mock },
    );
  });

  it("exits 1 for pattern match", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "scan"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("prints the pattern name and file location", async () => {
    await runScan([]);
    const allPrints = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    expect(allPrints.some((s) => s.includes("AWS access key"))).toBe(true);
    expect(allPrints.some((s) => s.includes("src/config.ts"))).toBe(true);
  });
});

describe("clef scan — entropy match", () => {
  beforeEach(() => {
    getCoreMock().ScanRunner.mockImplementation(
      () =>
        ({
          scan: jest.fn().mockResolvedValue({
            matches: [
              {
                file: ".env",
                line: 4,
                column: 1,
                matchType: "entropy",
                entropy: 5.2,
                preview: "DATABASE_PASSWORD=\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              },
            ],
            unencryptedMatrixFiles: [],
            filesScanned: 3,
            filesSkipped: 0,
            durationMs: 50,
          }),
        }) as unknown as { scan: jest.Mock },
    );
  });

  it("prints entropy value in the output", async () => {
    await runScan([]);
    const allPrints = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    expect(allPrints.some((s) => s.includes("entropy"))).toBe(true);
  });

  it("includes clef-ignore suppression hint for entropy matches", async () => {
    await runScan([]);
    const allPrints = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    expect(allPrints.some((s) => s.includes("clef-ignore"))).toBe(true);
  });
});

describe("clef scan --staged", () => {
  it("passes stagedOnly to ScanRunner", async () => {
    const scanMock = jest.fn().mockResolvedValue({
      matches: [],
      unencryptedMatrixFiles: [],
      filesScanned: 2,
      filesSkipped: 0,
      durationMs: 30,
    });
    getCoreMock().ScanRunner.mockImplementation(
      () => ({ scan: scanMock }) as unknown as { scan: jest.Mock },
    );

    await runScan(["--staged"]);
    expect(scanMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ stagedOnly: true }),
    );
  });
});

describe("clef scan --severity high", () => {
  it("passes severity: high to ScanRunner", async () => {
    const scanMock = jest.fn().mockResolvedValue({
      matches: [],
      unencryptedMatrixFiles: [],
      filesScanned: 5,
      filesSkipped: 0,
      durationMs: 40,
    });
    getCoreMock().ScanRunner.mockImplementation(
      () => ({ scan: scanMock }) as unknown as { scan: jest.Mock },
    );

    await runScan(["--severity", "high"]);
    expect(scanMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ severity: "high" }),
    );
  });
});

describe("clef scan --json", () => {
  it("outputs valid JSON including durationMs", async () => {
    getCoreMock().ScanRunner.mockImplementation(
      () =>
        ({
          scan: jest.fn().mockResolvedValue({
            matches: [],
            unencryptedMatrixFiles: [],
            filesScanned: 8,
            filesSkipped: 1,
            durationMs: 200,
          }),
        }) as unknown as { scan: jest.Mock },
    );

    await runScan(["--json"]);
    const rawCall = mockFormatter.raw.mock.calls[0][0] as string;
    const parsed = JSON.parse(rawCall);
    expect(parsed).toHaveProperty("matches");
    expect(parsed).toHaveProperty("durationMs", 200);
    expect(parsed).toHaveProperty("filesScanned", 8);
    expect(parsed).toHaveProperty("summary");
  });

  it("exits 1 when JSON output has issues", async () => {
    getCoreMock().ScanRunner.mockImplementation(
      () =>
        ({
          scan: jest.fn().mockResolvedValue({
            matches: [
              {
                file: "a.ts",
                line: 1,
                column: 1,
                matchType: "pattern",
                patternName: "Stripe live key",
                preview: "sk_l\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              },
            ],
            unencryptedMatrixFiles: [],
            filesScanned: 3,
            filesSkipped: 0,
            durationMs: 60,
          }),
        }) as unknown as { scan: jest.Mock },
    );

    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "scan", "--json"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("clef scan — manifest missing", () => {
  it("exits 2 when clef.yaml is not found", async () => {
    getCoreMock().ManifestParser.mockImplementation(
      () =>
        ({
          parse: jest.fn().mockImplementation(() => {
            const { ManifestValidationError } = jest.requireActual("@clef-sh/core");
            throw new ManifestValidationError("Could not read manifest: clef.yaml");
          }),
        }) as unknown as { parse: jest.Mock },
    );

    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "scan"]);
    expect(exitSpy).toHaveBeenCalledWith(2);
    exitSpy.mockRestore();
  });
});
