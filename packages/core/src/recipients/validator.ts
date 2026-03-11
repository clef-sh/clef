export interface AgeKeyValidation {
  valid: boolean;
  key?: string;
  error?: string;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const AGE_PREFIX = "age1";
const MIN_LENGTH = 10;

export function validateAgePublicKey(input: string): AgeKeyValidation {
  const trimmed = input.trim();

  if (!trimmed.startsWith(AGE_PREFIX)) {
    return {
      valid: false,
      error: `Age public key must start with '${AGE_PREFIX}'. Got: '${trimmed.slice(0, 10)}...'`,
    };
  }

  if (trimmed.length < MIN_LENGTH) {
    return {
      valid: false,
      error: `Age public key is too short. Expected at least ${MIN_LENGTH} characters, got ${trimmed.length}.`,
    };
  }

  const body = trimmed.slice(AGE_PREFIX.length);
  for (const ch of body) {
    if (!BECH32_CHARSET.includes(ch)) {
      return {
        valid: false,
        error: `Invalid character '${ch}' in age public key. Only bech32 characters are allowed after the 'age1' prefix.`,
      };
    }
  }

  return { valid: true, key: trimmed };
}

export function keyPreview(key: string): string {
  const last8 = key.slice(-8);
  return `age1\u2026${last8}`;
}
