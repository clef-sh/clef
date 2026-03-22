import * as fs from "fs";
import { FileArtifactSource } from "./file";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("FileArtifactSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should read artifact from file", async () => {
    mockFs.readFileSync.mockReturnValue('{"version":1}');

    const source = new FileArtifactSource("/path/to/artifact.age.json");
    const result = await source.fetch();

    expect(result.raw).toBe('{"version":1}');
    expect(mockFs.readFileSync).toHaveBeenCalledWith("/path/to/artifact.age.json", "utf-8");
  });

  it("should not return contentHash", async () => {
    mockFs.readFileSync.mockReturnValue("data");

    const source = new FileArtifactSource("/path/to/artifact.age.json");
    const result = await source.fetch();

    expect(result.contentHash).toBeUndefined();
  });

  it("should throw on file read error", async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const source = new FileArtifactSource("/path/to/missing.age.json");
    await expect(source.fetch()).rejects.toThrow("ENOENT");
  });

  it("should describe itself", () => {
    const source = new FileArtifactSource("/path/to/artifact.age.json");
    expect(source.describe()).toBe("file /path/to/artifact.age.json");
  });
});
