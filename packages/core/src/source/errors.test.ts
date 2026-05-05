import { ClefError } from "../types";
import { SourceCapabilityUnsupportedError } from "./errors";

describe("SourceCapabilityUnsupportedError", () => {
  it("extends ClefError so it inherits Clef's error contract", () => {
    const err = new SourceCapabilityUnsupportedError("rotate", "postgres");
    expect(err).toBeInstanceOf(ClefError);
    expect(err).toBeInstanceOf(Error);
  });

  it("includes the capability and source id in its message", () => {
    const err = new SourceCapabilityUnsupportedError("rotate", "postgres");
    expect(err.message).toContain("rotate");
    expect(err.message).toContain("postgres");
  });

  it("exposes the capability and source id as fields for programmatic handling", () => {
    const err = new SourceCapabilityUnsupportedError("recipients", "git-sops");
    expect(err.capability).toBe("recipients");
    expect(err.sourceId).toBe("git-sops");
  });

  it("provides a fix hint pointing at the next user step", () => {
    const err = new SourceCapabilityUnsupportedError("merge", "postgres");
    expect(err.fix).toBeDefined();
    expect(err.fix).toContain("merge");
  });
});
