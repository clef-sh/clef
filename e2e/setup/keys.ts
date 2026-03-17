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
 * Generate a real age key pair for e2e tests.
 *
 * age-encryption is ESM-only and cannot be loaded directly by the CJS test
 * environment. Instead we spawn a Node.js subprocess that loads the helper as
 * ESM and writes JSON to stdout.
 */
export async function generateAgeKey(): Promise<AgeKeyPair> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-e2e-"));
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
