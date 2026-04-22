import * as fs from "fs";
import { tryBundledKeyservice } from "./bundled";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("tryBundledKeyservice", () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let originalArch: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    originalArch = Object.getOwnPropertyDescriptor(process, "arch");
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    if (originalArch) Object.defineProperty(process, "arch", originalArch);
    jest.clearAllMocks();
  });

  function setPlatform(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
    Object.defineProperty(process, "platform", { value: platform });
    Object.defineProperty(process, "arch", { value: arch });
  }

  it("returns null on Windows (keyservice does not ship a Windows binary)", () => {
    setPlatform("win32", "x64");
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("returns null for unsupported architectures", () => {
    setPlatform("linux", "ia32" as NodeJS.Architecture);
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("returns null for unsupported platforms", () => {
    setPlatform("freebsd" as NodeJS.Platform, "x64");
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("returns null when the platform package is not installed", () => {
    setPlatform("linux", "x64");
    // require.resolve will throw for a package that does not exist
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("attempts to resolve the darwin-arm64 platform package", () => {
    setPlatform("darwin", "arm64");
    // require.resolve throws for the missing package → null
    mockFs.existsSync.mockReturnValue(false);
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("attempts to resolve the linux-arm64 platform package", () => {
    setPlatform("linux", "arm64");
    mockFs.existsSync.mockReturnValue(false);
    expect(tryBundledKeyservice()).toBeNull();
  });

  it("attempts to resolve the darwin-x64 platform package", () => {
    setPlatform("darwin", "x64");
    mockFs.existsSync.mockReturnValue(false);
    expect(tryBundledKeyservice()).toBeNull();
  });
});
