import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AgeKeyPair {
  publicKey: string;
  privateKey: string;
  keyFilePath: string;
  tmpDir: string;
}

/**
 * Generate a real age key pair for integration tests.
 * Returns the public key, private key content, and path to the key file.
 */
export function generateAgeKey(): AgeKeyPair {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-int-"));
  const keyFilePath = path.join(tmpDir, "key.txt");

  try {
    execFileSync("age-keygen", ["-o", keyFilePath], { stdio: "pipe" });
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      "age-keygen not found. Install age to run integration tests:\n" +
        "  brew install age  (macOS)\n" +
        "  apt install age   (Linux)\n\n" +
        `Original error: ${(err as Error).message}`,
    );
  }

  const keyContent = fs.readFileSync(keyFilePath, "utf-8");

  // Extract public key from the comment line: # public key: age1...
  const publicKeyMatch = keyContent.match(/# public key: (age1\S+)/);
  if (!publicKeyMatch) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error("Could not extract public key from age-keygen output");
  }

  return {
    publicKey: publicKeyMatch[1],
    privateKey: keyContent,
    keyFilePath,
    tmpDir,
  };
}

/**
 * Check if sops is available in PATH.
 */
export function checkSopsAvailable(): void {
  try {
    execFileSync("sops", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "sops not found. Install sops to run integration tests:\n" +
        "  brew install sops  (macOS)\n" +
        "  See https://github.com/getsops/sops/releases  (Linux)\n",
    );
  }
}
