import * as fs from "fs";
import * as net from "net";
import { SopsClient } from "./client";
import {
  ClefError,
  ClefManifest,
  GitOperationError,
  ManifestValidationError,
  SchemaLoadError,
  SopsDecryptionError,
  SopsEncryptionError,
  SopsKeyNotFoundError,
  SopsMissingError,
  SopsVersionError,
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../types";
import writeFileAtomic from "write-file-atomic";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock("net", () => ({
  createServer: jest.fn(),
}));

// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

jest.mock("./resolver", () => ({
  resolveSopsPath: jest.fn().mockReturnValue({ path: "sops", source: "system" }),
  resetSopsResolution: jest.fn(),
}));

jest.mock("../dependencies/checker", () => ({
  assertSops: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../age/keygen", () => ({
  deriveAgePublicKey: jest.fn(),
}));

const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;
const mockWriteFileAtomic = writeFileAtomic as unknown as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- require() needed to access jest mock after jest.mock()
const { deriveAgePublicKey: mockDeriveAgePublicKey } = require("../age/keygen") as {
  deriveAgePublicKey: jest.Mock;
};

function mockRunner(responses: Record<string, SubprocessResult>): SubprocessRunner {
  return {
    run: jest.fn(async (command: string, args: string[]) => {
      const key = `${command} ${args[0]}`;
      // Try exact match first, then first-arg match
      if (responses[key]) return responses[key];
      // Try command-only match
      if (responses[command]) return responses[command];
      return { stdout: "", stderr: "Unknown command", exitCode: 1 };
    }),
  };
}

const sopsMetadataYaml = `DATABASE_URL: ENC[AES256_GCM,data:test=]
sops:
  age:
    - recipient: age1test123
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        testdata
        -----END AGE ENCRYPTED FILE-----
  lastmodified: "2024-01-15T10:30:00Z"
  mac: ENC[AES256_GCM,data:testmac=]
  version: 3.8.1`;

const decryptedYaml = `DATABASE_URL: postgres://localhost/mydb
DATABASE_POOL_SIZE: "10"
DATABASE_SSL: "true"`;

function testManifest(): ClefManifest {
  return {
    version: 1,
    environments: [{ name: "dev", description: "Dev" }],
    namespaces: [{ name: "database", description: "DB" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

describe("SopsClient", () => {
  beforeEach(() => {
    mockReadFileSync.mockReturnValue(sopsMetadataYaml);
    mockWriteFileSync.mockReturnValue(undefined);
    mockWriteFileAtomic.mockReset();
    mockWriteFileAtomic.mockResolvedValue(undefined);
    mockDeriveAgePublicKey.mockReset();
  });

  describe("decrypt", () => {
    it("should decrypt a file and return values and metadata", async () => {
      const runner = mockRunner({
        "sops decrypt": {
          stdout: decryptedYaml,
          stderr: "",
          exitCode: 0,
        },
        "sops filestatus": {
          stdout: '{"encrypted": true}',
          stderr: "",
          exitCode: 0,
        },
      });

      const client = new SopsClient(runner);
      const result = await client.decryptFile("database/dev.enc.yaml");

      expect(result.values).toEqual({
        DATABASE_URL: "postgres://localhost/mydb",
        DATABASE_POOL_SIZE: "10",
        DATABASE_SSL: "true",
      });
      expect(result.metadata.backend).toBe("age");
      expect(result.metadata.recipients).toEqual(["age1test123"]);
    });

    it("should throw SopsKeyNotFoundError when no age key is configured", async () => {
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "failed to get the data key", exitCode: 1 },
      });

      // No ageKey/ageKeyFile → classifyDecryptError short-circuits to key-not-found
      const client = new SopsClient(runner);
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsKeyNotFoundError,
      );
    });

    it("should throw SopsKeyNotFoundError when configured age key does not match file recipients", async () => {
      mockDeriveAgePublicKey.mockResolvedValue("age1differentkey456");
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "failed to decrypt", exitCode: 1 },
      });

      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1WRONGKEY");
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsKeyNotFoundError,
      );
    });

    it("should throw SopsKeyNotFoundError when ageKeyFile cannot be read", async () => {
      // First call returns metadata yaml; second call (key file) throws
      mockReadFileSync.mockReturnValueOnce(sopsMetadataYaml).mockImplementationOnce(() => {
        throw new Error("ENOENT: no such file or directory");
      });
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "failed", exitCode: 1 },
      });

      const client = new SopsClient(runner, "/nonexistent/key.txt");
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsKeyNotFoundError,
      );
    });

    it("should throw SopsKeyNotFoundError when ageKeyFile contains no valid age private keys", async () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if ((path as string).endsWith(".enc.yaml")) return sopsMetadataYaml;
        return "# created: 2024-01-01\n# public key: age1abc\n# (no private key line)";
      });
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "failed", exitCode: 1 },
      });

      const client = new SopsClient(runner, "/path/to/key.txt");
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsKeyNotFoundError,
      );
    });

    it("should throw SopsDecryptionError when age key matches a recipient but decrypt fails otherwise", async () => {
      mockDeriveAgePublicKey.mockResolvedValue("age1test123"); // matches sopsMetadataYaml recipient
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "Error: corrupt MAC", exitCode: 1 },
      });

      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1VALID");
      const err = await client.decryptFile("database/dev.enc.yaml").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SopsDecryptionError);
      expect(err).not.toBeInstanceOf(SopsKeyNotFoundError);
    });

    it("should throw SopsDecryptionError on failure for non-age backend", async () => {
      const kmsMetaYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  kms:
    - arn: arn:aws:kms:us-east-1:123:key/abc
      enc: testenc
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;
      mockReadFileSync.mockReturnValue(kmsMetaYaml);
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "Error: KMS access denied", exitCode: 1 },
      });

      const client = new SopsClient(runner);
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });

    it("should throw SopsDecryptionError when file metadata cannot be parsed on failure", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "Error", exitCode: 1 },
      });

      const client = new SopsClient(runner);
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });

    it("should throw SopsDecryptionError when key in multi-key file matches a recipient", async () => {
      mockDeriveAgePublicKey
        .mockResolvedValueOnce("age1wrong1") // first key does not match
        .mockResolvedValueOnce("age1test123"); // second key matches
      mockReadFileSync.mockImplementation((path: string) => {
        if ((path as string).endsWith(".enc.yaml")) return sopsMetadataYaml;
        return "AGE-SECRET-KEY-1FIRSTKEY\nAGE-SECRET-KEY-1SECONDKEY\n";
      });
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "Error: corrupt MAC", exitCode: 1 },
      });

      const client = new SopsClient(runner, "/path/to/key.txt");
      const err = await client.decryptFile("database/dev.enc.yaml").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SopsDecryptionError);
      expect(err).not.toBeInstanceOf(SopsKeyNotFoundError);
    });

    it("should handle empty YAML output (null parse) via ?? {} fallback", async () => {
      const runner = mockRunner({
        "sops decrypt": {
          stdout: "",
          stderr: "",
          exitCode: 0,
        },
        "sops filestatus": {
          stdout: '{"encrypted": true}',
          stderr: "",
          exitCode: 0,
        },
      });

      const client = new SopsClient(runner);
      const result = await client.decryptFile("database/dev.enc.yaml");

      expect(result.values).toEqual({});
      expect(result.metadata.backend).toBe("age");
    });

    it("should classify file-path decrypt as 'other' when age key derivation fails", async () => {
      // Targets classifyDecryptError's catch in the file-path code path.
      // Mirrors the blob-shaped test below; both branches must be exercised.
      mockDeriveAgePublicKey.mockRejectedValue(new Error("invalid key bytes"));
      const runner = mockRunner({
        "sops decrypt": {
          stdout: "",
          stderr: "auth failed",
          exitCode: 1,
        },
      });
      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1abc");
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });

    it("should throw SopsDecryptionError on invalid YAML output", async () => {
      const runner = mockRunner({
        "sops decrypt": {
          stdout: "{{invalid",
          stderr: "",
          exitCode: 0,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.decryptFile("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });
  });
});

describe("SopsClient — keyservice address wiring", () => {
  it("injects --enable-local-keyservice=false and --keyservice <addr> into decrypt", async () => {
    const runFn = jest.fn(async (command: string, _args: string[]) => {
      if (command === "sops") return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient(
      { run: runFn },
      undefined,
      undefined,
      undefined,
      "tcp://127.0.0.1:54321",
    );

    // Stub filestatus + parseMetadataFromFile via a fake encrypted file payload
    runFn.mockImplementation(async (command: string, args: string[]) => {
      if (command === "sops" && args[0] === "decrypt") {
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      }
      if (command === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    // We don't care about the metadata read failing — only the args we passed.
    await client.decryptFile("file.enc.yaml").catch(() => undefined);

    const decryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && (c[1] as string[])[0] === "decrypt",
    );
    expect(decryptCall![1]).toContain("--enable-local-keyservice=false");
    expect(decryptCall![1]).toContain("--keyservice");
    expect(decryptCall![1]).toContain("tcp://127.0.0.1:54321");
  });

  it("places --keyservice flags AFTER the subcommand (SOPS silently ignores them before)", async () => {
    const runFn = jest.fn(async (command: string, _args: string[]) => {
      if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient(
      { run: runFn },
      undefined,
      undefined,
      undefined,
      "tcp://127.0.0.1:54321",
    );

    const manifest: ClefManifest = {
      ...testManifest(),
      sops: { default_backend: "age", age: { recipients: ["age1abc"] } },
    };
    await client.encrypt(
      { KEY: "val" },
      { manifest: manifest, environment: undefined, format: "yaml" },
    );

    const encryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && (c[1] as string[]).includes("encrypt"),
    );
    const args = encryptCall![1] as string[];
    const encryptIdx = args.indexOf("encrypt");
    const keyserviceIdx = args.indexOf("--keyservice");
    expect(keyserviceIdx).toBeGreaterThan(encryptIdx);
  });

  it("emits NO --keyservice flags when no address is supplied", async () => {
    const runFn = jest.fn(async (command: string, _args: string[]) => {
      if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    const manifest: ClefManifest = {
      ...testManifest(),
      sops: { default_backend: "age", age: { recipients: ["age1abc"] } },
    };
    await client.encrypt(
      { KEY: "val" },
      { manifest: manifest, environment: undefined, format: "yaml" },
    );

    const encryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && (c[1] as string[]).includes("encrypt"),
    );
    expect(encryptCall![1]).not.toContain("--keyservice");
    expect(encryptCall![1]).not.toContain("--enable-local-keyservice=false");
  });
});

describe("SopsClient — HSM backend metadata", () => {
  // Reach into the private helpers via a thin surface. Avoids fragile
  // round-trips through encrypt/decrypt for what is pure parsing logic.
  function makeClient(): SopsClient {
    const noop = jest.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    return new SopsClient({ run: noop });
  }

  it("detectBackend classifies sops.kms entries with Clef HSM ARNs as 'hsm'", () => {
    const client = makeClient();
    const detect = (
      client as unknown as { detectBackend(s: Record<string, unknown>): string }
    ).detectBackend.bind(client);

    const sopsBlock = {
      kms: [
        {
          arn: "arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/cGtjczExOnNsb3Q9MA",
        },
      ],
    };
    expect(detect(sopsBlock)).toBe("hsm");
  });

  it("detectBackend still classifies real AWS KMS ARNs as 'awskms'", () => {
    const client = makeClient();
    const detect = (
      client as unknown as { detectBackend(s: Record<string, unknown>): string }
    ).detectBackend.bind(client);

    const sopsBlock = {
      kms: [{ arn: "arn:aws:kms:us-east-1:111122223333:key/abc-123" }],
    };
    expect(detect(sopsBlock)).toBe("awskms");
  });

  it("extractRecipients decodes Clef HSM ARNs back to pkcs11 URIs", () => {
    const client = makeClient();
    const extract = (
      client as unknown as {
        extractRecipients(s: Record<string, unknown>, b: string): string[];
      }
    ).extractRecipients.bind(client);

    const sopsBlock = {
      kms: [
        {
          arn: "arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/cGtjczExOnNsb3Q9MDtsYWJlbD1jbGVmLWRlay13cmFwcGVy",
        },
      ],
    };
    expect(extract(sopsBlock, "hsm")).toEqual(["pkcs11:slot=0;label=clef-dek-wrapper"]);
  });

  it("extractRecipients falls back to raw ARN when payload fails to decode", () => {
    // Defensive: a malformed Clef ARN should not crash extraction —
    // surface the raw value so policy/lint can flag it.
    const client = makeClient();
    const extract = (
      client as unknown as {
        extractRecipients(s: Record<string, unknown>, b: string): string[];
      }
    ).extractRecipients.bind(client);

    const malformed = {
      kms: [{ arn: "arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/AAAA" }],
    };
    expect(extract(malformed, "hsm")).toEqual([
      "arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/AAAA",
    ]);
  });
});

describe("JSON file format support", () => {
  it("should use yaml format flags for .enc.yaml files", async () => {
    const runFn = jest.fn(async (command: string, args: string[]) => {
      if (command === "sops" && args[0] === "decrypt") {
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      }
      if (command === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decryptFile("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "decrypt",
    );
    expect(decryptCall![1]).toContain("yaml");
  });

  it("should use json format flags for .enc.json files", async () => {
    const runFn = jest.fn(async (command: string, args: string[]) => {
      if (command === "sops" && args[0] === "decrypt") {
        return { stdout: '{"KEY": "value"}', stderr: "", exitCode: 0 };
      }
      if (command === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decryptFile("database/dev.enc.json");

    const decryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "decrypt",
    );
    expect(decryptCall![1]).toContain("json");
  });

  it("should use json format for encryptBlob with json format hint", async () => {
    const runFn = jest.fn(async (command: string, _args: string[]) => {
      if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.encrypt(
      { KEY: "val" },
      { manifest: testManifest(), environment: undefined, format: "json" },
    );

    const sopsCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && (c[1] as string[]).includes("encrypt"),
    );
    expect(sopsCall![1]).toContain("--input-type");
    expect(sopsCall![1]).toContain("json");
    expect(sopsCall![1]).toContain("--output-type");
  });
});

describe("dependency checks", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() is necessary to access the Jest mock after jest.mock()
  const { assertSops: mockAssertSops } = require("../dependencies/checker");

  afterEach(() => {
    mockAssertSops.mockResolvedValue(undefined);
  });

  it("should reject with SopsMissingError when sops is not installed", async () => {
    mockAssertSops.mockRejectedValueOnce(new SopsMissingError("brew install sops"));

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(client.decryptFile("file.enc.yaml")).rejects.toThrow(SopsMissingError);
  });

  it("encryptBlob should throw SopsMissingError when sops is missing", async () => {
    mockAssertSops.mockRejectedValueOnce(new SopsMissingError("brew install sops"));

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(
      client.encrypt(
        { K: "v" },
        { manifest: testManifest(), environment: undefined, format: "yaml" },
      ),
    ).rejects.toThrow(SopsMissingError);
  });

  it("should reject with SopsVersionError when sops is outdated", async () => {
    mockAssertSops.mockRejectedValueOnce(
      new SopsVersionError("3.7.2", "3.8.0", "brew upgrade sops"),
    );

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(client.decryptFile("file.enc.yaml")).rejects.toThrow(SopsVersionError);
  });
});

describe("buildSopsEnv (credential injection)", () => {
  it("should inject SOPS_AGE_KEY_FILE env when ageKeyFile param is set", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, "/custom/keys.txt");
    await client.decryptFile("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({ env: { SOPS_AGE_KEY_FILE: "/custom/keys.txt" } });
  });

  it("should inject SOPS_AGE_KEY env when ageKey param is set", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, undefined, "AGE-SECRET-KEY-1TEST");
    await client.decryptFile("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({ env: { SOPS_AGE_KEY: "AGE-SECRET-KEY-1TEST" } });
  });

  it("should inject both SOPS_AGE_KEY and SOPS_AGE_KEY_FILE when both params are set", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, "/custom/keys.txt", "AGE-SECRET-KEY-1TEST");
    await client.decryptFile("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({
      env: { SOPS_AGE_KEY: "AGE-SECRET-KEY-1TEST", SOPS_AGE_KEY_FILE: "/custom/keys.txt" },
    });
  });

  it("should not inject env when no params are set", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decryptFile("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({});
  });
});

describe("resolveBackendConfig", () => {
  // Import directly since it's a pure function
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() needed for inline import in test
  const { resolveBackendConfig } = require("../types");

  it("should return env override when present", () => {
    const manifest: ClefManifest = {
      ...testManifest(),
      environments: [
        {
          name: "production",
          description: "Prod",
          sops: { backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/prod" },
        },
      ],
    };

    const config = resolveBackendConfig(manifest, "production");
    expect(config.backend).toBe("awskms");
    expect(config.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/prod");
  });

  it("should fall back to global config when env has no override", () => {
    const manifest: ClefManifest = {
      ...testManifest(),
      sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/global" },
    };

    const config = resolveBackendConfig(manifest, "dev");
    expect(config.backend).toBe("awskms");
    expect(config.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/global");
  });

  it("should fall back to global config when environment name not found", () => {
    const manifest: ClefManifest = {
      ...testManifest(),
      sops: { default_backend: "pgp", pgp_fingerprint: "ABCD1234" },
    };

    const config = resolveBackendConfig(manifest, "nonexistent");
    expect(config.backend).toBe("pgp");
    expect(config.pgp_fingerprint).toBe("ABCD1234");
  });
});

// Typed error classes — exercising all constructor branches
describe("Error classes", () => {
  it("ClefError stores fix message", () => {
    const err = new ClefError("msg", "fix it");
    expect(err.message).toBe("msg");
    expect(err.fix).toBe("fix it");
    expect(err.name).toBe("ClefError");
  });

  it("ClefError works without fix", () => {
    const err = new ClefError("msg");
    expect(err.fix).toBeUndefined();
  });

  it("ManifestValidationError with field", () => {
    const err = new ManifestValidationError("bad", "version");
    expect(err.field).toBe("version");
    expect(err.fix).toContain("version");
  });

  it("ManifestValidationError without field", () => {
    const err = new ManifestValidationError("bad");
    expect(err.field).toBeUndefined();
    expect(err.fix).toBeUndefined();
  });

  it("SopsDecryptionError with filePath", () => {
    const err = new SopsDecryptionError("fail", "file.yaml");
    expect(err.filePath).toBe("file.yaml");
    expect(err.fix).toContain("file.yaml");
  });

  it("SopsDecryptionError without filePath", () => {
    const err = new SopsDecryptionError("fail");
    expect(err.filePath).toBeUndefined();
    expect(err.fix).toContain("configured correctly");
  });

  it("SopsEncryptionError with filePath", () => {
    const err = new SopsEncryptionError("fail", "file.yaml");
    expect(err.fix).toContain("file.yaml");
  });

  it("SopsEncryptionError without filePath", () => {
    const err = new SopsEncryptionError("fail");
    expect(err.fix).toBe("Check your SOPS configuration");
  });

  it("SopsKeyNotFoundError", () => {
    const err = new SopsKeyNotFoundError("no key");
    expect(err.name).toBe("SopsKeyNotFoundError");
    expect(err.fix).toContain("age key file");
  });

  it("GitOperationError with fix", () => {
    const err = new GitOperationError("fail", "do this");
    expect(err.fix).toBe("do this");
  });

  it("GitOperationError without fix", () => {
    const err = new GitOperationError("fail");
    expect(err.fix).toContain("git repository");
  });

  it("SchemaLoadError with filePath", () => {
    const err = new SchemaLoadError("fail", "schema.yaml");
    expect(err.fix).toContain("schema.yaml");
  });

  it("SchemaLoadError without filePath", () => {
    const err = new SchemaLoadError("fail");
    expect(err.fix).toBe("Check your schema file syntax");
  });
});

// ── Blob-shaped methods ───────────────────────────────────────────────────
//
// These mirror the existing file-path tests but exercise the substrate-
// agnostic stdin/stdout primitives used by the BlobStore + SopsClient
// composition (Phase 2). The Windows pipe parity tests are critical —
// the named-pipe pitfall (libuv's uv_shutdown is a no-op for pipes)
// caused encrypt to hang on Windows in production. Each new stdin-shaped
// method must repeat the three-test pattern: uses pipe / cleanup on
// success / cleanup on failure.

describe("SopsClient — blob-shaped methods", () => {
  beforeEach(() => {
    mockReadFileSync.mockReturnValue(sopsMetadataYaml);
    jest.clearAllMocks();
  });

  describe("decrypt (blob shape)", () => {
    it("decrypts a ciphertext blob and returns values + metadata", async () => {
      const runner = mockRunner({
        "sops decrypt": { stdout: decryptedYaml, stderr: "", exitCode: 0 },
      });
      const client = new SopsClient(runner);
      const result = await client.decrypt(sopsMetadataYaml, {
        manifest: testManifest(),
        format: "yaml",
      });
      expect(result.values).toEqual({
        DATABASE_URL: "postgres://localhost/mydb",
        DATABASE_POOL_SIZE: "10",
        DATABASE_SSL: "true",
      });
      expect(result.metadata.backend).toBe("age");
      expect(result.metadata.recipients).toContain("age1test123");
    });

    it("uses /dev/stdin as the input arg on Unix", async () => {
      const runFn = jest.fn(async () => ({
        stdout: decryptedYaml,
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      await client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" });
      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args[args.length - 1]).toBe("/dev/stdin");
      const opts = (runFn.mock.calls[0] as unknown[])[2] as { stdin?: string };
      expect(opts.stdin).toBe(sopsMetadataYaml);
    });

    it("throws SopsKeyNotFoundError when no key matches the recipients", async () => {
      mockDeriveAgePublicKey.mockResolvedValue("age1other");
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "no key", exitCode: 1 },
      });
      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1abc");
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsKeyNotFoundError);
    });

    it("throws SopsDecryptionError on other decrypt failures", async () => {
      mockDeriveAgePublicKey.mockResolvedValue("age1test123");
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "MAC mismatch", exitCode: 1 },
      });
      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1abc");
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsDecryptionError);
    });

    it("throws SopsDecryptionError when stdout is not valid YAML", async () => {
      const runner = mockRunner({
        "sops decrypt": { stdout: "not: valid: yaml: at all", stderr: "", exitCode: 0 },
      });
      const client = new SopsClient(runner);
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsDecryptionError);
    });

    it("classifies as 'key-not-found' when neither ageKey nor ageKeyFile is configured", async () => {
      // Targets `if (!this.ageKey && !this.ageKeyFile) return "key-not-found"`
      // — branch only hit when the SopsClient was constructed with neither.
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "no key", exitCode: 1 },
      });
      const client = new SopsClient(runner); // no ageKey, no ageKeyFile
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsKeyNotFoundError);
    });

    it("classifies a decrypt failure on a non-parseable blob as 'other' (SopsDecryptionError)", async () => {
      // classifyDecryptErrorFromContent's first try: parseMetadataFromContent throws.
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "boom", exitCode: 1 },
      });
      const client = new SopsClient(runner);
      await expect(
        client.decrypt("not yaml: at: all: : :", { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsDecryptionError);
    });

    it("classifies a decrypt failure on a non-age backend as 'other' (SopsDecryptionError)", async () => {
      const kmsBlob = `FOO: ENC[AES256_GCM,data:bar]
sops:
  kms:
    - arn: "arn:aws:kms:us-east-1:111122223333:key/abcd"
      created_at: "2024-01-15T10:30:00Z"
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "kms denied", exitCode: 1 },
      });
      const client = new SopsClient(runner);
      await expect(
        client.decrypt(kmsBlob, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsDecryptionError);
    });

    it("classifies as 'key-not-found' when the configured ageKeyFile cannot be read", async () => {
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "no key", exitCode: 1 },
      });
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error("ENOENT: missing key file");
      });
      const client = new SopsClient(runner, "/nonexistent/key.txt");
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsKeyNotFoundError);
    });

    it("classifies as 'key-not-found' when the key file has no AGE-SECRET-KEY lines", async () => {
      mockReadFileSync.mockReturnValue("# just a comment, no key");
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "no key", exitCode: 1 },
      });
      const client = new SopsClient(runner, "/some/key.txt");
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsKeyNotFoundError);
    });

    it("classifies as 'other' when age key derivation fails (SopsDecryptionError)", async () => {
      mockDeriveAgePublicKey.mockRejectedValue(new Error("invalid key bytes"));
      const runner = mockRunner({
        "sops decrypt": { stdout: "", stderr: "auth failed", exitCode: 1 },
      });
      const client = new SopsClient(runner, undefined, "AGE-SECRET-KEY-1abc");
      await expect(
        client.decrypt(sopsMetadataYaml, { manifest: testManifest(), format: "yaml" }),
      ).rejects.toThrow(SopsDecryptionError);
    });

    it("uses a named pipe as the input file on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const mockClose = jest.fn();
      const mockSocket = {
        write: jest.fn((_data: string, cb: () => void) => cb()),
        destroy: jest.fn(),
      } as unknown as net.Socket;
      let connectionHandler: ((socket: net.Socket) => void) | undefined;
      let listenCallback: (() => void) | undefined;
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn((_path: string, cb: () => void) => {
          listenCallback = cb;
          return mockServer;
        }),
        close: mockClose,
      } as unknown as net.Server;
      (net.createServer as jest.Mock).mockImplementation(
        (handler: (socket: net.Socket) => void) => {
          connectionHandler = handler;
          return mockServer;
        },
      );

      const runFn = jest.fn(async () => ({
        stdout: decryptedYaml,
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      const promise = client.decrypt(sopsMetadataYaml, {
        manifest: testManifest(),
        format: "yaml",
      });
      await Promise.resolve();
      listenCallback!();
      connectionHandler!(mockSocket);
      await promise;

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });

      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args[args.length - 1]).toMatch(/^\\\\\.\\pipe\\clef-sops-[0-9a-f]{16}$/);
    });

    it("cleans up the named pipe after decryption on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const mockClose = jest.fn();
      const mockSocket = {
        write: jest.fn((_data: string, cb: () => void) => cb()),
        destroy: jest.fn(),
      } as unknown as net.Socket;
      let connectionHandler: ((socket: net.Socket) => void) | undefined;
      let listenCallback: (() => void) | undefined;
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn((_path: string, cb: () => void) => {
          listenCallback = cb;
          return mockServer;
        }),
        close: mockClose,
      } as unknown as net.Server;
      (net.createServer as jest.Mock).mockImplementation(
        (handler: (socket: net.Socket) => void) => {
          connectionHandler = handler;
          return mockServer;
        },
      );

      const client = new SopsClient({
        run: jest.fn(async () => ({ stdout: decryptedYaml, stderr: "", exitCode: 0 })),
      });
      const promise = client.decrypt(sopsMetadataYaml, {
        manifest: testManifest(),
        format: "yaml",
      });
      await Promise.resolve();
      listenCallback!();
      connectionHandler!(mockSocket);
      await promise;

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });

      expect(mockClose).toHaveBeenCalled();
    });

    it("cleans up the named pipe even when sops fails on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockDeriveAgePublicKey.mockResolvedValue("age1test123");

      const mockClose = jest.fn();
      const mockSocket = {
        write: jest.fn((_data: string, cb: () => void) => cb()),
        destroy: jest.fn(),
      } as unknown as net.Socket;
      let connectionHandler: ((socket: net.Socket) => void) | undefined;
      let listenCallback: (() => void) | undefined;
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn((_path: string, cb: () => void) => {
          listenCallback = cb;
          return mockServer;
        }),
        close: mockClose,
      } as unknown as net.Server;
      (net.createServer as jest.Mock).mockImplementation(
        (handler: (socket: net.Socket) => void) => {
          connectionHandler = handler;
          return mockServer;
        },
      );

      const client = new SopsClient(
        { run: jest.fn(async () => ({ stdout: "", stderr: "fail", exitCode: 1 })) },
        undefined,
        "AGE-SECRET-KEY-1abc",
      );
      const promise = client.decrypt(sopsMetadataYaml, {
        manifest: testManifest(),
        format: "yaml",
      });
      await Promise.resolve();
      listenCallback!();
      connectionHandler!(mockSocket);
      await expect(promise).rejects.toThrow(SopsDecryptionError);

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("encrypt (blob shape)", () => {
    it("encrypts values and returns the ciphertext bytes", async () => {
      const runner = mockRunner({
        "sops --config": { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 },
      });
      const client = new SopsClient(runner);
      const out = await client.encrypt(
        { K: "v" },
        { manifest: testManifest(), environment: "dev", format: "yaml" },
      );
      expect(out).toBe(sopsMetadataYaml);
    });

    it("does NOT call writeFileAtomic — output is returned to caller", async () => {
      const runner = mockRunner({
        "sops --config": { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 },
      });
      const client = new SopsClient(runner);
      await client.encrypt(
        { K: "v" },
        { manifest: testManifest(), environment: "dev", format: "yaml" },
      );
      expect(mockWriteFileAtomic).not.toHaveBeenCalled();
    });

    it("throws SopsEncryptionError when sops exits non-zero", async () => {
      const runner = mockRunner({
        "sops --config": { stdout: "", stderr: "boom", exitCode: 1 },
      });
      const client = new SopsClient(runner);
      await expect(
        client.encrypt(
          { K: "v" },
          { manifest: testManifest(), environment: "dev", format: "yaml" },
        ),
      ).rejects.toThrow(SopsEncryptionError);
    });

    it("uses --age recipients from the manifest", async () => {
      const runFn = jest.fn(async () => ({
        stdout: sopsMetadataYaml,
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: { default_backend: "age", age: { recipients: ["age1abc", "age1xyz"] } },
      };
      await client.encrypt({ K: "v" }, { manifest: manifest, environment: "dev", format: "yaml" });
      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      const ageIdx = args.indexOf("--age");
      expect(args[ageIdx + 1]).toBe("age1abc,age1xyz");
    });

    it("uses a named pipe as the input file on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const mockClose = jest.fn();
      const mockSocket = {
        write: jest.fn((_data: string, cb: () => void) => cb()),
        destroy: jest.fn(),
      } as unknown as net.Socket;
      let connectionHandler: ((socket: net.Socket) => void) | undefined;
      let listenCallback: (() => void) | undefined;
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn((_path: string, cb: () => void) => {
          listenCallback = cb;
          return mockServer;
        }),
        close: mockClose,
      } as unknown as net.Server;
      (net.createServer as jest.Mock).mockImplementation(
        (handler: (socket: net.Socket) => void) => {
          connectionHandler = handler;
          return mockServer;
        },
      );

      const runFn = jest.fn(async () => ({
        stdout: sopsMetadataYaml,
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      const promise = client.encrypt(
        { K: "v" },
        { manifest: testManifest(), environment: "dev", format: "yaml" },
      );
      await Promise.resolve();
      listenCallback!();
      connectionHandler!(mockSocket);
      await promise;

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });

      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args[args.length - 1]).toMatch(/^\\\\\.\\pipe\\clef-sops-[0-9a-f]{16}$/);
    });

    it("cleans up the named pipe on success and on failure on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const setupMockServer = (): { server: net.Server; close: jest.Mock } => {
        const close = jest.fn();
        const server = {
          on: jest.fn(),
          listen: jest.fn((_path: string, cb: () => void) => {
            cb();
            return server;
          }),
          close,
        } as unknown as net.Server;
        (net.createServer as jest.Mock).mockImplementationOnce(
          (handler: (socket: net.Socket) => void) => {
            handler({
              write: jest.fn((_d: string, cb: () => void) => cb()),
              destroy: jest.fn(),
            } as unknown as net.Socket);
            return server;
          },
        );
        return { server, close };
      };

      // success
      const success = setupMockServer();
      const okClient = new SopsClient({
        run: jest.fn(async () => ({ stdout: sopsMetadataYaml, stderr: "", exitCode: 0 })),
      });
      await okClient.encrypt(
        { K: "v" },
        { manifest: testManifest(), environment: "dev", format: "yaml" },
      );
      expect(success.close).toHaveBeenCalled();

      // failure
      const fail = setupMockServer();
      const failClient = new SopsClient({
        run: jest.fn(async () => ({ stdout: "", stderr: "boom", exitCode: 1 })),
      });
      await expect(
        failClient.encrypt(
          { K: "v" },
          { manifest: testManifest(), environment: "dev", format: "yaml" },
        ),
      ).rejects.toThrow(SopsEncryptionError);
      expect(fail.close).toHaveBeenCalled();

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe("rotate (blob shape)", () => {
    it("returns the rotated ciphertext from stdout (no -i flag, no file IO)", async () => {
      const runner = mockRunner({
        "sops --config": { stdout: "rotated-content", stderr: "", exitCode: 0 },
      });
      const client = new SopsClient(runner);
      const out = await client.rotate(
        sopsMetadataYaml,
        { addAge: "age1new" },
        { manifest: testManifest(), format: "yaml" },
      );
      expect(out).toBe("rotated-content");
      expect(mockWriteFileAtomic).not.toHaveBeenCalled();
    });

    it("passes --add-age and --rm-age in the same invocation when both are provided", async () => {
      const runFn = jest.fn(async () => ({
        stdout: "rotated",
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      await client.rotate(
        sopsMetadataYaml,
        { addAge: "age1new", rmAge: "age1old" },
        { manifest: testManifest(), format: "yaml" },
      );
      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args).toContain("--add-age");
      expect(args[args.indexOf("--add-age") + 1]).toBe("age1new");
      expect(args).toContain("--rm-age");
      expect(args[args.indexOf("--rm-age") + 1]).toBe("age1old");
    });

    it("emits the right CLI flag for every recipient backend (addKms/rmKms/gcp/azure/pgp)", async () => {
      const runFn = jest.fn(async () => ({ stdout: "rotated", stderr: "", exitCode: 0 }));
      const client = new SopsClient({ run: runFn });
      await client.rotate(
        sopsMetadataYaml,
        {
          addKms: "arn:aws:kms:us-east-1:1:key/a",
          rmKms: "arn:aws:kms:us-east-1:1:key/b",
          addGcpKms: "projects/p/locations/l/keyRings/k/cryptoKeys/c",
          rmGcpKms: "projects/p/locations/l/keyRings/k/cryptoKeys/old",
          addAzureKv: "https://kv.vault.azure.net/keys/k1/v1",
          rmAzureKv: "https://kv.vault.azure.net/keys/k0/v0",
          addPgp: "AABBCCDD",
          rmPgp: "00112233",
        },
        { manifest: testManifest(), format: "yaml" },
      );
      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args).toContain("--add-kms");
      expect(args).toContain("--rm-kms");
      expect(args).toContain("--add-gcp-kms");
      expect(args).toContain("--rm-gcp-kms");
      expect(args).toContain("--add-azure-kv");
      expect(args).toContain("--rm-azure-kv");
      expect(args).toContain("--add-pgp");
      expect(args).toContain("--rm-pgp");
    });

    it("does NOT include -i (in-place) — the stdin/stdout pattern requires stdout output", async () => {
      const runFn = jest.fn(async () => ({
        stdout: "rotated",
        stderr: "",
        exitCode: 0,
      }));
      const client = new SopsClient({ run: runFn });
      await client.rotate(
        sopsMetadataYaml,
        { addAge: "age1new" },
        { manifest: testManifest(), format: "yaml" },
      );
      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args).not.toContain("-i");
    });

    it("throws SopsEncryptionError when sops rotate fails", async () => {
      const runner = mockRunner({
        "sops --config": { stdout: "", stderr: "key not authorized", exitCode: 1 },
      });
      const client = new SopsClient(runner);
      await expect(
        client.rotate(
          sopsMetadataYaml,
          { addAge: "age1new" },
          { manifest: testManifest(), format: "yaml" },
        ),
      ).rejects.toThrow(SopsEncryptionError);
    });

    it("uses a named pipe as the input file on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const mockClose = jest.fn();
      const mockSocket = {
        write: jest.fn((_data: string, cb: () => void) => cb()),
        destroy: jest.fn(),
      } as unknown as net.Socket;
      let connectionHandler: ((socket: net.Socket) => void) | undefined;
      let listenCallback: (() => void) | undefined;
      const mockServer = {
        on: jest.fn(),
        listen: jest.fn((_path: string, cb: () => void) => {
          listenCallback = cb;
          return mockServer;
        }),
        close: mockClose,
      } as unknown as net.Server;
      (net.createServer as jest.Mock).mockImplementation(
        (handler: (socket: net.Socket) => void) => {
          connectionHandler = handler;
          return mockServer;
        },
      );

      const runFn = jest.fn(async () => ({ stdout: "rotated", stderr: "", exitCode: 0 }));
      const client = new SopsClient({ run: runFn });
      const promise = client.rotate(
        sopsMetadataYaml,
        { addAge: "age1new" },
        { manifest: testManifest(), format: "yaml" },
      );
      await Promise.resolve();
      listenCallback!();
      connectionHandler!(mockSocket);
      await promise;

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });

      const args = (runFn.mock.calls[0] as unknown[])[1] as string[];
      expect(args[args.length - 1]).toMatch(/^\\\\\.\\pipe\\clef-sops-[0-9a-f]{16}$/);
    });

    it("cleans up the named pipe on success and on failure on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const setup = (): jest.Mock => {
        const close = jest.fn();
        const server = {
          on: jest.fn(),
          listen: jest.fn((_path: string, cb: () => void) => {
            cb();
            return server;
          }),
          close,
        } as unknown as net.Server;
        (net.createServer as jest.Mock).mockImplementationOnce(
          (handler: (socket: net.Socket) => void) => {
            handler({
              write: jest.fn((_d: string, cb: () => void) => cb()),
              destroy: jest.fn(),
            } as unknown as net.Socket);
            return server;
          },
        );
        return close;
      };

      const okClose = setup();
      const okClient = new SopsClient({
        run: jest.fn(async () => ({ stdout: "rotated", stderr: "", exitCode: 0 })),
      });
      await okClient.rotate(
        sopsMetadataYaml,
        { addAge: "age1new" },
        { manifest: testManifest(), format: "yaml" },
      );
      expect(okClose).toHaveBeenCalled();

      const failClose = setup();
      const failClient = new SopsClient({
        run: jest.fn(async () => ({ stdout: "", stderr: "boom", exitCode: 1 })),
      });
      await expect(
        failClient.rotate(
          sopsMetadataYaml,
          { addAge: "age1new" },
          { manifest: testManifest(), format: "yaml" },
        ),
      ).rejects.toThrow(SopsEncryptionError);
      expect(failClose).toHaveBeenCalled();

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe("getMetadata / validateEncryption (blob shape)", () => {
    it("getMetadataFromBlob extracts backend, recipients, version from a blob", () => {
      const client = new SopsClient(mockRunner({}));
      const meta = client.getMetadata(sopsMetadataYaml);
      expect(meta.backend).toBe("age");
      expect(meta.recipients).toEqual(["age1test123"]);
      expect(meta.version).toBe("3.8.1");
      expect(meta.lastModifiedPresent).toBe(true);
    });

    it("getMetadataFromBlob throws on a blob without sops metadata", () => {
      const client = new SopsClient(mockRunner({}));
      expect(() => client.getMetadata("FOO: bar")).toThrow(SopsDecryptionError);
    });

    it("getMetadataFromBlob throws on invalid YAML", () => {
      const client = new SopsClient(mockRunner({}));
      expect(() => client.getMetadata("not: valid: yaml: at all")).toThrow(SopsDecryptionError);
    });

    it("validateEncryptionBlob returns true for a valid SOPS blob", () => {
      const client = new SopsClient(mockRunner({}));
      expect(client.validateEncryption(sopsMetadataYaml)).toBe(true);
    });

    it("validateEncryptionBlob returns false for a blob without metadata", () => {
      const client = new SopsClient(mockRunner({}));
      expect(client.validateEncryption("FOO: bar")).toBe(false);
    });

    it("validateEncryptionBlob returns false on invalid YAML (never throws)", () => {
      const client = new SopsClient(mockRunner({}));
      expect(client.validateEncryption("not: valid: yaml: at all")).toBe(false);
    });
  });
});
