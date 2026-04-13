import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ClefCloudCredentials } from "./types";

const CREDENTIALS_FILENAME = "cloud-credentials.json";

/**
 * Read Cloud credentials from ~/.clef/cloud-credentials.json.
 * Returns null if the file does not exist or is malformed.
 */
export function readCloudCredentials(): ClefCloudCredentials | null {
  const credPath = path.join(os.homedir(), ".clef", CREDENTIALS_FILENAME);

  let raw: string;
  try {
    raw = fs.readFileSync(credPath, "utf-8");
  } catch {
    return null;
  }

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object") return null;
  const data = obj as Record<string, unknown>;

  const sessionToken = typeof data.session_token === "string" ? data.session_token : "";
  if (!sessionToken) return null;

  const provider = typeof data.provider === "string" ? data.provider : "github";

  return {
    session_token: sessionToken,
    login: typeof data.login === "string" ? data.login : "",
    email: typeof data.email === "string" ? data.email : "",
    expires_at: typeof data.expires_at === "string" ? data.expires_at : "",
    base_url: typeof data.base_url === "string" ? data.base_url : "",
    provider: provider as "github" | "gitlab" | "bitbucket",
  };
}

/**
 * Write Cloud credentials to ~/.clef/cloud-credentials.json.
 * Creates ~/.clef/ with mode 0700 if it doesn't exist.
 * File is written with mode 0600 (owner read/write only).
 */
export function writeCloudCredentials(credentials: ClefCloudCredentials): void {
  const clefDir = path.join(os.homedir(), ".clef");
  fs.mkdirSync(clefDir, { recursive: true, mode: 0o700 });
  const credPath = path.join(clefDir, CREDENTIALS_FILENAME);
  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Delete Cloud credentials from ~/.clef/cloud-credentials.json.
 * No-op if the file does not exist.
 */
export function deleteCloudCredentials(): void {
  const credPath = path.join(os.homedir(), ".clef", CREDENTIALS_FILENAME);
  try {
    fs.unlinkSync(credPath);
  } catch {
    // File doesn't exist — nothing to do
  }
}

/**
 * Check whether the stored session token is expired.
 */
export function isSessionExpired(credentials: ClefCloudCredentials): boolean {
  if (!credentials.expires_at) return true;
  return new Date(credentials.expires_at).getTime() <= Date.now();
}
