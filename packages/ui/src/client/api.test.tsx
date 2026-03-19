/**
 * Tests for client/api.ts — session token management and apiFetch wrapper.
 *
 * Each test gets a fresh module instance via jest.resetModules() so the
 * module-level `sessionToken` variable always starts as null.
 */

describe("client/api module", () => {
  let mod: typeof import("./api");

  beforeEach(() => {
    // Reset module registry so sessionToken starts as null for every test
    jest.resetModules();
    // Reset URL to a clean baseline
    window.history.replaceState({}, "", "/");
    // Clear sessionStorage so token state is clean
    sessionStorage.clear();
    // Get a fresh module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("./api") as typeof import("./api");
    // Stub global fetch (jsdom does not provide a Response global)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
  });

  describe("initToken()", () => {
    it("should do nothing when the URL has no token parameter", () => {
      // No ?token= in the URL — should not throw and should leave sessionToken null
      mod.initToken();
      mod.apiFetch("/api/test");
      const [, callInit] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = callInit.headers as Headers;
      expect(headers.get("Authorization")).toBeNull();
    });

    it("should extract the token from the URL query string", () => {
      window.history.pushState({}, "", "/?token=abc123");
      mod.initToken();
      // After initToken the token should be forwarded in apiFetch
      mod.apiFetch("/api/test");
      const [, callInit] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = callInit.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer abc123");
    });

    it("should remove the token from the URL after extracting it", () => {
      window.history.pushState({}, "", "/?token=abc123");
      const replaceSpy = jest.spyOn(window.history, "replaceState");
      mod.initToken();
      expect(replaceSpy).toHaveBeenCalled();
      expect(window.location.search).not.toContain("token=");
    });

    it("should restore the token from sessionStorage on refresh (no URL token)", () => {
      // Simulate a previous visit that saved the token
      sessionStorage.setItem("clef_ui_token", "stored-token");
      // URL has no token (simulates a browser refresh)
      mod.initToken();
      mod.apiFetch("/api/test");
      const [, callInit] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = callInit.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer stored-token");
    });

    it("should persist the token to sessionStorage when extracted from URL", () => {
      window.history.pushState({}, "", "/?token=abc123");
      mod.initToken();
      expect(sessionStorage.getItem("clef_ui_token")).toBe("abc123");
    });
  });

  describe("apiFetch()", () => {
    it("should call fetch without an Authorization header when no token is set", () => {
      mod.apiFetch("/api/manifest");
      const [, callInit] = (global.fetch as jest.Mock).mock.calls[0];
      const headers = callInit.headers as Headers;
      expect(headers.get("Authorization")).toBeNull();
    });

    it("should forward extra init options to fetch", () => {
      mod.apiFetch("/api/test", { method: "POST", body: JSON.stringify({ x: 1 }) });
      const [url, callInit] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("/api/test");
      expect(callInit.method).toBe("POST");
    });
  });
});
