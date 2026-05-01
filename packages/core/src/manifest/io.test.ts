import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { readManifestYaml, writeManifestYaml, writeManifestYamlRaw } from "./io";
import { CLEF_MANIFEST_FILENAME } from "./parser";

jest.mock("fs");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockFs = fs as jest.Mocked<typeof fs>;
const mockWriteFileAtomic = writeFileAtomic as jest.Mocked<typeof writeFileAtomic>;

const REPO = "/fake/repo";
const MANIFEST_PATH = path.join(REPO, CLEF_MANIFEST_FILENAME);

describe("manifest io", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("readManifestYaml", () => {
    it("parses an existing manifest", () => {
      const doc = { version: 1, environments: [{ name: "dev" }] };
      mockFs.readFileSync.mockReturnValue(YAML.stringify(doc));

      expect(readManifestYaml(REPO)).toEqual(doc);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(MANIFEST_PATH, "utf-8");
    });

    it("propagates errors when the manifest does not exist", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => readManifestYaml(REPO)).toThrow("ENOENT");
    });
  });

  describe("writeManifestYaml", () => {
    // Minimal manifest that passes parser.validate(). The writer now refuses
    // invalid input — see the "rejects invalid manifest" tests below — so all
    // happy-path tests need a real shape, not just `{ version: 1 }`.
    const validDoc = (): Record<string, unknown> => ({
      version: 1,
      environments: [{ name: "dev", description: "Development" }],
      namespaces: [{ name: "app", description: "App secrets" }],
      file_pattern: "secrets/{namespace}/{environment}.enc.yaml",
      sops: {
        default_backend: "age",
        age: { recipients: ["age1jttav2w6p5h6x9yjuvstqsslvc4gxmqwr6mrzaq9rvnqluqvspgqcu7yf2"] },
      },
    });

    it("writes via write-file-atomic with the YAML-stringified document", () => {
      const doc = validDoc();

      writeManifestYaml(REPO, doc);

      expect(mockWriteFileAtomic.sync).toHaveBeenCalledTimes(1);
      expect(mockWriteFileAtomic.sync).toHaveBeenCalledWith(MANIFEST_PATH, YAML.stringify(doc));
    });

    it("writes to the manifest path under repoRoot", () => {
      writeManifestYaml(REPO, validDoc());

      const writeCall = mockWriteFileAtomic.sync.mock.calls[0];
      expect(writeCall[0]).toBe(MANIFEST_PATH);
    });

    it("propagates errors from write-file-atomic", () => {
      mockWriteFileAtomic.sync.mockImplementation(() => {
        throw new Error("disk full");
      });

      expect(() => writeManifestYaml(REPO, validDoc())).toThrow("disk full");
    });

    describe("rejects invalid manifest before writing", () => {
      it("throws on missing required field", () => {
        expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow(
          /Refusing to write invalid manifest.*environments/i,
        );
        expect(mockWriteFileAtomic.sync).not.toHaveBeenCalled();
      });

      it("throws with the specific reason for a malformed AWS KMS ARN", () => {
        // The exact bug a user hit: $REGION shell var was unset when the ARN
        // was assembled, so the manifest's keyId was missing the region
        // segment. Without write-time validation this corrupted the manifest
        // and bricked every subsequent clef invocation.
        const doc = validDoc();
        doc.service_identities = [
          {
            name: "app",
            namespaces: ["app"],
            environments: {
              dev: {
                kms: {
                  provider: "aws",
                  keyId: "arn:aws:kms::123456789012:alias/foo", // empty region
                },
              },
            },
          },
        ];

        expect(() => writeManifestYaml(REPO, doc)).toThrow(/region segment is empty/);
        expect(mockWriteFileAtomic.sync).not.toHaveBeenCalled();
      });

      it("propagates non-validation errors unchanged", () => {
        // Anything that isn't a ManifestValidationError should pass through —
        // we only wrap the validation case to add the "Refusing to write…"
        // prefix.
        const doc = null as unknown as Record<string, unknown>;
        expect(() => writeManifestYaml(REPO, doc)).toThrow();
      });
    });
  });

  describe("writeManifestYamlRaw", () => {
    it("writes a raw string verbatim through write-file-atomic", () => {
      const raw = "# Important: do not edit\nversion: 1\nnamespaces:\n  - name: payments\n";

      writeManifestYamlRaw(REPO, raw);

      expect(mockWriteFileAtomic.sync).toHaveBeenCalledTimes(1);
      expect(mockWriteFileAtomic.sync).toHaveBeenCalledWith(MANIFEST_PATH, raw);
    });

    it("preserves bytes for rollback (no parse → stringify round-trip)", () => {
      const original = "# Comment with    weird   spacing\nversion:    1\n";
      writeManifestYamlRaw(REPO, original);

      // YAML.stringify would normalize spacing — verify we did NOT
      const writtenBytes = mockWriteFileAtomic.sync.mock.calls[0][1];
      expect(writtenBytes).toBe(original);
    });

    it("propagates errors from write-file-atomic", () => {
      mockWriteFileAtomic.sync.mockImplementation(() => {
        throw new Error("write failed");
      });

      expect(() => writeManifestYamlRaw(REPO, "version: 1\n")).toThrow("write failed");
    });
  });
});
