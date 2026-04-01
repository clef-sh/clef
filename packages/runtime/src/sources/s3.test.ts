import { S3ArtifactSource, isS3Url } from "./s3";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe("isS3Url", () => {
  it("matches virtual-hosted S3 URLs with region", () => {
    expect(isS3Url("https://my-bucket.s3.us-east-1.amazonaws.com/key/file.json")).toBe(true);
  });

  it("matches virtual-hosted S3 URLs without region", () => {
    expect(isS3Url("https://my-bucket.s3.amazonaws.com/key/file.json")).toBe(true);
  });

  it("matches path-style S3 URLs with region", () => {
    expect(isS3Url("https://s3.us-west-2.amazonaws.com/my-bucket/key/file.json")).toBe(true);
  });

  it("matches path-style S3 URLs without region", () => {
    expect(isS3Url("https://s3.amazonaws.com/my-bucket/key/file.json")).toBe(true);
  });

  it("rejects non-S3 URLs", () => {
    expect(isS3Url("https://example.com/artifact.json")).toBe(false);
    expect(isS3Url("https://cdn.company.com/secrets.json")).toBe(false);
  });

  it("rejects non-HTTPS URLs", () => {
    expect(isS3Url("http://my-bucket.s3.amazonaws.com/key.json")).toBe(false);
  });
});

describe("S3ArtifactSource", () => {
  it("should sign and fetch from S3", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"version":1}'),
      headers: new Headers([["etag", '"abc"']]),
    });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/path/artifact.json",
    );
    const result = await source.fetch();

    expect(result.raw).toBe('{"version":1}');
    expect(result.contentHash).toBe('"abc"');

    // Verify the request was signed
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/path/artifact.json");
    expect(opts.headers).toHaveProperty("Authorization");
    expect(opts.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(opts.headers.Authorization).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(opts.headers).toHaveProperty("x-amz-date");
    expect(opts.headers).toHaveProperty("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
  });

  it("should include session token when present", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    process.env.AWS_SESSION_TOKEN = "FwoGZXIvY...";

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("data"),
      headers: new Headers(),
    });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/key.json",
    );
    await source.fetch();

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers).toHaveProperty("x-amz-security-token", "FwoGZXIvY...");
  });

  it("should throw on S3 403 Forbidden", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/key.json",
    );
    await expect(source.fetch()).rejects.toThrow("403 Forbidden");
  });

  it("should fetch ECS credentials from container metadata", async () => {
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/v2/credentials/uuid-1234";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    // First call: ECS metadata endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          AccessKeyId: "ASIATEMP",
          SecretAccessKey: "tempsecret",
          Token: "sessiontoken",
          Expiration: "2099-01-01T00:00:00Z",
        }),
    });

    // Second call: actual S3 request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("data"),
      headers: new Headers(),
    });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/artifact.json",
    );
    await source.fetch();

    // Verify metadata endpoint was called
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://169.254.170.2/v2/credentials/uuid-1234",
    );

    // Verify S3 request used the temp credentials
    const s3Opts = mockFetch.mock.calls[1][1];
    expect(s3Opts.headers.Authorization).toContain("ASIATEMP");
    expect(s3Opts.headers["x-amz-security-token"]).toBe("sessiontoken");
  });

  it("should throw when no credentials are available", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/key.json",
    );
    await expect(source.fetch()).rejects.toThrow("No AWS credentials found");
  });

  it("should parse region from URL", () => {
    const source = new S3ArtifactSource(
      "https://my-bucket.s3.eu-west-1.amazonaws.com/key.json",
    );
    expect(source.describe()).toBe("S3 s3://my-bucket/key.json");
  });

  it("should default region to us-east-1 when not in URL", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("data"),
      headers: new Headers(),
    });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.amazonaws.com/key.json",
    );
    // The describe won't show region, but the signed URL will use us-east-1
    expect(source.describe()).toBe("S3 s3://my-bucket/key.json");
  });

  it("should cache ECS credentials across fetches", async () => {
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/v2/credentials/uuid-1234";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    // ECS metadata (called once)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          AccessKeyId: "ASIATEMP",
          SecretAccessKey: "tempsecret",
          Token: "tok",
          Expiration: "2099-01-01T00:00:00Z",
        }),
    });

    // Two S3 requests
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("data"),
      headers: new Headers(),
    });

    const source = new S3ArtifactSource(
      "https://my-bucket.s3.us-east-1.amazonaws.com/key.json",
    );
    await source.fetch();
    await source.fetch();

    // Metadata called once, S3 called twice = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // First call is metadata, second and third are S3
    expect(mockFetch.mock.calls[0][0]).toContain("169.254.170.2");
    expect(mockFetch.mock.calls[1][0]).toContain("s3.us-east-1");
    expect(mockFetch.mock.calls[2][0]).toContain("s3.us-east-1");
  });
});
