import {
  type ArtifactSource,
  FileArtifactSource,
  HttpArtifactSource,
  S3ArtifactSource,
  isS3Url,
} from "@clef-sh/runtime";

/**
 * Resolve a source string to an {@link ArtifactSource} using the same
 * dispatch logic as the runtime agent. Mirrors `ClefRuntime.resolveSource`
 * in packages/runtime/src/index.ts so "debugger can read it" always implies
 * "runtime can read it."
 *
 * Dispatch order:
 *   1. S3 form — `s3://bucket/key` or the recognized `https://...s3...amazonaws.com/...` forms.
 *   2. Generic HTTP(S) — `http://...` / `https://...` not matching S3.
 *   3. Otherwise — local file path.
 */
export function resolveSource(src: string): ArtifactSource {
  if (isS3Url(src)) {
    return new S3ArtifactSource(src);
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return new HttpArtifactSource(src);
  }
  return new FileArtifactSource(src);
}
