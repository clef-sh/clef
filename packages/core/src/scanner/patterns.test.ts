import { shannonEntropy, isHighEntropy, matchPatterns, redactValue } from "./patterns";

describe("shannonEntropy", () => {
  it("returns 0 for an empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for a single repeated character", () => {
    expect(shannonEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(0);
  });

  it("returns high entropy for a random hex string", () => {
    // 16 possible chars → max 4 bits/char, a random 32-char hex approaches 4.0
    const hex = "deadbeef12345678deadbeef12345678";
    const result = shannonEntropy(hex);
    expect(result).toBeGreaterThan(3.5);
  });

  it("returns high entropy for a random base64-like string", () => {
    const b64 = "4xK9mQ2pLv8nR3wZaT7cBhJqYdEsFgHu";
    const result = shannonEntropy(b64);
    expect(result).toBeGreaterThan(4.5);
  });

  it("returns medium entropy for a natural language sentence", () => {
    const sentence = "the quick brown fox jumps over the lazy dog";
    const result = shannonEntropy(sentence);
    // Natural language is typically 3-4 bits/char
    expect(result).toBeGreaterThan(2.5);
    expect(result).toBeLessThan(4.5);
  });

  it("returns medium entropy for a URL", () => {
    const url = "https://example.com/api/v1/endpoint";
    const result = shannonEntropy(url);
    expect(result).toBeGreaterThan(3.0);
    expect(result).toBeLessThan(4.5);
  });
});

describe("isHighEntropy", () => {
  it("returns true for a high-entropy value above threshold", () => {
    const secret = "4xK9mQ2pLv8nR3wZaT7cBhJqYdEsFgHu";
    expect(isHighEntropy(secret)).toBe(true);
  });

  it("returns false for a low-entropy value (repeated char)", () => {
    expect(isHighEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("returns false for a value below minimum length", () => {
    // High entropy but too short
    expect(isHighEntropy("xK9mQ2pL")).toBe(false);
  });

  it("returns false for natural language", () => {
    expect(isHighEntropy("the quick brown fox jumps over")).toBe(false);
  });

  it("respects custom threshold", () => {
    const mid = "deadbeef12345678deadbeef12345678"; // ~3.8 bits
    expect(isHighEntropy(mid, 3.0)).toBe(true);
    expect(isHighEntropy(mid, 4.5)).toBe(false);
  });

  it("respects custom minLength", () => {
    // Use a string known to be high entropy: base64 random chars
    const val = "aB3cD9eF7gH2iJ"; // 14 chars, high entropy
    expect(isHighEntropy(val, 3.0, 10)).toBe(true);
    expect(isHighEntropy(val, 3.0, 20)).toBe(false);
  });
});

describe("redactValue", () => {
  it("shows first 4 characters followed by bullet mask", () => {
    const result = redactValue("sk_live_abc123xyz");
    expect(result).toBe("sk_l\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
  });

  it("never exposes more than 4 characters of the secret", () => {
    const secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const preview = redactValue(secret);
    expect(preview.replace(/\u2022/g, "")).toHaveLength(4);
    expect(preview).not.toContain(secret.slice(4));
  });

  it("masks values of 4 or fewer characters entirely", () => {
    expect(redactValue("abc")).toBe("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
    expect(redactValue("abcd")).toBe("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
  });
});

describe("matchPatterns", () => {
  const file = "src/config.ts";

  it("matches AWS access key", () => {
    const line = 'const key = "AKIAIOSFODNN7EXAMPLE"';
    const matches = matchPatterns(line, 1, file);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternName).toBe("AWS access key");
    expect(matches[0].matchType).toBe("pattern");
    expect(matches[0].line).toBe(1);
    // Preview must not contain the full secret
    expect(matches[0].preview).not.toBe("AKIAIOSFODNN7EXAMPLE");
    expect(matches[0].preview).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("does not match an arbitrary uppercase string as AWS key", () => {
    const line = "const FOO = NOTANAWSKEYATALLXYZ";
    const matches = matchPatterns(line, 1, file);
    const awsMatches = matches.filter((m) => m.patternName === "AWS access key");
    expect(awsMatches).toHaveLength(0);
  });

  it("matches Stripe live key", () => {
    const line = 'STRIPE_KEY = "sk_live_4eC39HqLyjWDarjtT1zdp7dc"';
    const matches = matchPatterns(line, 5, file);
    const stripe = matches.find((m) => m.patternName === "Stripe live key");
    expect(stripe).toBeDefined();
    expect(stripe!.line).toBe(5);
    expect(stripe!.preview).not.toContain("4eC39HqLyjWDarjtT1zdp7dc");
  });

  it("matches Stripe test key", () => {
    const line = "const key = sk_test_4eC39HqLyjWDarjtT1zdp7dc;";
    const matches = matchPatterns(line, 1, file);
    const stripe = matches.find((m) => m.patternName === "Stripe test key");
    expect(stripe).toBeDefined();
  });

  it("does not match a non-Stripe string", () => {
    const line = "const value = sk_not_a_real_stripe_key_at_all_definitely";
    const matches = matchPatterns(line, 1, file);
    const stripe = matches.find(
      (m) => m.patternName === "Stripe live key" || m.patternName === "Stripe test key",
    );
    expect(stripe).toBeUndefined();
  });

  it("matches GitHub personal access token (ghp_)", () => {
    const line = "token: ghp_16C7e42F292c6912E7710c838347Ae178B4a";
    const matches = matchPatterns(line, 1, file);
    const gh = matches.find((m) => m.patternName === "GitHub personal access token");
    expect(gh).toBeDefined();
  });

  it("matches GitHub OAuth token (gho_)", () => {
    const line = "auth_token = gho_16C7e42F292c6912E7710c838347Ae178B4a";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "GitHub OAuth token")).toBe(true);
  });

  it("matches GitHub Actions token (ghs_)", () => {
    const line = "GITHUB_TOKEN=ghs_16C7e42F292c6912E7710c838347Ae178B4a";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "GitHub Actions token")).toBe(true);
  });

  it("matches Slack token", () => {
    const line = 'slack_token: "xoxb-2048-352-1234567890abcdef"';
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Slack token")).toBe(true);
  });

  it("matches private key header", () => {
    const line = "-----BEGIN RSA PRIVATE KEY-----";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Private key header")).toBe(true);
  });

  it("matches OPENSSH private key header", () => {
    const line = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Private key header")).toBe(true);
  });

  it("matches generic API key assignment", () => {
    const line = "API_KEY=mysecretapikey";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Generic API key")).toBe(true);
  });

  it("matches generic SECRET_KEY", () => {
    const line = "SECRET_KEY = supersecretvalue123";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Generic API key")).toBe(true);
  });

  it("matches database URL with credentials", () => {
    const line = "DATABASE_URL=postgres://user:password@localhost:5432/db";
    const matches = matchPatterns(line, 1, file);
    expect(matches.some((m) => m.patternName === "Database URL")).toBe(true);
  });

  it("does not match a database URL without credentials", () => {
    const line = "DATABASE_URL=postgres://localhost:5432/db";
    const matches = matchPatterns(line, 1, file);
    const dbMatch = matches.find((m) => m.patternName === "Database URL");
    expect(dbMatch).toBeUndefined();
  });

  it("returns column number of the match", () => {
    const line = '    const key = "AKIAIOSFODNN7EXAMPLE"';
    const matches = matchPatterns(line, 3, file);
    expect(matches[0].column).toBeGreaterThan(1);
  });

  it("sets file path correctly on all matches", () => {
    const line = "API_KEY=mysecretapikey";
    const matches = matchPatterns(line, 1, "config/prod.ts");
    expect(matches[0].file).toBe("config/prod.ts");
  });

  it("preview does not contain the full matched secret value", () => {
    const fullSecret = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
    const line = `STRIPE_KEY="${fullSecret}"`;
    const matches = matchPatterns(line, 1, file);
    const stripe = matches.find((m) => m.patternName === "Stripe live key");
    expect(stripe).toBeDefined();
    expect(stripe!.preview).not.toContain(fullSecret);
    expect(stripe!.preview).not.toContain(fullSecret.slice(4));
  });
});
