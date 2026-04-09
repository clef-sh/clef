import { Command } from "commander";
import { registerDriftCommand } from "./drift";
import { formatter, isJsonMode } from "../output/formatter";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    DriftDetector: jest.fn().mockImplementation(() => ({
      detect: jest.fn().mockReturnValue({
        issues: [],
        namespacesCompared: 2,
        namespacesClean: 2,
        localEnvironments: ["dev", "staging"],
        remoteEnvironments: ["production"],
      }),
    })),
  };
});

jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
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
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFormatter = formatter as jest.Mocked<typeof formatter>;

function makeProgram() {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root").allowUnknownOption();
  const runner = { run: jest.fn() };
  registerDriftCommand(program, { runner });
  return { program, runner };
}

function getCoreMock() {
  return jest.requireMock("@clef-sh/core") as {
    DriftDetector: jest.MockedClass<{ new (): { detect: jest.Mock } }>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

async function runDrift(args: string[]): Promise<void> {
  const { program } = makeProgram();
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
  try {
    await program.parseAsync(["node", "clef", "drift", ...args]);
  } finally {
    exitSpy.mockRestore();
  }
}

describe("clef drift — no drift", () => {
  it("exits 0 and shows success message", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "drift", "/tmp/other-repo"]);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("No drift"));
    exitSpy.mockRestore();
  });
});

describe("clef drift — drift found", () => {
  beforeEach(() => {
    getCoreMock().DriftDetector.mockImplementation(
      () =>
        ({
          detect: jest.fn().mockReturnValue({
            issues: [
              {
                namespace: "database",
                key: "DB_PASS",
                presentIn: ["dev", "staging"],
                missingFrom: ["production"],
                message:
                  "Key 'DB_PASS' in namespace 'database' exists in [dev, staging] but is missing from [production]",
              },
            ],
            namespacesCompared: 2,
            namespacesClean: 1,
            localEnvironments: ["dev", "staging"],
            remoteEnvironments: ["production"],
          }),
        }) as unknown as { detect: jest.Mock },
    );
  });

  it("exits 1 when drift is found", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "drift", "/tmp/other-repo"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("prints drift details", async () => {
    await runDrift(["/tmp/other-repo"]);
    const allPrints = mockFormatter.print.mock.calls.map((c) => String(c[0]));
    expect(allPrints.some((s) => s.includes("DB_PASS"))).toBe(true);
    expect(allPrints.some((s) => s.includes("database"))).toBe(true);
  });
});

describe("clef drift --json", () => {
  it("outputs valid JSON with no drift", async () => {
    getCoreMock().DriftDetector.mockImplementation(
      () =>
        ({
          detect: jest.fn().mockReturnValue({
            issues: [],
            namespacesCompared: 2,
            namespacesClean: 2,
            localEnvironments: ["dev", "staging"],
            remoteEnvironments: ["production"],
          }),
        }) as unknown as { detect: jest.Mock },
    );
    (isJsonMode as jest.Mock).mockReturnValue(true);
    await runDrift(["/tmp/other-repo"]);
    (isJsonMode as jest.Mock).mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test assertion
    const parsed = mockFormatter.json.mock.calls[0][0] as any;
    expect(parsed).toHaveProperty("issues");
    expect(parsed).toHaveProperty("namespacesCompared", 2);
    expect(parsed).toHaveProperty("namespacesClean", 2);
    expect(parsed.issues).toHaveLength(0);
  });

  it("exits 1 when JSON output has drift issues", async () => {
    getCoreMock().DriftDetector.mockImplementation(
      () =>
        ({
          detect: jest.fn().mockReturnValue({
            issues: [
              {
                namespace: "database",
                key: "DB_PASS",
                presentIn: ["dev"],
                missingFrom: ["production"],
                message: "drift",
              },
            ],
            namespacesCompared: 1,
            namespacesClean: 0,
            localEnvironments: ["dev"],
            remoteEnvironments: ["production"],
          }),
        }) as unknown as { detect: jest.Mock },
    );

    (isJsonMode as jest.Mock).mockReturnValue(true);
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "drift", "/tmp/other-repo"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    (isJsonMode as jest.Mock).mockReturnValue(false);
  });
});

describe("clef drift — error handling", () => {
  it("exits 1 with error message when detector throws", async () => {
    getCoreMock().DriftDetector.mockImplementation(
      () =>
        ({
          detect: jest.fn().mockImplementation(() => {
            throw new Error("Could not read manifest file at '/bad/path/clef.yaml'");
          }),
        }) as unknown as { detect: jest.Mock },
    );

    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { program } = makeProgram();
    await program.parseAsync(["node", "clef", "drift", "/bad/path"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("clef.yaml"));
    exitSpy.mockRestore();
  });
});

describe("clef drift --namespace", () => {
  it("passes namespace filter to detector", async () => {
    const detectMock = jest.fn().mockReturnValue({
      issues: [],
      namespacesCompared: 1,
      namespacesClean: 1,
      localEnvironments: ["dev"],
      remoteEnvironments: ["production"],
    });
    getCoreMock().DriftDetector.mockImplementation(
      () => ({ detect: detectMock }) as unknown as { detect: jest.Mock },
    );

    await runDrift(["/tmp/other-repo", "--namespace", "database"]);
    expect(detectMock).toHaveBeenCalledWith(expect.any(String), expect.any(String), ["database"]);
  });
});

describe("clef drift — no shared namespaces", () => {
  it("shows warning when no shared namespaces", async () => {
    getCoreMock().DriftDetector.mockImplementation(
      () =>
        ({
          detect: jest.fn().mockReturnValue({
            issues: [],
            namespacesCompared: 0,
            namespacesClean: 0,
            localEnvironments: ["dev"],
            remoteEnvironments: ["production"],
          }),
        }) as unknown as { detect: jest.Mock },
    );

    await runDrift(["/tmp/other-repo"]);
    expect(mockFormatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("No shared namespaces"),
    );
  });
});
