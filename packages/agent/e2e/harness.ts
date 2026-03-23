/**
 * E2E test harness for the Clef agent.
 *
 * Provides helpers to generate age keys, create encrypted artifacts,
 * and start a real agent server backed by a FileArtifactSource.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

export interface AgeKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface TestArtifact {
  path: string;
  json: string;
}

export interface TestFixture {
  keys: AgeKeyPair;
  artifactDir: string;
  artifactPath: string;
  cleanup: () => void;
}

const HELPERS_DIR = path.resolve(__dirname, "helpers");

/**
 * Generate a real age key pair via the ESM subprocess helper.
 */
export function generateAgeKey(): AgeKeyPair {
  const helperPath = path.join(HELPERS_DIR, "age-keygen.mjs");
  const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
  return JSON.parse(result) as AgeKeyPair;
}

/**
 * Create an age-encrypted packed artifact containing the given secrets.
 */
export function createArtifact(
  publicKey: string,
  secrets: Record<string, string>,
  options?: { revision?: string; expiresAt?: string; revokedAt?: string },
): string {
  const helperPath = path.join(HELPERS_DIR, "create-artifact.mjs");
  const args = [helperPath, publicKey, JSON.stringify(secrets)];
  if (options?.revision) args.push(options.revision);
  else args.push("rev-001");
  if (options?.expiresAt) args.push(options.expiresAt);
  else args.push(""); // placeholder
  if (options?.revokedAt) args.push(options.revokedAt);

  const result = execFileSync(process.execPath, args, { encoding: "utf-8" });
  return result;
}

/**
 * Scaffold a complete test fixture: keys, artifact file, temp directory.
 */
export function scaffoldFixture(secrets: Record<string, string>): TestFixture {
  const keys = generateAgeKey();
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-agent-e2e-"));
  const artifactPath = path.join(artifactDir, "artifact.json");

  const artifactJson = createArtifact(keys.publicKey, secrets);
  fs.writeFileSync(artifactPath, artifactJson);

  return {
    keys,
    artifactDir,
    artifactPath,
    cleanup: () => {
      try {
        fs.rmSync(artifactDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    },
  };
}

/**
 * Helper to make HTTP requests to the agent.
 */
export async function agentFetch(
  baseUrl: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Host: new URL(baseUrl).host,
    // Disable keep-alive — on Windows, idle keep-alive connections cause
    // ECONNRESET when the agent subprocess is killed during teardown.
    Connection: "close",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}
