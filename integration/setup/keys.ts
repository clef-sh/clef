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
 * Generate a real age key pair for integration tests using the age-encryption npm package.
 * Returns the public key, private key content, and path to the key file.
 */
export async function generateAgeKey(): Promise<AgeKeyPair> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-int-"));
  const keyFilePath = path.join(tmpDir, "key.txt");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { generateIdentity, identityToRecipient } = (await import("age-encryption")) as any;
  const privateKey = (await generateIdentity()) as string;
  const publicKey = identityToRecipient(privateKey) as string;

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
