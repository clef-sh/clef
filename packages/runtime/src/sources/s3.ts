import * as crypto from "crypto";
import { ArtifactSource, ArtifactFetchResult } from "./types";

/** Credentials resolved from the environment or ECS container metadata. */
interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Parsed S3 URL components. */
interface S3Location {
  bucket: string;
  key: string;
  region: string;
}

/**
 * Returns true if the URL is either the `s3://bucket/key` scheme or a
 * recognized S3 HTTPS URL. Purely structural — does not verify AWS_REGION
 * resolution for `s3://` URLs (that check happens later when the source is
 * constructed, so the caller sees a meaningful error then).
 */
export function isS3Url(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "s3:") {
    return !!u.hostname && u.pathname.length > 1;
  }
  if (u.protocol === "https:") {
    return parseHttpsS3Url(u) !== null;
  }
  return false;
}

/**
 * Parse bucket, key, and region from an S3 URL.
 *
 * Supported forms:
 *   s3://bucket/key                                  (region from AWS_REGION env)
 *   https://bucket.s3.region.amazonaws.com/key       (virtual-hosted)
 *   https://bucket.s3.amazonaws.com/key              (virtual-hosted, us-east-1)
 *   https://s3.region.amazonaws.com/bucket/key       (path-style)
 *   https://s3.amazonaws.com/bucket/key              (path-style, us-east-1)
 *
 * Throws with a specific message when the URL shape is valid but the
 * region cannot be resolved (s3:// without AWS_REGION).
 */
function parseS3Url(url: string): S3Location {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }

  if (u.protocol === "s3:") {
    const bucket = u.hostname;
    const key = u.pathname.slice(1);
    if (!bucket || !key) {
      throw new Error(`Invalid s3:// URL (missing bucket or key): ${url}`);
    }
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (!region) {
      throw new Error(
        `s3:// URLs require AWS_REGION or AWS_DEFAULT_REGION to be set. ` +
          `Lambda and ECS set AWS_REGION automatically; set it explicitly for other environments, ` +
          `or use the https://bucket.s3.region.amazonaws.com/key form instead. URL: ${url}`,
      );
    }
    return { bucket, key, region };
  }

  if (u.protocol === "https:") {
    const loc = parseHttpsS3Url(u);
    if (loc) return loc;
  }

  throw new Error(`Not a valid S3 URL: ${url}`);
}

function parseHttpsS3Url(u: URL): S3Location | null {
  const host = u.hostname;
  const key = u.pathname.slice(1);
  if (!key) return null;

  // Virtual-hosted: bucket.s3.region.amazonaws.com or bucket.s3.amazonaws.com
  const vhMatch =
    host.match(/^(.+)\.s3\.([a-z0-9-]+)\.amazonaws\.com$/) ??
    host.match(/^(.+)\.s3\.amazonaws\.com$/);
  if (vhMatch) {
    return { bucket: vhMatch[1], key, region: vhMatch[2] || "us-east-1" };
  }

  // Path-style: s3.region.amazonaws.com/bucket/key or s3.amazonaws.com/bucket/key
  const psMatch =
    host.match(/^s3\.([a-z0-9-]+)\.amazonaws\.com$/) ?? host.match(/^s3\.amazonaws\.com$/);
  if (psMatch) {
    const slashIdx = key.indexOf("/");
    if (slashIdx < 0) return null;
    return {
      bucket: key.slice(0, slashIdx),
      key: key.slice(slashIdx + 1),
      region: psMatch[1] || "us-east-1",
    };
  }

  return null;
}

/**
 * Fetches an artifact from S3 using SigV4-signed requests.
 *
 * Credentials are resolved from (in order):
 * 1. `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` — ECS/Fargate task role
 * 2. `AWS_CONTAINER_CREDENTIALS_FULL_URI` — ECS with custom endpoint
 * 3. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
 */
export class S3ArtifactSource implements ArtifactSource {
  private readonly url: string;
  private readonly location: S3Location;
  private cachedCredentials: { creds: AwsCredentials; expiresAt: number } | null = null;

  constructor(url: string) {
    this.url = url;
    this.location = parseS3Url(url);
  }

  async fetch(): Promise<ArtifactFetchResult> {
    const creds = await this.resolveCredentials();
    const { bucket, key, region } = this.location;
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const path = `/${encodeS3Key(key)}`;
    const now = new Date();

    const headers = signS3GetRequest(host, path, region, creds, now);

    const res = await globalThis.fetch(`https://${host}${path}`, { headers });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch artifact from ${this.describe()}: ${res.status} ${res.statusText}`,
      );
    }
    const raw = await res.text();
    const etag = res.headers.get("etag") ?? undefined;
    return { raw, contentHash: etag };
  }

  describe(): string {
    const { bucket, key } = this.location;
    return `S3 s3://${bucket}/${key}`;
  }

  private async resolveCredentials(): Promise<AwsCredentials> {
    // Return cached credentials if still valid (with 5min buffer)
    if (this.cachedCredentials && Date.now() < this.cachedCredentials.expiresAt - 300_000) {
      return this.cachedCredentials.creds;
    }

    // 1. ECS container credentials (Fargate)
    const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    if (relativeUri) {
      return this.fetchEcsCredentials(`http://169.254.170.2${relativeUri}`);
    }

    // 2. ECS with custom endpoint
    const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    if (fullUri) {
      return this.fetchEcsCredentials(fullUri);
    }

    // 3. Environment variables
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      return {
        accessKeyId,
        secretAccessKey,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    throw new Error(
      "No AWS credentials found. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, " +
        "or run in ECS/Fargate with a task role.",
    );
  }

  private async fetchEcsCredentials(endpoint: string): Promise<AwsCredentials> {
    const headers: Record<string, string> = {};
    const authToken = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    if (authToken) {
      headers["Authorization"] = authToken;
    }

    const res = await globalThis.fetch(endpoint, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch ECS credentials: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      AccessKeyId: string;
      SecretAccessKey: string;
      Token?: string;
      Expiration?: string;
    };

    const creds: AwsCredentials = {
      accessKeyId: data.AccessKeyId,
      secretAccessKey: data.SecretAccessKey,
      sessionToken: data.Token,
    };

    if (data.Expiration) {
      this.cachedCredentials = {
        creds,
        expiresAt: new Date(data.Expiration).getTime(),
      };
    }

    return creds;
  }
}

// ── SigV4 signing (minimal, S3 GetObject only) ─────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf-8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}

function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function toDateStamp(date: Date): string {
  return toAmzDate(date).slice(0, 8);
}

/** Encode S3 key segments (preserve `/`). */
function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * Produce signed headers for an S3 GET request using AWS Signature Version 4.
 * Returns a plain object suitable for the `fetch` headers option.
 */
function signS3GetRequest(
  host: string,
  path: string,
  region: string,
  creds: AwsCredentials,
  now: Date,
): Record<string, string> {
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const service = "s3";
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  // Headers to sign
  const headers: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
  };
  if (creds.sessionToken) {
    headers["x-amz-security-token"] = creds.sessionToken;
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");

  // Canonical request
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = [
    "GET",
    path,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  // String to sign
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  // Signing key
  const kDate = hmacSha256(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");

  // Signature
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  // Authorization header
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    Authorization: authorization,
  };
}
