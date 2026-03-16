/**
 * Locates the bundled sops binary from the platform-specific npm package.
 * Extracted into its own module for testability — the resolver imports this
 * so tests can mock it without overriding require.resolve.
 */
import * as path from "path";

/**
 * Try to locate the bundled sops binary from the platform-specific npm package.
 * Returns the resolved path or null if the package is not installed.
 */
export function tryBundled(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js arch names to our package names
  const archName = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (!archName) return null;

  // Map Node.js platform names to our package names
  const platformName =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "win32"
          : null;
  if (!platformName) return null;

  const packageName = `@clef-sh/sops-${platformName}-${archName}`;
  const binName = platform === "win32" ? "sops.exe" : "sops";

  try {
    // Use createRequire to resolve the platform package.
    const packageMain = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageMain);
    return path.join(packageDir, "bin", binName);
  } catch {
    return null;
  }
}
