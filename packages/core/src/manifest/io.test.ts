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
    it("writes via write-file-atomic with the YAML-stringified document", () => {
      const doc = { version: 1, environments: [{ name: "dev" }] };

      writeManifestYaml(REPO, doc);

      expect(mockWriteFileAtomic.sync).toHaveBeenCalledTimes(1);
      expect(mockWriteFileAtomic.sync).toHaveBeenCalledWith(MANIFEST_PATH, YAML.stringify(doc));
    });

    it("writes to the manifest path under repoRoot", () => {
      writeManifestYaml(REPO, { version: 1 });

      const writeCall = mockWriteFileAtomic.sync.mock.calls[0];
      expect(writeCall[0]).toBe(MANIFEST_PATH);
    });

    it("propagates errors from write-file-atomic", () => {
      mockWriteFileAtomic.sync.mockImplementation(() => {
        throw new Error("disk full");
      });

      expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow("disk full");
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
