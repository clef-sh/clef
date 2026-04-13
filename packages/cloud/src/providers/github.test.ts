import { resolveAuthProvider, DEFAULT_PROVIDER, PROVIDER_IDS, gitHubAuthProvider } from "./index";

describe("provider registry", () => {
  it("default provider is github", () => {
    expect(DEFAULT_PROVIDER).toBe("github");
  });

  it("PROVIDER_IDS includes github", () => {
    expect(PROVIDER_IDS).toContain("github");
  });

  it("resolves github provider", () => {
    const provider = resolveAuthProvider("github");
    expect(provider.id).toBe("github");
    expect(provider.displayName).toBe("GitHub");
  });

  it("throws for unknown provider", () => {
    expect(() => resolveAuthProvider("svn")).toThrow('Unknown provider "svn"');
    expect(() => resolveAuthProvider("svn")).toThrow("Available providers:");
  });

  it("gitHubAuthProvider has correct identity", () => {
    expect(gitHubAuthProvider.id).toBe("github");
    expect(gitHubAuthProvider.displayName).toBe("GitHub");
    expect(typeof gitHubAuthProvider.login).toBe("function");
  });
});
