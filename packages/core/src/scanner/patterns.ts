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
