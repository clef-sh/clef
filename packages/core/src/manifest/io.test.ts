import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { readManifestYaml, writeManifestYaml, writeManifestYamlRaw } from "./io";
import { CLEF_MANIFEST_FILENAME } from "./parser";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

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
    it("writes via temp file then atomic rename", () => {
      const doc = { version: 1, environments: [{ name: "dev" }] };

      writeManifestYaml(REPO, doc);

      // writeFileSync was called with a temp path
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const tempPath = writeCall[0] as string;
      expect(tempPath).toContain(`.${CLEF_MANIFEST_FILENAME}.tmp.`);
      expect(writeCall[1]).toBe(YAML.stringify(doc));
      expect(writeCall[2]).toBe("utf-8");

      // renameSync was called from temp path → manifest path
      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
      expect(mockFs.renameSync).toHaveBeenCalledWith(tempPath, MANIFEST_PATH);
    });

    it("uses a temp file in the same directory as the manifest", () => {
      writeManifestYaml(REPO, { version: 1 });

      const tempPath = mockFs.writeFileSync.mock.calls[0][0] as string;
      // Same dir = atomic rename guarantee on POSIX
      expect(path.dirname(tempPath)).toBe(REPO);
    });

    it("does not unlink the temp file on success (rename consumes it)", () => {
      writeManifestYaml(REPO, { version: 1 });

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it("cleans up the temp file when writeFileSync fails", () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error("write failed");
      });

      expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow("write failed");

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
      const unlinkPath = mockFs.unlinkSync.mock.calls[0][0] as string;
      expect(unlinkPath).toContain(`.${CLEF_MANIFEST_FILENAME}.tmp.`);
    });

    it("cleans up the temp file when renameSync fails", () => {
      mockFs.renameSync.mockImplementation(() => {
        throw new Error("rename failed");
      });

      expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow("rename failed");

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
      const unlinkPath = mockFs.unlinkSync.mock.calls[0][0] as string;
      expect(unlinkPath).toContain(`.${CLEF_MANIFEST_FILENAME}.tmp.`);
    });

    it("swallows unlink errors during cleanup (best-effort)", () => {
      mockFs.renameSync.mockImplementation(() => {
        throw new Error("rename failed");
      });
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error("unlink failed too");
      });

      // The original rename error must still propagate, not the unlink error
      expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow("rename failed");
    });

    it("re-throws the original write error after cleanup", () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error("disk full");
      });

      expect(() => writeManifestYaml(REPO, { version: 1 })).toThrow("disk full");
    });
  });

  describe("writeManifestYamlRaw", () => {
    it("writes a raw string verbatim through the atomic path", () => {
      const raw = "# Important: do not edit\nversion: 1\nnamespaces:\n  - name: payments\n";

      writeManifestYamlRaw(REPO, raw);

      // The temp file gets the exact raw string (no YAML stringify round-trip)
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[1]).toBe(raw);

      // Atomic rename happened
      expect(mockFs.renameSync).toHaveBeenCalledTimes(1);
    });

    it("preserves bytes for rollback (no parse → stringify round-trip)", () => {
      const original = "# Comment with    weird   spacing\nversion:    1\n";
      writeManifestYamlRaw(REPO, original);

      // YAML.stringify would normalize the spacing — verify we did NOT
      const writtenBytes = mockFs.writeFileSync.mock.calls[0][1];
      expect(writtenBytes).toBe(original);
    });

    it("cleans up the temp file when writes fail", () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error("write failed");
      });

      expect(() => writeManifestYamlRaw(REPO, "version: 1\n")).toThrow("write failed");

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
    });
  });
});
