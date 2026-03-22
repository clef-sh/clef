import { VcsArtifactSource } from "./vcs";
import { VcsProvider } from "../vcs/types";

describe("VcsArtifactSource", () => {
  it("should fetch from VCS provider with correct path", async () => {
    const mockProvider: VcsProvider = {
      fetchFile: jest.fn().mockResolvedValue({ content: "artifact-json", sha: "sha123" }),
    };

    const source = new VcsArtifactSource(mockProvider, "api-gateway", "production");
    const result = await source.fetch();

    expect(result.raw).toBe("artifact-json");
    expect(result.contentHash).toBe("sha123");
    expect(mockProvider.fetchFile).toHaveBeenCalledWith(".clef/packed/api-gateway/production.age");
  });

  it("should propagate VCS errors", async () => {
    const mockProvider: VcsProvider = {
      fetchFile: jest.fn().mockRejectedValue(new Error("API error")),
    };

    const source = new VcsArtifactSource(mockProvider, "api", "staging");
    await expect(source.fetch()).rejects.toThrow("API error");
  });

  it("should describe itself", () => {
    const mockProvider: VcsProvider = {
      fetchFile: jest.fn(),
    };

    const source = new VcsArtifactSource(mockProvider, "api-gateway", "production");
    expect(source.describe()).toBe("VCS .clef/packed/api-gateway/production.age");
  });
});
