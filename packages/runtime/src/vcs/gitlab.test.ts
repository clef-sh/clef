import { GitLabProvider } from "./gitlab";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GitLabProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const config = {
    provider: "gitlab" as const,
    repo: "group/project",
    token: "glpat-test123",
  };

  it("should fetch a file and decode base64 content", async () => {
    const content = Buffer.from("gitlab content").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ blob_id: "abc123", content, encoding: "base64" }),
    });

    const provider = new GitLabProvider(config);
    const result = await provider.fetchFile(".clef/packed/api/production.age");

    expect(result.content).toBe("gitlab content");
    expect(result.sha).toBe("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v4/projects/group%2Fproject/repository/files/.clef%2Fpacked%2Fapi%2Fproduction.age",
      ),
      expect.objectContaining({
        headers: { "PRIVATE-TOKEN": "glpat-test123" },
      }),
    );
  });

  it("should include ref query parameter when specified", async () => {
    const content = Buffer.from("data").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ blob_id: "def456", content, encoding: "base64" }),
    });

    const provider = new GitLabProvider({ ...config, ref: "main" });
    await provider.fetchFile("file.txt");

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("ref=main"), expect.any(Object));
  });

  it("should use custom apiUrl for self-hosted GitLab", async () => {
    const content = Buffer.from("data").toString("base64");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ blob_id: "ce789", content, encoding: "base64" }),
    });

    const provider = new GitLabProvider({ ...config, apiUrl: "https://gitlab.corp.com" });
    await provider.fetchFile("file.txt");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://gitlab.corp.com/api/v4/projects/"),
      expect.any(Object),
    );
  });

  it("should throw on 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const provider = new GitLabProvider(config);
    await expect(provider.fetchFile("missing.txt")).rejects.toThrow("GitLab API error: 404");
  });

  it("should throw on 401", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const provider = new GitLabProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("GitLab API error: 401");
  });

  it("should throw on 403", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const provider = new GitLabProvider(config);
    await expect(provider.fetchFile("file.txt")).rejects.toThrow("GitLab API error: 403");
  });
});
