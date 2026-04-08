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

  const refreshToken = typeof obj.refreshToken === "string" ? obj.refreshToken : "";
  const accessToken = typeof obj.accessToken === "string" ? obj.accessToken : undefined;
  const accessTokenExpiry =
    typeof obj.accessTokenExpiry === "number" ? obj.accessTokenExpiry : undefined;
  const endpoint = typeof obj.endpoint === "string" ? obj.endpoint : CLOUD_DEFAULT_ENDPOINT;
  const cognitoDomain = typeof obj.cognitoDomain === "string" ? obj.cognitoDomain : undefined;
  const clientId = typeof obj.clientId === "string" ? obj.clientId : undefined;

  if (!refreshToken && endpoint === CLOUD_DEFAULT_ENDPOINT) return null;

  return { refreshToken, accessToken, accessTokenExpiry, endpoint, cognitoDomain, clientId };
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

  const content = Object.fromEntries(
    Object.entries(credentials).filter(([, v]) => v !== undefined),
  );

  fs.writeFileSync(credPath, YAML.stringify(content), { mode: 0o600 });
}
