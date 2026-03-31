import { HttpArtifactSource } from "./http";

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("HttpArtifactSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch artifact and return raw content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"version":1}'),
      headers: new Map([["etag", '"abc123"']]),
    });

    const source = new HttpArtifactSource("https://bucket.example.com/artifact.age.json");
    const result = await source.fetch();

    expect(result.raw).toBe('{"version":1}');
    expect(mockFetch).toHaveBeenCalledWith("https://bucket.example.com/artifact.age.json");
  });

  it("should return etag as contentHash", async () => {
    const headers = new Headers();
    headers.set("etag", '"etag-value"');
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("data"),
      headers,
    });

    const source = new HttpArtifactSource("https://example.com/a.age.json");
    const result = await source.fetch();

    expect(result.contentHash).toBe('"etag-value"');
  });

  it("should return undefined contentHash when no etag", async () => {
    const headers = new Headers();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("data"),
      headers,
    });

    const source = new HttpArtifactSource("https://example.com/a.age.json");
    const result = await source.fetch();

    expect(result.contentHash).toBeUndefined();
  });

  it("should throw on HTTP error with status and status text", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });

    const source = new HttpArtifactSource("https://example.com/missing.age.json");
    await expect(source.fetch()).rejects.toThrow("404 Not Found");
  });

  it("should throw on HTTP 403 with status text", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });

    const source = new HttpArtifactSource("https://bucket.s3.amazonaws.com/artifact.age.json");
    await expect(source.fetch()).rejects.toThrow("403 Forbidden");
  });

  it("should describe itself", () => {
    const source = new HttpArtifactSource("https://example.com/artifact.age.json");
    expect(source.describe()).toBe("HTTP https://example.com/artifact.age.json");
  });

  it("should redact credentials from URL in describe()", () => {
    const source = new HttpArtifactSource("https://user:s3cret@bucket.example.com/artifact.json");
    const desc = source.describe();
    expect(desc).not.toContain("s3cret");
    expect(desc).not.toContain("user:");
    expect(desc).toContain("***");
    expect(desc).toContain("bucket.example.com");
  });

  it("should handle invalid URLs gracefully in describe()", () => {
    const source = new HttpArtifactSource("not-a-url");
    expect(source.describe()).toBe("HTTP <invalid-url>");
  });
});
