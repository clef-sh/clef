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

export async function generateAgeIdentity(): Promise<AgeIdentity> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ESM import of CJS-incompatible package
  const { generateIdentity, identityToRecipient } = await import("age-encryption" as any);
  const privateKey = (await generateIdentity()) as string;
  const publicKey = identityToRecipient(privateKey) as string;
  return { privateKey, publicKey };
}

export function formatAgeKeyFile(privateKey: string, publicKey: string): string {
  const now = new Date().toISOString();
  return `# created: ${now}\n# public key: ${publicKey}\n${privateKey}\n`;
}
