import { Command } from "commander";
import { registerCloudCommands, type CloudCliDeps } from "./cloud";

jest.mock("../credentials", () => ({
  readCloudCredentials: jest.fn().mockReturnValue(null),
  writeCloudCredentials: jest.fn(),
  deleteCloudCredentials: jest.fn(),
  isSessionExpired: jest.fn().mockReturnValue(false),
}));

jest.mock("../providers", () => {
  const provider = {
    id: "github" as const,
    displayName: "GitHub",
    login: jest.fn().mockResolvedValue(null),
  };
  return {
    resolveAuthProvider: jest.fn().mockReturnValue(provider),
    DEFAULT_PROVIDER: "github",
    PROVIDER_IDS: ["github"],
    __mockProvider: provider,
  };
});

jest.mock("../cloud-api", () => ({
  startInstall: jest.fn().mockResolvedValue({
    install_url: "https://github.com/apps/clef-bot/installations/new?state=tok",
    state: "tok",
    expires_in: 600,
  }),
  pollInstallUntilComplete: jest.fn().mockResolvedValue({
    status: "complete",
    installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
  }),
  getMe: jest.fn().mockResolvedValue({
    user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
    installation: null,
    subscription: { tier: "free", status: "active" },
  }),
}));

jest.mock("../policy", () => ({
  POLICY_FILE_PATH: ".clef/policy.yaml",
  scaffoldPolicyFile: jest
    .fn()
    .mockReturnValue({ created: true, filePath: "/repo/.clef/policy.yaml" }),
  parsePolicyFile: jest
    .fn()
    .mockReturnValue({ valid: false, reason: "Could not read file: ENOENT" }),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
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
  program.option("--dir <path>", "Path to repo root").allowUnknownOption();
  const runner = {
    run: jest.fn().mockResolvedValue({
      stdout: "git@github.com:acme/payments.git\n",
      stderr: "",
      exitCode: 0,
    }),
  };
  const deps: CloudCliDeps = {
    runner,
    formatter: mockFormatter,
    sym: (name: string) =>
      name === "success" ? "\u2713" : name === "clef" ? "\uD834\uDD1E" : name,
    openBrowser: jest.fn().mockResolvedValue(true),
    cliVersion: "0.1.0-test",
  };
  registerCloudCommands(program, deps);
  return { program, runner, deps };
}

function getMockProvider() {
  return (jest.requireMock("../providers") as { __mockProvider: { login: jest.Mock } })
    .__mockProvider;
}

function getCredsMock() {
  return jest.requireMock("../credentials") as {
    readCloudCredentials: jest.Mock;
    writeCloudCredentials: jest.Mock;
    deleteCloudCredentials: jest.Mock;
    isSessionExpired: jest.Mock;
  };
}

function getCloudApiMock() {
  return jest.requireMock("../cloud-api") as {
    startInstall: jest.Mock;
    pollInstallUntilComplete: jest.Mock;
    getMe: jest.Mock;
  };
}

function getPolicyMock() {
  return jest.requireMock("../policy") as {
    scaffoldPolicyFile: jest.Mock;
    parsePolicyFile: jest.Mock;
  };
}

function getFsMock() {
  return jest.requireMock("fs") as { existsSync: jest.Mock };
}

const validCreds = {
  session_token: "jwt_abc",
  login: "jamesspears",
  email: "james@clef.sh",
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  base_url: "https://cloud.clef.sh",
  provider: "github" as const,
};

// ── clef cloud login ──────────────────────────────────────────────────────

describe("clef cloud login", () => {
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
    getCredsMock().readCloudCredentials.mockReturnValue(null);
    getCredsMock().isSessionExpired.mockReturnValue(false);
    getCredsMock().writeCloudCredentials.mockImplementation(() => {});
  });

  it("writes credentials on successful login", async () => {
    getMockProvider().login.mockResolvedValueOnce(validCreds);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(getCredsMock().writeCloudCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ session_token: "jwt_abc" }),
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("jamesspears"));
  });

  it("exits with error when provider login returns null", async () => {
    getMockProvider().login.mockResolvedValueOnce(null);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows already signed in when credentials are valid", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "login"]);

    expect(getMockProvider().login).not.toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Already signed in"),
    );
  });
});

// ── clef cloud logout ─────────────────────────────────────────────────────

describe("clef cloud logout", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes credentials and prints success", async () => {
    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "logout"]);

    expect(getCredsMock().deleteCloudCredentials).toHaveBeenCalled();
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Logged out"));
  });
});

