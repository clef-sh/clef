import { REVEAL_WARNING } from "./warnings";

describe("REVEAL_WARNING", () => {
  it("starts with the 'WARNING:' prefix so it's scannable in logs", () => {
    expect(REVEAL_WARNING.startsWith("WARNING: ")).toBe(true);
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
