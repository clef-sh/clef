/**
 * age key generation using the age-encryption npm package.
 * Dynamic import() is required: age-encryption is ESM-only; this package compiles to CJS.
 */

export interface AgeIdentity {
  /** AGE-SECRET-KEY-1... armored private key string */
  privateKey: string;
  /** age1... bech32 public key string */
  publicKey: string;
}

/**
 * Generate a new age key pair using the `age-encryption` npm package.
 *
 * @returns Private key (`AGE-SECRET-KEY-1...` format) and derived public key (`age1...` bech32 format).
 */
export async function generateAgeIdentity(): Promise<AgeIdentity> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
  const { generateIdentity, identityToRecipient } = await import("age-encryption" as any);
  const privateKey = (await generateIdentity()) as string;
  const publicKey = (await identityToRecipient(privateKey)) as string;
  return { privateKey, publicKey };
}

/**
 * Derive the age public key (`age1...`) from an existing private key (`AGE-SECRET-KEY-1...`).
 */
export async function deriveAgePublicKey(privateKey: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
  const { identityToRecipient } = await import("age-encryption" as any);
  return (await identityToRecipient(privateKey)) as string;
}

/**
 * Format an age private key and public key into the standard key file format.
 * The output includes a `created` timestamp comment and is ready to write to disk.
 *
 * @param privateKey - `AGE-SECRET-KEY-1...` armored private key string.
 * @param publicKey - `age1...` bech32 public key string.
 */
export function formatAgeKeyFile(privateKey: string, publicKey: string): string {
  const now = new Date().toISOString();
  return `# created: ${now}\n# public key: ${publicKey}\n${privateKey}\n`;
}
