import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

export interface AgeKeyPair {
  publicKey: string;
  privateKey: string;
  keyFilePath: string;
  tmpDir: string;
}

/**
 * Generate a real age key pair for integration tests.
 *
 * age-encryption is ESM-only and cannot be loaded directly by Jest (which runs in CJS mode).
 * Instead we spawn a Node.js subprocess that loads the helper as ESM and writes JSON to stdout.
 */
export async function generateAgeKey(): Promise<AgeKeyPair> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-int-"));
  const keyFilePath = path.join(tmpDir, "key.txt");

  const helperPath = path.resolve(__dirname, "age-keygen-helper.mjs");
  const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
  const { privateKey, publicKey } = JSON.parse(result) as { privateKey: string; publicKey: string };

  const now = new Date().toISOString();
  const keyContent = `# created: ${now}\n# public key: ${publicKey}\n${privateKey}\n`;

  fs.writeFileSync(keyFilePath, keyContent, "utf-8");

  return {
    publicKey,
    privateKey: keyContent,
    keyFilePath,
    tmpDir,
  };
}

/**
 * Check if sops is available in PATH.
 */
export function checkSopsAvailable(): void {
  if (!isSopsAvailable()) {
    throw new Error(
      "sops not found. Install sops to run integration tests:\n" +
        "  brew install sops  (macOS)\n" +
        "  See https://github.com/getsops/sops/releases  (Linux)\n",
    );
  }
}

/**
 * Returns true if sops is installed and available in PATH.
 * Use for conditional test skipping.
 */
export function isSopsAvailable(): boolean {
  try {
    execFileSync("sops", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
