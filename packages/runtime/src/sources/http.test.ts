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

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const source = new HttpArtifactSource("https://example.com/missing.age.json");
    await expect(source.fetch()).rejects.toThrow("404");
  });

  it("should describe itself", () => {
    const source = new HttpArtifactSource("https://example.com/artifact.age.json");
    expect(source.describe()).toBe("HTTP https://example.com/artifact.age.json");
  });
});
