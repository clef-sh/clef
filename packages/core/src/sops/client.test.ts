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

jest.mock("../dependencies/checker", () => ({
  assertSops: jest.fn().mockResolvedValue(undefined),
}));

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
        cat: {
          stdout: sopsMetadataYaml,
          stderr: "",
          exitCode: 0,
        },
      });

      const client = new SopsClient(runner);
      const result = await client.decrypt("database/dev.enc.yaml");

      expect(result.values).toEqual({
        DATABASE_URL: "postgres://localhost/mydb",
        DATABASE_POOL_SIZE: "10",
        DATABASE_SSL: "true",
      });
      expect(result.metadata.backend).toBe("age");
      expect(result.metadata.recipients).toEqual(["age1test123"]);
    });

    it("should throw SopsKeyNotFoundError when key is missing", async () => {
      const runner = mockRunner({
        "sops decrypt": {
          stdout: "",
          stderr: "could not find key to decrypt",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.decrypt("database/dev.enc.yaml")).rejects.toThrow(SopsKeyNotFoundError);
    });

    it("should throw SopsDecryptionError on general failure", async () => {
      const runner = mockRunner({
        "sops decrypt": {
          stdout: "",
          stderr: "Error: some decryption failure",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.decrypt("database/dev.enc.yaml")).rejects.toThrow(SopsDecryptionError);
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
        cat: {
          stdout: sopsMetadataYaml,
          stderr: "",
          exitCode: 0,
        },
      });

      const client = new SopsClient(runner);
      const result = await client.decrypt("database/dev.enc.yaml");

      expect(result.values).toEqual({});
      expect(result.metadata.backend).toBe("age");
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
      await expect(client.decrypt("database/dev.enc.yaml")).rejects.toThrow(SopsDecryptionError);
    });
  });

  describe("encrypt", () => {
    it("should encrypt values and write to file", async () => {
      const runFn = jest.fn(async (command: string, args: string[]) => {
        if (command === "sops" && args[0] === "encrypt") {
          return { stdout: "encrypted-content", stderr: "", exitCode: 0 };
        }
        if (command === "tee") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });

      const client = new SopsClient({ run: runFn });
      await client.encrypt("database/dev.enc.yaml", { KEY: "value" }, testManifest());

      // Verify sops encrypt was called with correct stdin content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing dynamic mock call args
      const encryptCall = (runFn.mock.calls as any[]).find(
        (c: unknown[]) => c[0] === "sops" && (c[1] as string[])[0] === "encrypt",
      );
      expect(encryptCall).toBeDefined();
      const stdinContent = (encryptCall[2] as { stdin: string }).stdin;
      const YAML = await import("yaml");
      const parsed = YAML.parse(stdinContent);
      expect(parsed).toEqual({ KEY: "value" });
      // Verify tee was called to write the file
      expect(runFn).toHaveBeenCalledWith(
        "tee",
        ["database/dev.enc.yaml"],
        expect.objectContaining({ stdin: "encrypted-content" }),
      );
    });

    it("should throw SopsEncryptionError on failure", async () => {
      const runner = mockRunner({
        "sops encrypt": {
          stdout: "",
          stderr: "Error: encryption failed",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(
        client.encrypt("database/dev.enc.yaml", { KEY: "value" }, testManifest()),
      ).rejects.toThrow(SopsEncryptionError);
    });

    it("should throw SopsEncryptionError when file write fails", async () => {
      const runFn = jest.fn(async (command: string, args: string[]) => {
        if (command === "sops" && args[0] === "encrypt") {
          return { stdout: "encrypted-content", stderr: "", exitCode: 0 };
        }
        if (command === "tee") {
          return { stdout: "", stderr: "Permission denied", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      });

      const client = new SopsClient({ run: runFn });
      await expect(
        client.encrypt("database/dev.enc.yaml", { KEY: "value" }, testManifest()),
      ).rejects.toThrow(SopsEncryptionError);
    });
  });

  describe("reEncrypt", () => {
    it("should rotate keys with a new age key", async () => {
      const runFn = jest.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));

      const client = new SopsClient({ run: runFn });
      await client.reEncrypt("database/dev.enc.yaml", "age1newkey123");

      expect(runFn).toHaveBeenCalledWith(
        "sops",
        ["rotate", "-i", "--add-age", "age1newkey123", "database/dev.enc.yaml"],
        expect.any(Object),
      );
    });

    it("should throw SopsEncryptionError on rotation failure", async () => {
      const runner = mockRunner({
        "sops rotate": {
          stdout: "",
          stderr: "rotation failed",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.reEncrypt("database/dev.enc.yaml", "age1key")).rejects.toThrow(
        SopsEncryptionError,
      );
    });
  });

  describe("addRecipient", () => {
    it("should call sops rotate with --add-age flag", async () => {
      const runFn = jest.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));

      const client = new SopsClient({ run: runFn });
      await client.addRecipient("database/dev.enc.yaml", "age1newrecipient");

      expect(runFn).toHaveBeenCalledWith(
        "sops",
        ["rotate", "-i", "--add-age", "age1newrecipient", "database/dev.enc.yaml"],
        expect.any(Object),
      );
    });

    it("should throw SopsEncryptionError on failure", async () => {
      const runner = mockRunner({
        "sops rotate": {
          stdout: "",
          stderr: "failed to add recipient",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.addRecipient("database/dev.enc.yaml", "age1key")).rejects.toThrow(
        SopsEncryptionError,
      );
    });
  });

  describe("removeRecipient", () => {
    it("should call sops rotate with --rm-age flag", async () => {
      const runFn = jest.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));

      const client = new SopsClient({ run: runFn });
      await client.removeRecipient("database/dev.enc.yaml", "age1oldrecipient");

      expect(runFn).toHaveBeenCalledWith(
        "sops",
        ["rotate", "-i", "--rm-age", "age1oldrecipient", "database/dev.enc.yaml"],
        expect.any(Object),
      );
    });

    it("should throw SopsEncryptionError on failure", async () => {
      const runner = mockRunner({
        "sops rotate": {
          stdout: "",
          stderr: "failed to remove recipient",
          exitCode: 1,
        },
      });

      const client = new SopsClient(runner);
      await expect(client.removeRecipient("database/dev.enc.yaml", "age1key")).rejects.toThrow(
        SopsEncryptionError,
      );
    });
  });

  describe("validateEncryption", () => {
    it("should return true for valid encrypted file", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: '{"encrypted": true}', stderr: "", exitCode: 0 },
        cat: { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const result = await client.validateEncryption("database/dev.enc.yaml");
      expect(result).toBe(true);
    });

    it("should return false when metadata is missing", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: "plain: data\nno_sops: here", stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const result = await client.validateEncryption("database/dev.enc.yaml");
      expect(result).toBe(false);
    });
  });

  describe("getMetadata", () => {
    it("should parse age backend metadata", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");

      expect(metadata.backend).toBe("age");
      expect(metadata.recipients).toEqual(["age1test123"]);
      expect(metadata.lastModified).toEqual(new Date("2024-01-15T10:30:00Z"));
    });

    it("should detect AWS KMS backend", async () => {
      const kmsYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  kms:
    - arn: arn:aws:kms:us-east-1:123:key/abc
      enc: testenc
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: kmsYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("awskms");
      expect(metadata.recipients).toEqual(["arn:aws:kms:us-east-1:123:key/abc"]);
    });

    it("should detect GCP KMS backend", async () => {
      const gcpYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  gcp_kms:
    - resource_id: projects/test/locations/global/keyRings/test/cryptoKeys/key1
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: gcpYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("gcpkms");
    });

    it("should detect PGP backend", async () => {
      const pgpYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  pgp:
    - fp: 85D77543B3D624B63CEA9E6DBC17301B491B3F21
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: pgpYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("pgp");
      expect(metadata.recipients).toEqual(["85D77543B3D624B63CEA9E6DBC17301B491B3F21"]);
    });

    it("should handle AWS KMS entries with missing arn property", async () => {
      const kmsYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  kms:
    - enc: testenc
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: kmsYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("awskms");
      expect(metadata.recipients).toEqual([""]);
    });

    it("should handle GCP KMS entries with missing resource_id property", async () => {
      const gcpYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  gcp_kms:
    - enc: testenc
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: gcpYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("gcpkms");
      expect(metadata.recipients).toEqual([""]);
    });

    it("should handle PGP entries with missing fp property", async () => {
      const pgpYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  pgp:
    - enc: testenc
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: pgpYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("pgp");
      expect(metadata.recipients).toEqual([""]);
    });

    it("should throw when file cannot be read", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: "", stderr: "No such file", exitCode: 1 },
      });

      const client = new SopsClient(runner);
      await expect(client.getMetadata("missing.enc.yaml")).rejects.toThrow(SopsDecryptionError);
    });

    it("should throw when file has no sops metadata", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: "plain: data", stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      await expect(client.getMetadata("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });

    it("should throw on invalid YAML in file", async () => {
      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: "{{invalid", stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      await expect(client.getMetadata("database/dev.enc.yaml")).rejects.toThrow(
        SopsDecryptionError,
      );
    });

    it("should fall back to new Date() when lastmodified is missing", async () => {
      const noLastModYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  age:
    - recipient: age1test123
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        testdata
        -----END AGE ENCRYPTED FILE-----
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: noLastModYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const before = new Date();
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      const after = new Date();

      expect(metadata.backend).toBe("age");
      expect(metadata.lastModified.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(metadata.lastModified.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should default to age when no known backend keys are present", async () => {
      const ambiguousYaml = `data: ENC[AES256_GCM,data:test=]
sops:
  lastmodified: "2024-01-15T10:30:00Z"
  version: 3.8.1`;

      const runner = mockRunner({
        "sops filestatus": { stdout: "", stderr: "", exitCode: 1 },
        cat: { stdout: ambiguousYaml, stderr: "", exitCode: 0 },
      });

      const client = new SopsClient(runner);
      const metadata = await client.getMetadata("database/dev.enc.yaml");
      expect(metadata.backend).toBe("age");
      expect(metadata.recipients).toEqual([]);
    });
  });

  describe("encrypt with different backends", () => {
    it("should pass --kms for awskms backend", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc" },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest);

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--kms");
      expect(sopsCall![1]).toContain("arn:aws:kms:us-east-1:123:key/abc");
    });

    it("should pass --gcp-kms for gcpkms backend", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: {
          default_backend: "gcpkms",
          gcp_kms_resource_id: "projects/test/locations/global/keyRings/test/cryptoKeys/key1",
        },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest);

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--gcp-kms");
    });

    it("should pass --pgp for pgp backend", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: {
          default_backend: "pgp",
          pgp_fingerprint: "85D77543B3D624B63CEA9E6DBC17301B491B3F21",
        },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest);

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--pgp");
    });

    it("should resolve per-env awskms backend when environment is provided", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:999:key/prod" },
          },
          { name: "dev", description: "Dev" },
        ],
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest, "production");

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--kms");
      expect(sopsCall![1]).toContain("arn:aws:kms:us-east-1:999:key/prod");
    });

    it("should resolve per-env gcpkms backend when environment is provided", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: {
              backend: "gcpkms",
              gcp_kms_resource_id: "projects/prod/locations/global/keyRings/r/cryptoKeys/k",
            },
          },
        ],
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest, "production");

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--gcp-kms");
      expect(sopsCall![1]).toContain("projects/prod/locations/global/keyRings/r/cryptoKeys/k");
    });

    it("should fall back to global backend when env has no override", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/global" },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest, "dev");

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--kms");
      expect(sopsCall![1]).toContain("arn:aws:kms:us-east-1:123:key/global");
    });

    it("should use global default when environment param is omitted (backward compat)", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: { default_backend: "pgp", pgp_fingerprint: "ABCD1234" },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest);

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).toContain("--pgp");
      expect(sopsCall![1]).toContain("ABCD1234");
    });

    it("should not pass extra args for age backend without key file", async () => {
      const runFn = jest.fn(async (command: string, _args: string[]) => {
        if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const client = new SopsClient({ run: runFn });
      const manifest: ClefManifest = {
        ...testManifest(),
        sops: { default_backend: "age" },
      };

      await client.encrypt("file.enc.yaml", { KEY: "val" }, manifest);

      const sopsCall = runFn.mock.calls.find(
        (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
      );
      expect(sopsCall![1]).not.toContain("--kms");
      expect(sopsCall![1]).not.toContain("--pgp");
      expect(sopsCall![1]).not.toContain("--gcp-kms");
    });
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
      if (command === "cat") {
        return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decrypt("database/dev.enc.yaml");

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
      if (command === "cat") {
        return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decrypt("database/dev.enc.json");

    const decryptCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "decrypt",
    );
    expect(decryptCall![1]).toContain("json");
  });

  it("should use json format for encrypt on .enc.json files", async () => {
    const runFn = jest.fn(async (command: string, _args: string[]) => {
      if (command === "sops") return { stdout: "encrypted", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.encrypt("file.enc.json", { KEY: "val" }, testManifest());

    const sopsCall = runFn.mock.calls.find(
      (c: [string, string[]]) => c[0] === "sops" && c[1][0] === "encrypt",
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

    await expect(client.decrypt("file.enc.yaml")).rejects.toThrow(SopsMissingError);
  });

  it("validateEncryption should throw SopsMissingError when sops is missing", async () => {
    mockAssertSops.mockRejectedValueOnce(new SopsMissingError("brew install sops"));

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(client.validateEncryption("file.enc.yaml")).rejects.toThrow(SopsMissingError);
  });

  it("getMetadata should throw SopsMissingError when sops is missing", async () => {
    mockAssertSops.mockRejectedValueOnce(new SopsMissingError("brew install sops"));

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(client.getMetadata("file.enc.yaml")).rejects.toThrow(SopsMissingError);
  });

  it("should reject with SopsVersionError when sops is outdated", async () => {
    mockAssertSops.mockRejectedValueOnce(
      new SopsVersionError("3.7.2", "3.8.0", "brew upgrade sops"),
    );

    const runner = mockRunner({});
    const client = new SopsClient(runner);

    await expect(client.decrypt("file.enc.yaml")).rejects.toThrow(SopsVersionError);
  });
});

describe("buildSopsEnv (ageKeyFile injection)", () => {
  const origAgeKey = process.env.SOPS_AGE_KEY;
  const origAgeKeyFile = process.env.SOPS_AGE_KEY_FILE;

  beforeEach(() => {
    delete process.env.SOPS_AGE_KEY;
    delete process.env.SOPS_AGE_KEY_FILE;
  });

  afterEach(() => {
    if (origAgeKey !== undefined) process.env.SOPS_AGE_KEY = origAgeKey;
    else delete process.env.SOPS_AGE_KEY;
    if (origAgeKeyFile !== undefined) process.env.SOPS_AGE_KEY_FILE = origAgeKeyFile;
    else delete process.env.SOPS_AGE_KEY_FILE;
  });

  it("should inject SOPS_AGE_KEY_FILE env when ageKeyFile param is set and no env vars present", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (command === "cat") return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, "/custom/keys.txt");
    await client.decrypt("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({ env: { SOPS_AGE_KEY_FILE: "/custom/keys.txt" } });
  });

  it("should not inject env when SOPS_AGE_KEY_FILE is already set", async () => {
    process.env.SOPS_AGE_KEY_FILE = "/env/keys.txt";

    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (command === "cat") return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, "/custom/keys.txt");
    await client.decrypt("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({});
  });

  it("should not inject env when SOPS_AGE_KEY is already set", async () => {
    process.env.SOPS_AGE_KEY = "AGE-SECRET-KEY-1TEST";

    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (command === "cat") return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn }, "/custom/keys.txt");
    await client.decrypt("database/dev.enc.yaml");

    const decryptCall = runFn.mock.calls.find((c) => c[0] === "sops" && c[1][0] === "decrypt");
    expect(decryptCall![2]).toEqual({});
  });

  it("should not inject env when no ageKeyFile param and no env vars", async () => {
    const runFn = jest.fn(async (command: string, args: string[], _options?: SubprocessOptions) => {
      if (command === "sops" && args[0] === "decrypt")
        return { stdout: "KEY: value\n", stderr: "", exitCode: 0 };
      if (command === "sops" && args[0] === "filestatus")
        return { stdout: "", stderr: "", exitCode: 1 };
      if (command === "cat") return { stdout: sopsMetadataYaml, stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const client = new SopsClient({ run: runFn });
    await client.decrypt("database/dev.enc.yaml");

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
