import * as fs from "fs";
import * as YAML from "yaml";
import { Command } from "commander";
import { registerServeCommand } from "./serve";
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
    Decrypter: jest.fn().mockImplementation(() => ({
      addIdentity: jest.fn(),
      decrypt: jest
        .fn()
        .mockResolvedValue(Buffer.from(JSON.stringify({ DB_HOST: "localhost", DB_PORT: "5432" }))),
    })),
  }),
  { virtual: true },
);

// Mock @clef-sh/runtime
jest.mock("@clef-sh/runtime", () => ({
  ArtifactDecryptor: jest.fn().mockImplementation(() => ({
    decrypt: jest.fn().mockResolvedValue({
      values: { DB_HOST: "localhost", DB_PORT: "5432" },
      keys: ["DB_HOST", "DB_PORT"],
      revision: "1711101600000-a1b2c3d4",
    }),
  })),
  SecretsCache: jest.fn().mockImplementation(() => ({
    swap: jest.fn(),
    wipe: jest.fn(),
    isReady: jest.fn().mockReturnValue(true),
    getAll: jest.fn().mockReturnValue({ DB_HOST: "localhost", DB_PORT: "5432" }),
    getKeys: jest.fn().mockReturnValue(["DB_HOST", "DB_PORT"]),
  })),
  createKmsProvider: jest.fn(),
}));

// Mock @clef-sh/agent
jest.mock("@clef-sh/agent", () => ({
  startAgentServer: jest.fn().mockResolvedValue({
    url: "http://127.0.0.1:7779",
    stop: jest.fn().mockResolvedValue(undefined),
    address: jest.fn(),
  }),
}));

// Mock keychain
jest.mock("../keychain", () => ({
  getKeychainKey: jest.fn().mockResolvedValue(null),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFormatter = formatter as jest.Mocked<typeof formatter>;
const mockExit = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

const manifestWithProtected = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
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
        production: {
          recipient: "age1prdkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    },
  ],
};

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
          stdout: YAML.stringify({ DB_HOST: "localhost", DB_PORT: "5432" }),
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

function setupManifest(manifest: object = manifestWithProtected) {
  mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readdirSync.mockReturnValue([]);
}

async function runServe(args: string[]) {
  const program = new Command();
  program.option("-d, --dir <path>", "Working directory");
  registerServeCommand(program, { runner: makeRunner() });
  await program.parseAsync(["node", "clef", "serve", ...args]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("clef serve", () => {
  it("rejects protected environments", async () => {
    setupManifest();
    await runServe(["--identity", "api-gateway", "--env", "production"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("protected"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects unknown environment", async () => {
    setupManifest();
    await runServe(["--identity", "api-gateway", "--env", "staging"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects unknown identity", async () => {
    setupManifest();
    await runServe(["--identity", "nonexistent", "--env", "dev"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("rejects invalid port", async () => {
    setupManifest();
    await runServe(["--identity", "api-gateway", "--env", "dev", "--port", "abc"]);

    expect(mockFormatter.error).toHaveBeenCalledWith(expect.stringContaining("--port"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("packs, decrypts, and starts server for valid input", async () => {
    setupManifest();

    // The command will block on SIGINT — we need to prevent that.
    // Override the Promise that blocks by immediately resolving.
    const originalOn = process.on.bind(process);
    const sigintHandler = jest.fn();
    jest.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        sigintHandler.mockImplementation(handler);
        setTimeout(() => sigintHandler(), 10);
        return process;
      }
      return originalOn(event, handler);
    }) as typeof process.on);

    await runServe(["--identity", "api-gateway", "--env", "dev"]);

    // Verify success output
    expect(mockFormatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Serving 2 secrets"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:7779/v1/secrets"),
    );
    expect(mockFormatter.print).toHaveBeenCalledWith(expect.stringContaining("Token:"));

    // Verify agent server was started
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startAgentServer } = require("@clef-sh/agent");
    expect(startAgentServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 7779,
        token: expect.any(String),
      }),
    );
  });

  it("respects --port option", async () => {
    setupManifest();

    const originalOn = process.on.bind(process);
    jest.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        setTimeout(() => handler(), 10);
        return process;
      }
      return originalOn(event, handler);
    }) as typeof process.on);

    await runServe(["--identity", "api-gateway", "--env", "dev", "--port", "8080"]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startAgentServer } = require("@clef-sh/agent");
    expect(startAgentServer).toHaveBeenCalledWith(expect.objectContaining({ port: 8080 }));
  });
});
