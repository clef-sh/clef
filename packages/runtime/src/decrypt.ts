import * as fs from "fs";

/**
 * Decrypts age-encrypted ciphertext using the age-encryption npm package.
 *
 * Follows the same dynamic import pattern as the bundle runtime to handle
 * the ESM-only age-encryption package from CJS context.
 */
export class AgeDecryptor {
  /**
   * Decrypt an age-encrypted PEM-armored ciphertext string.
   *
   * @param ciphertext - PEM-armored age ciphertext.
   * @param privateKey - Age private key string (AGE-SECRET-KEY-...).
   * @returns The decrypted plaintext string.
   */
  async decrypt(ciphertext: string, privateKey: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
    const { Decrypter } = await import("age-encryption" as any);
    const d = new Decrypter();
    d.addIdentity(privateKey);

    // age binary format cannot survive JSON string round-trip (TextDecoder loses
    // high bytes). If the ciphertext looks like base64 (no age PEM header),
    // decode to a Buffer so the age library receives intact bytes.
    const isAgePem = ciphertext.startsWith("age-encryption.org/v1\n");
    const input = isAgePem
      ? ciphertext
      : Buffer.from(ciphertext, "base64");
    return d.decrypt(input, "text");
  }

  /**
   * Resolve the age private key from either an inline value or a file path.
   *
   * @param ageKey - Inline age private key, if set.
   * @param ageKeyFile - Path to age key file, if set.
   * @returns The age private key string.
   */
  resolveKey(ageKey?: string, ageKeyFile?: string): string {
    if (ageKey) return ageKey.trim();
    if (ageKeyFile) {
      const content = fs.readFileSync(ageKeyFile, "utf-8").trim();
      // age key files can contain comments — extract the actual key line
      const lines = content.split("\n").filter((l) => l.startsWith("AGE-SECRET-KEY-"));
      if (lines.length === 0) {
        throw new Error(`No age secret key found in file: ${ageKeyFile}`);
      }
      return lines[0].trim();
    }
    throw new Error("No age key available. Set CLEF_AGE_KEY or CLEF_AGE_KEY_FILE.");
  }
}
