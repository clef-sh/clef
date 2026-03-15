import * as fs from "fs";
import { resolveSopsPath, resetSopsResolution } from "./resolver";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("resolveSopsPath", () => {
  const originalEnv = process.env.CLEF_SOPS_PATH;

  beforeEach(() => {
    resetSopsResolution();
    delete process.env.CLEF_SOPS_PATH;
    mockFs.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    resetSopsResolution();
    if (originalEnv !== undefined) {
      process.env.CLEF_SOPS_PATH = originalEnv;
    } else {
      delete process.env.CLEF_SOPS_PATH;
    }
  });

  it("should return env source when CLEF_SOPS_PATH is set", () => {
    process.env.CLEF_SOPS_PATH = "/custom/path/to/sops";

    const result = resolveSopsPath();

    expect(result.path).toBe("/custom/path/to/sops");
    expect(result.source).toBe("env");
  });

  it("should fall back to system PATH when no env var and no bundled package", () => {
    // No CLEF_SOPS_PATH set, and @clef-sh/sops-* packages are not installed
    const result = resolveSopsPath();

    expect(result.path).toBe("sops");
    expect(result.source).toBe("system");
  });

  it("should cache the result across multiple calls", () => {
    process.env.CLEF_SOPS_PATH = "/cached/sops";
    const first = resolveSopsPath();

    // Change the env var — should still return cached result
    process.env.CLEF_SOPS_PATH = "/different/sops";
    const second = resolveSopsPath();

    expect(first).toBe(second);
    expect(second.path).toBe("/cached/sops");
  });

  it("should return fresh result after resetSopsResolution", () => {
    process.env.CLEF_SOPS_PATH = "/first/sops";
    const first = resolveSopsPath();

    resetSopsResolution();
    process.env.CLEF_SOPS_PATH = "/second/sops";
    const second = resolveSopsPath();

    expect(first.path).toBe("/first/sops");
    expect(second.path).toBe("/second/sops");
  });

  it("should prefer CLEF_SOPS_PATH over bundled package", () => {
    process.env.CLEF_SOPS_PATH = "/explicit/override";

    const result = resolveSopsPath();

    expect(result.source).toBe("env");
    expect(result.path).toBe("/explicit/override");
  });

  it("should reject relative CLEF_SOPS_PATH", () => {
    process.env.CLEF_SOPS_PATH = "relative/path/to/sops";

    expect(() => resolveSopsPath()).toThrow("must be an absolute path");
  });

  it("should reject CLEF_SOPS_PATH with .. traversal", () => {
    process.env.CLEF_SOPS_PATH = "/usr/local/../etc/sops";

    expect(() => resolveSopsPath()).toThrow("..");
  });

  it("should reject CLEF_SOPS_PATH when file does not exist", () => {
    process.env.CLEF_SOPS_PATH = "/nonexistent/sops";
    mockFs.existsSync.mockReturnValue(false);

    expect(() => resolveSopsPath()).toThrow("does not exist");
  });
});

describe("resetSopsResolution", () => {
  it("should clear the cache so next call re-resolves", () => {
    process.env.CLEF_SOPS_PATH = "/a";
    mockFs.existsSync.mockReturnValue(true);
    resolveSopsPath();

    resetSopsResolution();
    delete process.env.CLEF_SOPS_PATH;
    const result = resolveSopsPath();

    expect(result.source).toBe("system");
    expect(result.path).toBe("sops");
  });

  it("should cache system PATH fallback and return same reference", () => {
    // No CLEF_SOPS_PATH set — falls back to system
    const first = resolveSopsPath();
    const second = resolveSopsPath();

    expect(first).toBe(second);
    expect(first.source).toBe("system");
    expect(first.path).toBe("sops");
  });
});
