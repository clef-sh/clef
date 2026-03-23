import { BitbucketProvider } from "./bitbucket";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("BitbucketProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const config = {
    provider: "bitbucket" as const,
    repo: "workspace/repo",
    token: "bb_test123",
  };

  it("should fetch file with two calls (metadata + raw content)", async () => {
    // First call: metadata (JSON)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commit: { hash: "abc123" } }),
      })
      // Second call: raw content
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("file content here"),
      });

    const provider = new BitbucketProvider(config);
    const result = await provider.fetchFile(".clef/packed/api/production.age.json");

    expect(result.content).toBe("file content here");
    expect(result.sha).toBe("abc123");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Both calls use the same URL
    const expectedUrl =
      "https://api.bitbucket.org/2.0/repositories/workspace/repo/src/main/.clef/packed/api/production.age.json";
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expectedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bb_test123",
          Accept: "application/json",
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expectedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bb_test123",
        }),
      }),
    );
  });

  it("should use custom ref", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commit: { hash: "def456" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("data"),
      });

    const provider = new BitbucketProvider({ ...config, ref: "develop" });
    await provider.fetchFile("file.txt");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/src/develop/file.txt"),
      expect.any(Object),
    );
  });

  it("should use custom apiUrl", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commit: { hash: "ghe789" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("data"),
      });

    const provider = new BitbucketProvider({ ...config, apiUrl: "https://bb.corp.com" });
    await provider.fetchFile("file.txt");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://bb.corp.com/2.0/repositories/"),
      expect.any(Object),
    );
  });

  it("should throw on 404 from metadata call", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const provider = new BitbucketProvider(config);
    await expect(provider.fetchFile("missing.txt")).rejects.toThrow("Bitbucket API error: 404");
  });

  it("should throw on 401", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const provider = new BitbucketProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("Bitbucket API error: 401");
  });

  it("should throw on raw content fetch failure", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commit: { hash: "abc" } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const provider = new BitbucketProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("Bitbucket API error: 500");
  });
});
