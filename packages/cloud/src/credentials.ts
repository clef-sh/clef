import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as YAML from "yaml";
import type { ClefCloudCredentials } from "./types";
import { CLOUD_DEFAULT_ENDPOINT } from "./constants";

const CREDENTIALS_FILENAME = "credentials.yaml";

/**
 * Read Cloud credentials from ~/.clef/credentials.yaml.
 * Returns null if the file does not exist or is malformed.
 */
export function readCloudCredentials(): ClefCloudCredentials | null {
  const credPath = path.join(os.homedir(), ".clef", CREDENTIALS_FILENAME);

  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(credPath, "utf-8"));
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // Token may be absent before first login — endpoint should still be readable
  const token = typeof obj.token === "string" && obj.token.length > 0 ? obj.token : "";
  const endpoint = typeof obj.endpoint === "string" ? obj.endpoint : CLOUD_DEFAULT_ENDPOINT;

  // Return null only if neither token nor custom endpoint is present
  if (!token && endpoint === CLOUD_DEFAULT_ENDPOINT) return null;

  return { token, endpoint };
}

/**
 * Write Cloud credentials to ~/.clef/credentials.yaml.
 * Creates ~/.clef/ with mode 0700 if it doesn't exist.
 * File is written with mode 0600 (owner read/write only).
 */
export function writeCloudCredentials(credentials: ClefCloudCredentials): void {
  const clefDir = path.join(os.homedir(), ".clef");
  fs.mkdirSync(clefDir, { recursive: true, mode: 0o700 });
  const credPath = path.join(clefDir, CREDENTIALS_FILENAME);
  const content: Record<string, string> = { token: credentials.token };
  if (credentials.endpoint) {
    content.endpoint = credentials.endpoint;
  }
  fs.writeFileSync(credPath, YAML.stringify(content), { mode: 0o600 });
}
