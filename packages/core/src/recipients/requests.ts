import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";

export const REQUESTS_FILENAME = ".clef-requests.yaml";

const HEADER_COMMENT =
  "# Pending recipient access requests. Approve with: clef recipients approve <label>\n";

export interface RecipientRequest {
  key: string;
  label: string;
  requestedAt: Date;
  environment?: string;
}

interface RawRequest {
  key: string;
  label: string;
  requested_at: string;
  environment?: string;
}

export function requestsFilePath(repoRoot: string): string {
  return path.join(repoRoot, REQUESTS_FILENAME);
}

/** Load all pending requests. Returns empty array if file is missing or malformed. */
export function loadRequests(repoRoot: string): RecipientRequest[] {
  const filePath = requestsFilePath(repoRoot);
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(content);
    if (!parsed || !Array.isArray(parsed.requests)) return [];
    return parsed.requests.map((r: RawRequest) => ({
      key: r.key,
      label: r.label,
      requestedAt: new Date(r.requested_at),
      environment: r.environment,
    }));
  } catch {
    return [];
  }
}

/** Save requests to disk. Deletes the file if no requests remain. */
export function saveRequests(repoRoot: string, requests: RecipientRequest[]): void {
  const filePath = requestsFilePath(repoRoot);
  if (requests.length === 0) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist
    }
    return;
  }
  const data = {
    requests: requests.map((r) => {
      const raw: RawRequest = {
        key: r.key,
        label: r.label,
        requested_at: r.requestedAt.toISOString(),
      };
      if (r.environment) raw.environment = r.environment;
      return raw;
    }),
  };
  fs.writeFileSync(filePath, HEADER_COMMENT + YAML.stringify(data), "utf-8");
}

/**
 * Add or update a request. If a request with the same key already exists,
 * update its label, timestamp, and environment. Returns the upserted request.
 */
export function upsertRequest(
  repoRoot: string,
  key: string,
  label: string,
  environment?: string,
): RecipientRequest {
  const requests = loadRequests(repoRoot);
  const now = new Date();
  const request: RecipientRequest = { key, label, requestedAt: now, environment };

  const existingIndex = requests.findIndex((r) => r.key === key);
  if (existingIndex >= 0) {
    requests[existingIndex] = request;
  } else {
    requests.push(request);
  }

  saveRequests(repoRoot, requests);
  return request;
}

/**
 * Remove a request by matching against label (case-insensitive) or key (exact).
 * Returns the removed request, or null if not found.
 */
export function removeRequest(repoRoot: string, identifier: string): RecipientRequest | null {
  const requests = loadRequests(repoRoot);
  const match = findInList(requests, identifier);
  if (!match) return null;

  const filtered = requests.filter((r) => r.key !== match.key);
  saveRequests(repoRoot, filtered);
  return match;
}

/**
 * Find a request by label (case-insensitive) or key (exact match).
 * Returns null if not found.
 */
export function findRequest(repoRoot: string, identifier: string): RecipientRequest | null {
  const requests = loadRequests(repoRoot);
  return findInList(requests, identifier);
}

function findInList(requests: RecipientRequest[], identifier: string): RecipientRequest | null {
  const lower = identifier.toLowerCase();
  // Match by label (case-insensitive)
  const byLabel = requests.find((r) => r.label.toLowerCase() === lower);
  if (byLabel) return byLabel;
  // Match by key (exact)
  const byKey = requests.find((r) => r.key === identifier);
  return byKey ?? null;
}
