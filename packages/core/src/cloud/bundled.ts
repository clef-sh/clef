/**
 * Locates the bundled clef-keyservice binary from the platform-specific npm package.
 * Mirrors sops/bundled.ts — extracted for testability.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Try to locate the bundled keyservice binary from the platform-specific npm package.
 * Returns the resolved path or null if the package is not installed.
 */
export function tryBundledKeyservice(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const archName = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (!archName) return null;

  const platformName =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "win32"
          : null;
  if (!platformName) return null;

  const packageName = `@clef-sh/keyservice-${platformName}-${archName}`;
  const binName = platform === "win32" ? "clef-keyservice.exe" : "clef-keyservice";

  try {
    const packageMain = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageMain);
    const binPath = path.join(packageDir, "bin", binName);
    return fs.existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}
