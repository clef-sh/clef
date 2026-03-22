import { GitHubProvider } from "./github";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GitHubProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const config = {
    provider: "github" as const,
    repo: "org/secrets",
    token: "ghp_test123",
  };

  it("should fetch a file and decode base64 content", async () => {
    const content = Buffer.from("hello world").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sha: "abc123", content, encoding: "base64" }),
    });

    const provider = new GitHubProvider(config);
    const result = await provider.fetchFile(".clef/packed/api/production.age");

    expect(result.content).toBe("hello world");
    expect(result.sha).toBe("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/org/secrets/contents/.clef/packed/api/production.age",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer ghp_test123",
          Accept: "application/vnd.github+json",
        },
      }),
    );
  });

  it("should include ref query parameter when specified", async () => {
    const content = Buffer.from("data").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sha: "def456", content, encoding: "base64" }),
    });

    const provider = new GitHubProvider({ ...config, ref: "v1.0.0" });
    await provider.fetchFile("path/to/file");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/org/secrets/contents/path/to/file?ref=v1.0.0",
      expect.any(Object),
    );
  });

  it("should use custom apiUrl for GHE", async () => {
    const content = Buffer.from("data").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sha: "ghe789", content, encoding: "base64" }),
    });

    const provider = new GitHubProvider({ ...config, apiUrl: "https://github.corp.com/api/v3" });
    await provider.fetchFile("file.txt");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://github.corp.com/repos/org/secrets/contents/file.txt",
      expect.any(Object),
    );
  });

  it("should throw on 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const provider = new GitHubProvider(config);
    await expect(provider.fetchFile("missing.txt")).rejects.toThrow("GitHub API error: 404");
  });

  it("should throw on 401", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const provider = new GitHubProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("GitHub API error: 401");
  });

  it("should throw on 403", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const provider = new GitHubProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("GitHub API error: 403");
  });
});
