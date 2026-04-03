import * as fs from "fs";
import { resolveKeyservicePath, resetKeyserviceResolution } from "./resolver";
import { tryBundledKeyservice } from "./bundled";

jest.mock("fs");
jest.mock("./bundled", () => ({
  tryBundledKeyservice: jest.fn().mockReturnValue(null),
}));
const mockFs = fs as jest.Mocked<typeof fs>;
const mockTryBundled = tryBundledKeyservice as jest.MockedFunction<typeof tryBundledKeyservice>;

describe("resolveKeyservicePath", () => {
  const originalEnv = process.env.CLEF_KEYSERVICE_PATH;

  beforeEach(() => {
    resetKeyserviceResolution();
    delete process.env.CLEF_KEYSERVICE_PATH;
    mockFs.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    resetKeyserviceResolution();
    if (originalEnv !== undefined) {
      process.env.CLEF_KEYSERVICE_PATH = originalEnv;
    } else {
      delete process.env.CLEF_KEYSERVICE_PATH;
    }
  });

  it("should return env source when CLEF_KEYSERVICE_PATH is set", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/custom/path/to/clef-keyservice";

    const result = resolveKeyservicePath();

    expect(result.path).toBe("/custom/path/to/clef-keyservice");
    expect(result.source).toBe("env");
  });

  it("should fall back to system PATH when no env var and no bundled package", () => {
    const result = resolveKeyservicePath();

    expect(result.path).toBe("clef-keyservice");
    expect(result.source).toBe("system");
  });

  it("should cache the result across multiple calls", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/cached/clef-keyservice";
    const first = resolveKeyservicePath();

    process.env.CLEF_KEYSERVICE_PATH = "/different/clef-keyservice";
    const second = resolveKeyservicePath();

    expect(first).toBe(second);
    expect(second.path).toBe("/cached/clef-keyservice");
  });

  it("should return fresh result after resetKeyserviceResolution", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/first/clef-keyservice";
    const first = resolveKeyservicePath();

    resetKeyserviceResolution();
    process.env.CLEF_KEYSERVICE_PATH = "/second/clef-keyservice";
    const second = resolveKeyservicePath();

    expect(first.path).toBe("/first/clef-keyservice");
    expect(second.path).toBe("/second/clef-keyservice");
  });

  it("should prefer CLEF_KEYSERVICE_PATH over bundled package", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/explicit/override";

    const result = resolveKeyservicePath();

    expect(result.source).toBe("env");
    expect(result.path).toBe("/explicit/override");
  });

  it("should return bundled source when tryBundledKeyservice returns a path", () => {
    mockTryBundled.mockReturnValueOnce("/path/to/bundled/clef-keyservice");

    const result = resolveKeyservicePath();

    expect(result.source).toBe("bundled");
    expect(result.path).toBe("/path/to/bundled/clef-keyservice");
  });

  it("should reject relative CLEF_KEYSERVICE_PATH", () => {
    process.env.CLEF_KEYSERVICE_PATH = "relative/path";

    expect(() => resolveKeyservicePath()).toThrow("must be an absolute path");
  });

  it("should reject CLEF_KEYSERVICE_PATH with .. traversal", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/usr/local/../etc/clef-keyservice";

    expect(() => resolveKeyservicePath()).toThrow("..");
  });

  it("should reject CLEF_KEYSERVICE_PATH when file does not exist", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/nonexistent/clef-keyservice";
    mockFs.existsSync.mockReturnValue(false);

    expect(() => resolveKeyservicePath()).toThrow("does not exist");
  });
});
