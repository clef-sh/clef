import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerPackCommand } from "./pack";
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
        return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
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
    expect(mockFormatter.hint).toHaveBeenCalledWith(expect.stringContaining("Upload the artifact"));
  });

  it("should output JSON with --json flag", async () => {
    const { isJsonMode } = jest.requireMock("../output/formatter") as {
      isJsonMode: jest.Mock;
    };
    isJsonMode.mockReturnValue(true);

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

    expect(mockFormatter.json).toHaveBeenCalled();
    const data = mockFormatter.json.mock.calls[0][0] as Record<string, unknown>;
    expect(data.identity).toBe("api-gateway");
    expect(data.environment).toBe("dev");
    expect(data.keyCount).toBeDefined();
    expect(data.namespaceCount).toBeDefined();
    expect(data.artifactSize).toBeDefined();
    expect(data.revision).toBeDefined();
    expect(data.output).toBe("/tmp/artifact.json");

    isJsonMode.mockReturnValue(false);
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
      // Ciphertext is base64-encoded
      expect(artifact.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(artifact.keys).toBeUndefined();
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

  it("should accept --backend json-envelope explicitly", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "dev",
      "--backend",
      "json-envelope",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact packed"));
    expect(mockFormatter.error).not.toHaveBeenCalled();
  });

  it("should accept --backend-opt key=value and succeed", async () => {
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
      "--backend-opt",
      "arbitrary=value",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact packed"));
    expect(mockFormatter.error).not.toHaveBeenCalled();
  });

  it("should accept multiple --backend-opt flags", async () => {
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
      "--backend-opt",
      "path=secret/app",
      "--backend-opt",
      "namespace=team-a",
      "--backend-opt",
      "mount=kv2",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact packed"));
    expect(mockFormatter.error).not.toHaveBeenCalled();
  });

  it("should error cleanly when --backend-opt is malformed", async () => {
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
      "--backend-opt",
      "missing-equals",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid --backend-opt format"),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should preserve '=' within --backend-opt values", async () => {
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
      "--backend-opt",
      "query=a=1&b=2",
    ]);

    expect(mockFormatter.success).toHaveBeenCalledWith(expect.stringContaining("Artifact packed"));
    expect(mockFormatter.error).not.toHaveBeenCalled();
  });

  it("should error cleanly when --backend is unknown", async () => {
    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "api-gateway",
      "dev",
      "--backend",
      "unknown-backend",
      "--output",
      "/tmp/artifact.json",
    ]);

    expect(mockFormatter.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown pack backend "unknown-backend"'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should produce artifact with envelope field for KMS identity", async () => {
    const kmsManifest = YAML.stringify({
      version: 1,
      environments: [{ name: "production", description: "Prod" }],
      namespaces: [{ name: "api", description: "API" }],
      sops: { default_backend: "age" },
      file_pattern: "{namespace}/{environment}.enc.yaml",
      service_identities: [
        {
          name: "kms-svc",
          description: "KMS identity",
          namespaces: ["api"],
          environments: {
            production: {
              kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:123456789012:key/abc" },
            },
          },
        },
      ],
    });
    mockFs.readFileSync.mockReturnValue(kmsManifest);

    // Mock the dynamic import of @clef-sh/runtime for createKmsProvider
    jest.mock(
      "@clef-sh/runtime",
      () => ({
        createKmsProvider: jest.fn().mockReturnValue({
          wrap: jest.fn().mockResolvedValue({
            wrappedKey: Buffer.from("wrapped-dek"),
            algorithm: "SYMMETRIC_DEFAULT",
          }),
          unwrap: jest.fn(),
        }),
      }),
      { virtual: true },
    );

    const runner = makeRunner();
    const program = makeProgram(runner);

    await program.parseAsync([
      "node",
      "clef",
      "pack",
      "kms-svc",
      "production",
      "--output",
      "/tmp/kms-artifact.json",
    ]);

    const writeCall = mockFs.writeFileSync.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("kms-artifact.json"),
    );
    expect(writeCall).toBeTruthy();
    const artifact = JSON.parse(String(writeCall![1]));
    expect(artifact.envelope).toBeDefined();
    expect(artifact.envelope.provider).toBe("aws");
    expect(artifact.envelope.keyId).toBe("arn:aws:kms:us-east-1:123456789012:key/abc");
    expect(artifact.envelope.wrappedKey).toBeTruthy();
    expect(artifact.envelope.iv).toBeTruthy();
    expect(artifact.envelope.authTag).toBeTruthy();
    expect(artifact.ciphertext).toBeTruthy();
  });
});
