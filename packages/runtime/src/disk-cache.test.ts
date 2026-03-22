import * as fs from "fs";
import { DiskCache } from "./disk-cache";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("DiskCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("write", () => {
    it("should create directory and write artifact + metadata", () => {
      const cache = new DiskCache("/tmp/clef-cache", "api-gateway", "production");
      cache.write('{"version":1}', "sha123");

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("api-gateway"), {
        recursive: true,
      });
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
      // Artifact file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("production.age"),
        '{"version":1}',
        "utf-8",
      );
      // Metadata file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("production.meta"),
        expect.stringContaining('"sha":"sha123"'),
        "utf-8",
      );
    });

    it("should write metadata without sha", () => {
      const cache = new DiskCache("/tmp/clef-cache", "api", "staging");
      cache.write("data");

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("staging.meta"),
        expect.stringContaining('"fetchedAt"'),
        "utf-8",
      );
    });
  });

  describe("read", () => {
    it("should return cached artifact content", () => {
      mockFs.readFileSync.mockReturnValue('{"version":1}');

      const cache = new DiskCache("/tmp/clef-cache", "api-gateway", "production");
      const result = cache.read();

      expect(result).toBe('{"version":1}');
    });

    it("should return null when no cache file exists", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const cache = new DiskCache("/tmp/clef-cache", "api", "staging");
      const result = cache.read();

      expect(result).toBeNull();
    });
  });

  describe("getCachedSha", () => {
    it("should return sha from metadata", () => {
      mockFs.readFileSync.mockReturnValue('{"sha":"sha123","fetchedAt":"2024-01-01T00:00:00Z"}');

      const cache = new DiskCache("/tmp/clef-cache", "api-gateway", "production");
      const sha = cache.getCachedSha();

      expect(sha).toBe("sha123");
    });

    it("should return undefined when no metadata exists", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const cache = new DiskCache("/tmp/clef-cache", "api", "staging");
      const sha = cache.getCachedSha();

      expect(sha).toBeUndefined();
    });
  });
});
