import * as fs from "fs";
import { JsonEnvelopeBackend } from "./json-envelope";
import { MemoryPackOutput } from "../../artifact/output";
import type {
  ClefManifest,
  DecryptedFile,
  FileEncryptionBackend,
  SubprocessRunner,
} from "../../types";
import type { PackRequest } from "../types";

jest.mock("fs");

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

function baseManifest(): ClefManifest {
  return {
    version: 1,
    environments: [{ name: "dev", description: "Development" }],
    namespaces: [{ name: "api", description: "API secrets" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    service_identities: [
      {
        name: "api-gateway",
        description: "API gateway service",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1devkey" },
        },
      },
    ],
  };
}

function mockEncryption(): jest.Mocked<FileEncryptionBackend> {
  return {
    decrypt: jest.fn(),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
  };
}

function mockRunner(): jest.Mocked<SubprocessRunner> {
  return { run: jest.fn() } as unknown as jest.Mocked<SubprocessRunner>;
}

function makeRequest(
  encryption: FileEncryptionBackend,
  backendOptions: Record<string, unknown>,
): PackRequest {
  return {
    identity: "api-gateway",
    environment: "dev",
    manifest: baseManifest(),
    repoRoot: "/repo",
    services: { encryption, runner: mockRunner() },
    backendOptions,
  };
}

describe("JsonEnvelopeBackend", () => {
  let backend: JsonEnvelopeBackend;

  beforeEach(() => {
    jest.clearAllMocks();
    backend = new JsonEnvelopeBackend();
    mockFs.existsSync.mockImplementation((p) => String(p).includes(".enc.yaml"));
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
  });

  describe("metadata", () => {
    it("has the correct id", () => {
      expect(backend.id).toBe("json-envelope");
    });

    it("has a non-empty description", () => {
      expect(backend.description).toMatch(/JSON artifact/);
    });
  });

  describe("validateOptions", () => {
    it("accepts an outputPath-only option object", () => {
      expect(() => backend.validateOptions({ outputPath: "/tmp/a.json" })).not.toThrow();
    });

    it("accepts an output-only option object", () => {
      expect(() => backend.validateOptions({ output: new MemoryPackOutput() })).not.toThrow();
    });

    it("rejects when neither outputPath nor output is provided", () => {
      expect(() => backend.validateOptions({})).toThrow(
        /requires an 'outputPath' or 'output' option/,
      );
    });

    it("rejects both signing keys set at once", () => {
      expect(() =>
        backend.validateOptions({
          outputPath: "/tmp/a.json",
          signingKey: "ed25519-key",
          signingKmsKeyId: "arn:aws:kms:...",
        }),
      ).toThrow(/Choose one/);
    });

    it("accepts a single signing key", () => {
      expect(() =>
        backend.validateOptions({ outputPath: "/tmp/a.json", signingKey: "k" }),
      ).not.toThrow();
      expect(() =>
        backend.validateOptions({ outputPath: "/tmp/a.json", signingKmsKeyId: "arn" }),
      ).not.toThrow();
    });
  });

  describe("pack", () => {
    it("delegates to ArtifactPacker and returns a BackendPackResult", async () => {
      const encryption = mockEncryption();
      const decrypted: DecryptedFile = {
        values: { API_KEY: "secret" },
        metadata: {
          backend: "age",
          recipients: ["age1devkey"],
          lastModified: new Date(),
        },
      };
      encryption.decrypt.mockResolvedValue(decrypted);

      const output = new MemoryPackOutput();
      const req = makeRequest(encryption, { output });
      const result = await backend.pack(req);

      expect(result.backend).toBe("json-envelope");
      expect(result.keyCount).toBe(1);
      expect(result.namespaceCount).toBe(1);
      expect(result.revision).toMatch(/^\d+-[0-9a-f]{8}$/);
      expect(result.details?.outputPath).toBeNull();

      const written = output.artifact;
      expect(written?.identity).toBe("api-gateway");
      expect(written?.environment).toBe("dev");
      expect(written?.ciphertext).toBeTruthy();
    });

    it("surfaces outputPath in details when provided", async () => {
      const encryption = mockEncryption();
      encryption.decrypt.mockResolvedValue({
        values: { K: "v" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      });

      const req = makeRequest(encryption, { outputPath: "/tmp/out.json" });
      const result = await backend.pack(req);

      expect(result.details?.outputPath).toBe("/tmp/out.json");
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("applies ttl from the request to the artifact envelope", async () => {
      const encryption = mockEncryption();
      encryption.decrypt.mockResolvedValue({
        values: { K: "v" },
        metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
      });

      const output = new MemoryPackOutput();
      const req: PackRequest = {
        ...makeRequest(encryption, { output }),
        ttl: 60,
      };
      await backend.pack(req);

      const artifact = output.artifact;
      expect(artifact?.expiresAt).toBeTruthy();
      const expires = new Date(artifact!.expiresAt!).getTime();
      const now = Date.now();
      expect(expires).toBeGreaterThan(now);
      expect(expires).toBeLessThanOrEqual(now + 70_000);
    });

    it("propagates ArtifactPacker errors when identity is missing", async () => {
      const encryption = mockEncryption();
      const req = makeRequest(encryption, { output: new MemoryPackOutput() });
      const badReq: PackRequest = { ...req, identity: "does-not-exist" };
      await expect(backend.pack(badReq)).rejects.toThrow();
    });
  });
});
