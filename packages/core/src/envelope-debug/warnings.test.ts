import { REVEAL_WARNING, formatRevealWarning } from "./warnings";

describe("REVEAL_WARNING (all-values variant)", () => {
  it("starts with the 'WARNING:' prefix so it's scannable in logs", () => {
    expect(REVEAL_WARNING.startsWith("WARNING: ")).toBe(true);
  });

  it("uses the generic 'plaintext will be printed' phrasing", () => {
    expect(REVEAL_WARNING).toContain("plaintext will be printed to stdout");
    expect(REVEAL_WARNING).not.toContain('for key "');
  });

  it("mentions the capture-surface risk (shell history + scrollback)", () => {
    expect(REVEAL_WARNING).toMatch(/shell history/i);
    expect(REVEAL_WARNING).toMatch(/scrollback/i);
  });

  it("closes with a trust-posture nudge, not a 'redirect with care' line", () => {
    expect(REVEAL_WARNING).toMatch(/Proceed only if this terminal/);
    expect(REVEAL_WARNING).not.toMatch(/Redirect with care/);
  });
});

describe("formatRevealWarning", () => {
  it("returns REVEAL_WARNING verbatim when no key is supplied", () => {
    expect(formatRevealWarning()).toBe(REVEAL_WARNING);
    expect(formatRevealWarning(undefined)).toBe(REVEAL_WARNING);
  });

  it("names the key when supplied", () => {
    const w = formatRevealWarning("DB_URL");
    expect(w).toMatch(/^WARNING: /);
    expect(w).toContain('value for key "DB_URL" will be printed to stdout');
    expect(w).not.toContain("plaintext will be printed");
  });

  it("preserves the capture-surface and trust-posture tail in the key variant", () => {
    const w = formatRevealWarning("API_KEY");
    expect(w).toMatch(/shell history/i);
    expect(w).toMatch(/scrollback/i);
    expect(w).toMatch(/Proceed only if this terminal/);
  });
});
