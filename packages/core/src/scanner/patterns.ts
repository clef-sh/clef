/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
export interface ScanMatch {
  file: string;
  line: number;
  column: number;
  matchType: "pattern" | "entropy";
  patternName?: string;
  entropy?: number;
  preview: string;
}

interface PatternDef {
  name: string;
  regex: RegExp;
}

const PATTERNS: PatternDef[] = [
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "Stripe live key", regex: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: "Stripe test key", regex: /sk_test_[0-9a-zA-Z]{24,}/ },
  { name: "GitHub personal access token", regex: /ghp_[0-9a-zA-Z]{36}/ },
  { name: "GitHub OAuth token", regex: /gho_[0-9a-zA-Z]{36}/ },
  { name: "GitHub Actions token", regex: /ghs_[0-9a-zA-Z]{36}/ },
  { name: "Slack token", regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/ },
  {
    name: "Private key header",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "Generic API key",
    regex: /(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN)\s*=\s*\S{8,}/,
  },
  { name: "Database URL", regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/ },
];

interface PublicPrefixDef {
  name: string;
  regex: RegExp;
}

// Credential-shaped values that are public by design.  These ship to the
// browser in HTML/JS — flagging them as leaked secrets is a false positive.
// Kept narrow on purpose: each entry must be unambiguous that it is client-
// facing, not a backend secret.
const PUBLIC_PREFIX_PATTERNS: PublicPrefixDef[] = [
  // reCAPTCHA v2, v3, and Enterprise site keys are exactly 40 chars and
  // begin with 6L[c-f]. Site keys are designed to be embedded in HTML.
  // https://developers.google.com/recaptcha/docs/faq
  { name: "reCAPTCHA site key", regex: /^6L[c-f][0-9A-Za-z_-]{37}$/ },
  // Stripe publishable keys (client-side, distinct from sk_live_/sk_test_).
  { name: "Stripe publishable key", regex: /^pk_(?:live|test)_[0-9a-zA-Z]{24,}$/ },
];

/**
 * Returns a matching public-prefix definition if the value is a known
 * client-facing credential shape (reCAPTCHA site key, Stripe publishable
 * key, etc.).  `null` when the value is not recognized as public.
 *
 * Used by the entropy detector to avoid false positives on strings that are
 * public by design.  The check is intentionally conservative — patterns are
 * anchored (`^...$`) so partial matches do not qualify.
 */
export function matchPublicPrefix(value: string): { name: string } | null {
  for (const def of PUBLIC_PREFIX_PATTERNS) {
    if (def.regex.test(value)) return { name: def.name };
  }
  return null;
}

/**
 * Calculate Shannon entropy (bits per character) of a string.
 */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of str) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Returns true if a string has sufficiently high entropy to be considered a potential secret.
 * Threshold: > 4.5 bits/char, minimum 20 characters.
 */
export function isHighEntropy(value: string, threshold = 4.5, minLength = 20): boolean {
  return value.length >= minLength && shannonEntropy(value) > threshold;
}

/**
 * Redact a matched secret value — show first 4 characters, mask the rest.
 * Never exposes more than 4 characters of any secret.
 */
export function redactValue(value: string): string {
  if (value.length <= 4) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return value.slice(0, 4) + "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
}

/**
 * Match a line against all known secret patterns.
 * Returns one ScanMatch per matched pattern.
 */
export function matchPatterns(line: string, lineNumber: number, filePath: string): ScanMatch[] {
  const matches: ScanMatch[] = [];
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(line);
    if (match) {
      matches.push({
        file: filePath,
        line: lineNumber,
        column: match.index + 1,
        matchType: "pattern",
        patternName: name,
        preview: redactValue(match[0]),
      });
    }
  }
  return matches;
}
