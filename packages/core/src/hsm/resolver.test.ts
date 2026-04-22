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
    mockTryBundled.mockReturnValue(null);
  });

  afterEach(() => {
    resetKeyserviceResolution();
    if (originalEnv !== undefined) {
      process.env.CLEF_KEYSERVICE_PATH = originalEnv;
    } else {
      delete process.env.CLEF_KEYSERVICE_PATH;
    }
  });

  it("returns env source when CLEF_KEYSERVICE_PATH is set", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/custom/keyservice";
    const result = resolveKeyservicePath();
    expect(result).toEqual({ path: "/custom/keyservice", source: "env" });
  });

  it("rejects relative env paths", () => {
    process.env.CLEF_KEYSERVICE_PATH = "relative/path";
    expect(() => resolveKeyservicePath()).toThrow(/must be an absolute path/);
  });

  it("rejects env paths containing .. segments", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/abs/../traversal";
    expect(() => resolveKeyservicePath()).toThrow(/path segments/);
  });

  it("throws when env path does not exist", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/missing/keyservice";
    mockFs.existsSync.mockReturnValue(false);
    expect(() => resolveKeyservicePath()).toThrow(/file does not exist/);
  });

  it("returns bundled source when platform package is installed", () => {
    mockTryBundled.mockReturnValue("/bundled/keyservice");
    const result = resolveKeyservicePath();
    expect(result).toEqual({ path: "/bundled/keyservice", source: "bundled" });
  });

  it("falls back to system PATH when no env and no bundled package", () => {
    const result = resolveKeyservicePath();
    expect(result).toEqual({ path: "clef-keyservice", source: "system" });
  });

  it("caches the resolution across calls", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/cached/keyservice";
    const first = resolveKeyservicePath();
    delete process.env.CLEF_KEYSERVICE_PATH;
    const second = resolveKeyservicePath();
    expect(second).toBe(first);
  });

  it("resetKeyserviceResolution clears the cache", () => {
    process.env.CLEF_KEYSERVICE_PATH = "/first/keyservice";
    const first = resolveKeyservicePath();
    resetKeyserviceResolution();
    process.env.CLEF_KEYSERVICE_PATH = "/second/keyservice";
    const second = resolveKeyservicePath();
    expect(second).not.toBe(first);
    expect(second.path).toBe("/second/keyservice");
  });
});
