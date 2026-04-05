import { Command } from "commander";
import { registerCloudCommands, type CloudCliDeps } from "./cloud";

const mockParse = jest.fn();

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    ManifestParser: jest.fn().mockImplementation(() => ({
      parse: mockParse,
    })),
    MatrixManager: jest.fn().mockImplementation(() => ({
      resolveMatrix: jest.fn().mockReturnValue([]),
    })),
    readManifestYaml: jest.fn().mockReturnValue({
      version: 1,
      environments: [{ name: "production", description: "Prod" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    }),
    writeManifestYaml: jest.fn(),
  };
});

jest.mock("../index", () => ({
  readCloudCredentials: jest.fn().mockReturnValue(null),
  writeCloudCredentials: jest.fn(),
  resolveKeyservicePath: jest.fn().mockReturnValue({
    path: "clef-keyservice",
    source: "system",
  }),
  spawnKeyservice: jest.fn().mockResolvedValue({
    addr: "tcp://127.0.0.1:9999",
    kill: jest.fn().mockResolvedValue(undefined),
  }),
  initiateDeviceFlow: jest.fn().mockResolvedValue({
    sessionId: "sess_abc",
    loginUrl: "https://cloud.clef.sh/setup?session=sess_abc",
    pollUrl: "https://api.clef.sh/api/v1/device/poll/sess_abc",
    expiresIn: 900,
  }),
  pollDeviceFlow: jest.fn().mockResolvedValue({ status: "pending" }),
  CLOUD_DEFAULT_ENDPOINT: "https://api.clef.sh",
}));

const mockFormatter = {
  print: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  hint: jest.fn(),
};

function makeProgram() {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root").allowUnknownOption();
  const runner = { run: jest.fn() };
  const deps: CloudCliDeps = {
    runner,
    formatter: mockFormatter,
    sym: (name: string) =>
      name === "success" ? "\u2713" : name === "clef" ? "\uD834\uDD1E" : name,
    openBrowser: jest.fn().mockResolvedValue(true),
    createSopsClient: jest.fn().mockResolvedValue({
      decrypt: jest.fn().mockResolvedValue({ values: { KEY: "val" }, metadata: {} }),
      encrypt: jest.fn().mockResolvedValue(undefined),
    }),
    cliVersion: "0.1.0-test",
  };
  registerCloudCommands(program, deps);
  return { program, runner, deps };
}

function getCloudMock() {
  return jest.requireMock("../index") as {
    readCloudCredentials: jest.Mock;
    resolveKeyservicePath: jest.Mock;
    initiateDeviceFlow: jest.Mock;
    pollDeviceFlow: jest.Mock;
    writeCloudCredentials: jest.Mock;
  };
}

describe("clef cloud status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should show cloud config when manifest has cloud block", async () => {
    const cloud = getCloudMock();
    mockParse.mockReturnValue({
      version: 1,
      environments: [
        { name: "dev", description: "Dev" },
        { name: "production", description: "Prod", sops: { backend: "cloud" } },
      ],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
      cloud: { integrationId: "int_abc123", keyId: "clef:int_abc123/production" },
    });
    cloud.readCloudCredentials.mockReturnValue({
      token: "clef_tok_test",
      endpoint: "https://api.clef.sh",
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("int_abc123"));
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("clef:int_abc123/production"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("production"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("authenticated"));
  });

  it("should show not configured when no cloud block", async () => {
    mockParse.mockReturnValue({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("not configured"));
  });

  it("should show not authenticated when no credentials", async () => {
    const cloud = getCloudMock();
    mockParse.mockReturnValue({
      version: 1,
      environments: [{ name: "production", description: "Prod", sops: { backend: "cloud" } }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
      cloud: { integrationId: "int_abc123", keyId: "clef:int_abc123/production" },
    });
    cloud.readCloudCredentials.mockReturnValue(null);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("not authenticated"));
  });
});

describe("clef cloud login", () => {
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
  });

  it("should complete login flow and write credentials", async () => {
    const cloud = getCloudMock();
    cloud.pollDeviceFlow.mockResolvedValueOnce({ status: "complete", token: "clef_tok_new" });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(cloud.initiateDeviceFlow).toHaveBeenCalled();
    expect(cloud.writeCloudCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ token: "clef_tok_new" }),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Logged in"));
  });

  it("should handle expired session", async () => {
    const cloud = getCloudMock();
    cloud.pollDeviceFlow.mockResolvedValueOnce({ status: "expired" });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("expired"));
  });

  it("should handle cancelled session", async () => {
    const cloud = getCloudMock();
    cloud.pollDeviceFlow.mockResolvedValueOnce({ status: "cancelled" });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("cancelled"));
  });
});

describe("clef cloud init", () => {
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
    const cloud = getCloudMock();
    cloud.readCloudCredentials.mockReturnValue(null);
    cloud.resolveKeyservicePath.mockReturnValue({ path: "clef-keyservice", source: "system" });
  });

  it("should error when target environment not found", async () => {
    mockParse.mockReturnValue({
      version: 1,
      environments: [{ name: "dev", description: "Dev" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init", "--env", "production"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("should skip when environment already uses cloud", async () => {
    mockParse.mockReturnValue({
      version: 1,
      environments: [{ name: "production", description: "Prod", sops: { backend: "cloud" } }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
      cloud: { integrationId: "int_abc", keyId: "clef:int_abc/production" },
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init", "--env", "production"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("already using"));
  });

  it("should complete init flow with device flow for new environment", async () => {
    const manifest = {
      version: 1,
      environments: [{ name: "production", description: "Prod" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
    };
    mockParse.mockReturnValue(manifest);

    const cloud = getCloudMock();
    cloud.readCloudCredentials.mockReturnValue(null);
    cloud.pollDeviceFlow.mockResolvedValueOnce({
      status: "complete",
      token: "clef_tok_init",
      integrationId: "int_new",
      keyId: "clef:int_new/production",
    });

    const coreFull = jest.requireMock("@clef-sh/core") as {
      writeManifestYaml: jest.Mock;
    };

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init", "--env", "production"]);

    expect(cloud.writeCloudCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ token: "clef_tok_init" }),
    );
    expect(coreFull.writeManifestYaml).toHaveBeenCalled();
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("Cloud setup complete"),
    );
  });

  it("should skip device flow when already authenticated with cloud config", async () => {
    const manifest = {
      version: 1,
      environments: [{ name: "production", description: "Prod" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
      cloud: { integrationId: "int_existing", keyId: "clef:int_existing/production" },
    };
    mockParse.mockReturnValue(manifest);

    const cloud = getCloudMock();
    cloud.readCloudCredentials.mockReturnValue({
      token: "existing_token",
      endpoint: "https://api.clef.sh",
    });

    const coreFull = jest.requireMock("@clef-sh/core") as {
      writeManifestYaml: jest.Mock;
    };

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init", "--env", "production"]);

    expect(cloud.initiateDeviceFlow).not.toHaveBeenCalled();
    expect(coreFull.writeManifestYaml).toHaveBeenCalled();
  });
});
