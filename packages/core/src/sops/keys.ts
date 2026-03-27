import * as fs from "fs";
import * as YAML from "yaml";

/**
 * Read top-level key names from a SOPS-encrypted YAML file without decryption.
 * SOPS stores key names in plaintext — only values are encrypted.
 * Filters out the `sops` metadata key.
 *
 * @returns Array of key names, or `null` if the file cannot be read or parsed.
 */
export function readSopsKeyNames(filePath: string): string[] | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw);
    if (parsed === null || parsed === undefined || typeof parsed !== "object") return null;
    return Object.keys(parsed as Record<string, unknown>).filter((k) => k !== "sops");
  } catch {
    return null;
  }
}
