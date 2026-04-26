import { FileArtifactSource, HttpArtifactSource, S3ArtifactSource } from "@clef-sh/runtime";
import { resolveSource } from "./source";

describe("resolveSource", () => {
  beforeAll(() => {
    process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
  });

  it("dispatches s3:// URLs to S3ArtifactSource", () => {
    expect(resolveSource("s3://my-bucket/path/to/envelope.json")).toBeInstanceOf(S3ArtifactSource);
  });

  it("dispatches virtual-hosted S3 HTTPS URLs to S3ArtifactSource", () => {
    expect(
      resolveSource("https://my-bucket.s3.us-east-1.amazonaws.com/envelope.json"),
    ).toBeInstanceOf(S3ArtifactSource);
  });

  it("dispatches path-style S3 HTTPS URLs to S3ArtifactSource", () => {
    expect(
      resolveSource("https://s3.us-east-1.amazonaws.com/my-bucket/envelope.json"),
    ).toBeInstanceOf(S3ArtifactSource);
  });

  it("dispatches non-S3 HTTPS URLs to HttpArtifactSource", () => {
    expect(resolveSource("https://example.com/envelope.json")).toBeInstanceOf(HttpArtifactSource);
  });

  it("dispatches plain http:// URLs to HttpArtifactSource", () => {
    expect(resolveSource("http://example.com/envelope.json")).toBeInstanceOf(HttpArtifactSource);
  });

  it("dispatches bare file paths to FileArtifactSource", () => {
    expect(resolveSource("/tmp/envelope.json")).toBeInstanceOf(FileArtifactSource);
  });

  it("dispatches relative file paths to FileArtifactSource", () => {
    expect(resolveSource("./envelope.json")).toBeInstanceOf(FileArtifactSource);
  });

  it("treats a URL-looking path without a recognized protocol as a file", () => {
    // e.g. weird filename starting with "ftp://" → FileArtifactSource
    expect(resolveSource("ftp://example.com/file.json")).toBeInstanceOf(FileArtifactSource);
  });
});