// ── clef cloud status ─────────────────────────────────────────────────────

describe("clef cloud status", () => {
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
    getCredsMock().isSessionExpired.mockReturnValue(false);
  });

  it("shows account info when logged in with installation", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCloudApiMock().getMe.mockResolvedValueOnce({
      user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
      installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
      subscription: { tier: "free", status: "active" },
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("jamesspears"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("acme"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("free"));
  });

  it("shows not logged in when no credentials", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(null);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("Not logged in"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("shows expired when session is expired", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCredsMock().isSessionExpired.mockReturnValue(true);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "status"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ── clef cloud init ───────────────────────────────────────────────────────

describe("clef cloud init", () => {
  const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
    // Default: clef.yaml exists, no policy file, no credentials
    getFsMock().existsSync.mockReturnValue(true);
    getPolicyMock().parsePolicyFile.mockReturnValue({
      valid: false,
      reason: "Could not read file: ENOENT",
    });
    getPolicyMock().scaffoldPolicyFile.mockReturnValue({
      created: true,
      filePath: "/repo/.clef/policy.yaml",
    });
    getCredsMock().readCloudCredentials.mockReturnValue(null);
    getCredsMock().isSessionExpired.mockReturnValue(false);
    getCredsMock().writeCloudCredentials.mockImplementation(() => {});
    getCloudApiMock().getMe.mockResolvedValue({
      user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
      installation: null,
      subscription: { tier: "free", status: "active" },
    });
  });

  it("errors when clef.yaml is missing", async () => {
    getFsMock().existsSync.mockReturnValue(false);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("No clef.yaml found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("runs full init flow: auth, install, scaffold", async () => {
    getMockProvider().login.mockResolvedValueOnce(validCreds);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    // Auth happened via provider
    expect(getMockProvider().login).toHaveBeenCalled();
    expect(getCredsMock().writeCloudCredentials).toHaveBeenCalled();

    // Install flow ran
    expect(getCloudApiMock().startInstall).toHaveBeenCalled();
    expect(getCloudApiMock().pollInstallUntilComplete).toHaveBeenCalled();

    // Policy scaffolded
    expect(getPolicyMock().scaffoldPolicyFile).toHaveBeenCalled();

    // Next steps printed
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Next steps"));
  });

  it("uses provider displayName in init banner", async () => {
    getMockProvider().login.mockResolvedValueOnce(validCreds);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("GitHub"));
  });

  it("skips install when bot already installed", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCloudApiMock().getMe.mockResolvedValueOnce({
      user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
      installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
      subscription: { tier: "free", status: "active" },
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("already installed"),
    );
    expect(getCloudApiMock().startInstall).not.toHaveBeenCalled();
  });

  it("skips policy scaffold when policy already valid", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCloudApiMock().getMe.mockResolvedValueOnce({
      user: { id: "u1", login: "jamesspears", email: "james@clef.sh" },
      installation: { id: 12345678, account: "acme", installedAt: 1712847600000 },
      subscription: { tier: "free", status: "active" },
    });
    getPolicyMock().parsePolicyFile.mockReturnValue({ valid: true });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(getPolicyMock().scaffoldPolicyFile).not.toHaveBeenCalled();
  });

  it("handles install timeout", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCloudApiMock().pollInstallUntilComplete.mockResolvedValueOnce({
      status: "pending",
    });

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "init"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("timed out"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ── clef cloud doctor ─────────────────────────────────────────────────────

describe("clef cloud doctor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFsMock().existsSync.mockReturnValue(true);
    getPolicyMock().parsePolicyFile.mockReturnValue({ valid: true });
    getCredsMock().readCloudCredentials.mockReturnValue(validCreds);
    getCredsMock().isSessionExpired.mockReturnValue(false);
    getCredsMock().deleteCloudCredentials.mockImplementation(() => {});
  });

  it("reports all green when everything is configured", async () => {
    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "doctor"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("Everything looks good"),
    );
  });

  it("reports issues when not logged in", async () => {
    getCredsMock().readCloudCredentials.mockReturnValue(null);

    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "doctor"]);

    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Not logged in"));
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("clef cloud login"));
  });
});

// ── clef cloud upgrade ────────────────────────────────────────────────────

describe("clef cloud upgrade", () => {
  beforeEach(() => jest.clearAllMocks());

  it("prints not yet available", async () => {
    const { program } = makeProgram();
    await program.parseAsync(["node", "test", "cloud", "upgrade"]);

    expect(mockFormatter.info).toHaveBeenCalledWith(expect.stringContaining("not yet available"));
  });
});
