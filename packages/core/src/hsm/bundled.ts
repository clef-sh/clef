/**
 * Locates the bundled `clef-keyservice` binary from the platform-specific
 * npm package. Mirrors `sops/bundled.ts` — extracted into its own module
 * for testability.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Try to locate the bundled clef-keyservice binary from the platform-specific
 * npm package. Returns the resolved path or null if the package is not installed.
 *
 * Windows is intentionally unsupported: the keyservice's PKCS#11 dependency
 * (miekg/pkcs11) requires per-vendor DLL conventions that are out of scope
 * for v1. Returns null on win32; callers surface a clean error upstream.
 */
export function tryBundledKeyservice(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const archName = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (!archName) return null;

  // Windows not supported by the keyservice itself — see file header.
  const platformName = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  if (!platformName) return null;

  const packageName = `@clef-sh/keyservice-${platformName}-${archName}`;
  const binName = "clef-keyservice";

  try {
    const packageMain = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageMain);
    const binPath = path.join(packageDir, "bin", binName);
    return fs.existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}
