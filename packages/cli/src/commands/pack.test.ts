import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerPackCommand } from "./pack";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";

jest.mock("fs");
jest.mock("../output/formatter", () => ({
  formatter: {
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
}));

// Mock age-encryption
jest.mock(
  "age-encryption",
  () => ({
    Encrypter: jest.fn().mockImplementation(() => ({
      addRecipient: jest.fn(),
      encrypt: jest
        .fn()
        .mockResolvedValue(
          "-----BEGIN AGE ENCRYPTED FILE-----\nencrypted\n-----END AGE ENCRYPTED FILE-----",
        ),
    })),
  }),
  { virtual: true },
);

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

const sopsFileContent = YAML.stringify({
  sops: {
    age: [{ recipient: "age1abc" }],
    lastmodified: "2024-01-15T00:00:00Z",
  },
});

function makeRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        return {
          stdout: YAML.stringify({ DATABASE_URL: "postgres://localhost", API_KEY: "sk-123" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (cmd === "cat") {
        return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

function makeProgram(runner: SubprocessRunner): Command {
  const program = new Command();
  program.option("--dir <path>", "Path to a local Clef repository root");
  program.exitOverride();
  registerPackCommand(program, { runner });
  return program;
}

describe("clef pack", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(manifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
  });

  it("should pack an artifact and print success", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "dev",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact packed"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("/tmp/artifact.json"));
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Revision"));
    expect(mockFormatter.warn).toHaveBeenCalledWith(expect.stringContaining("Do NOT commit"));
  });

  it("should write valid JSON artifact", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "dev",
      "--output",
      "/tmp/artifact.json",
    ]);

    const writeCall = mockFs.writeFileSync.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("artifact.json"),
    );
    expect(writeCall).toBeTruthy();
    if (writeCall) {
      const artifact = JSON.parse(String(writeCall[1]));
      expect(artifact.version).toBe(1);
      expect(artifact.identity).toBe("api-gateway");
      expect(artifact.environment).toBe("dev");
      expect(artifact.ciphertext).toContain("BEGIN AGE ENCRYPTED FILE");
      expect(artifact.keys).toEqual(expect.arrayContaining(["DATABASE_URL", "API_KEY"]));
    }
  });

  it("should not contain plaintext values in artifact", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "dev",
      "--output",
      "/tmp/artifact.json",
    ]);

    const writeCall = mockFs.writeFileSync.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("artifact.json"),
    );
    if (writeCall) {
      const content = String(writeCall[1]);
      expect(content).not.toContain("postgres://localhost");
      expect(content).not.toContain("sk-123");
    }
  });

  it("should error when identity not found", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "nonexistent",
      "dev",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should error when environment not found on identity", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "staging",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use --dir for manifest lookup", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "--dir",
      "/custom/repo",
      "pack",
      "api-gateway",
      "dev",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("/custom/repo/clef.yaml"),
      "utf-8",
    );
  });
});
