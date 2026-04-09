import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerRevokeCommand } from "./revoke";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
    json: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    print: jest.fn(),
    raw: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
    secretPrompt: jest.fn().mockResolvedValue("secret"),
    formatDependencyError: jest.fn(),
    hint: jest.fn(),
    failure: jest.fn(),
    section: jest.fn(),
  },
  isJsonMode: jest.fn().mockReturnValue(false),
  setJsonMode: jest.fn(),
  setYesMode: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const manifestYaml = YAML.stringify({
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod" },
  ],
  namespaces: [{ name: "api", description: "API" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
  service_identities: [
    {
      name: "api-gateway",
      description: "API gateway",
      namespaces: ["api"],
      environments: {
        dev: { recipient: "age1devkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        production: { recipient: "age1prdkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      },
    },
  ],
});

function makeRunner(): SubprocessRunner {
  return { run: jest.fn() };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerRevokeCommand(program, { runner });
  return program;
}

describe("clef revoke", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(manifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
  });

  it("should overwrite the artifact with a revocation marker", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "api-gateway", "production"]);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".clef/packed/api-gateway"),
      { recursive: true },
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("production.age.json"),
      expect.stringContaining('"revokedAt"'),
      "utf-8",
    );
    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact revoked"));
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "api-gateway", "production"]);

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.identity).toBe("api-gateway");
    expect(data.environment).toBe("production");
    expect(data.revokedAt).toBeTruthy();
    expect(data.markerPath).toContain("production.age.json");

    isJsonMode.mockReturnValue(false);
  });

  it("should include version, identity, environment, and revokedAt in revoked artifact", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "api-gateway", "dev"]);

    const writeCall = mockFs.writeFileSync.mock.calls[0];
    const revoked = JSON.parse(String(writeCall[1]));
    expect(revoked.version).toBe(1);
    expect(revoked.identity).toBe("api-gateway");
    expect(revoked.environment).toBe("dev");
    expect(revoked.revokedAt).toBeTruthy();
  });

  it("should print next-steps for both VCS and HTTP flows", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "api-gateway", "production"]);

    // VCS flow
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("fetches artifacts from git"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("git add"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("git commit"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("git push"));

    // HTTP flow
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("fetches artifacts via HTTP"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Upload"));
  });

  it("should error when identity not found", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "nonexistent", "production"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when environment not found on identity", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync(["node", "clef", "revoke", "api-gateway", "staging"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
