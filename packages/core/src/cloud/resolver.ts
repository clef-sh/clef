/**
 * Resolves the path to the `clef-keyservice` binary using a three-tier resolution chain:
 *
 *   1. `CLEF_KEYSERVICE_PATH` environment variable (explicit user override)
 *   2. Bundled platform-specific package (`@clef-sh/keyservice-{os}-{arch}`)
 *   3. System PATH fallback (bare `"clef-keyservice"` command name)
 *
 * Mirrors the resolution pattern in sops/resolver.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { tryBundledKeyservice } from "./bundled";

function validateKeyservicePath(candidate: string): void {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`CLEF_KEYSERVICE_PATH must be an absolute path, got '${candidate}'.`);
  }
  const segments = candidate.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `CLEF_KEYSERVICE_PATH contains '..' path segments ('${candidate}'). ` +
        "Use an absolute path without directory traversal.",
    );
  }
}

export type KeyserviceSource = "env" | "bundled" | "system";

export interface KeyserviceResolution {
  /** Absolute path to the keyservice binary, or "clef-keyservice" for system PATH fallback. */
  path: string;
  /** How the binary was located. */
  source: KeyserviceSource;
}

let cached: KeyserviceResolution | undefined;

/**
 * Resolve the clef-keyservice binary path.
 *
 * Resolution order:
 *   1. `CLEF_KEYSERVICE_PATH` env var — explicit override, used as-is
 *   2. Bundled `@clef-sh/keyservice-{platform}-{arch}` package
 *   3. System PATH fallback — returns bare `"clef-keyservice"`
 *
 * The result is cached module-wide. Call {@link resetKeyserviceResolution} in tests
 * to clear the cache.
 */
export function resolveKeyservicePath(): KeyserviceResolution {
  if (cached) return cached;

  // 1. Explicit environment override
  const envPath = process.env.CLEF_KEYSERVICE_PATH?.trim();
  if (envPath) {
    validateKeyservicePath(envPath);
    if (!fs.existsSync(envPath)) {
      throw new Error(`CLEF_KEYSERVICE_PATH points to '${envPath}' but the file does not exist.`);
    }
    cached = { path: envPath, source: "env" };
    return cached;
  }

  // 2. Bundled platform package
  const bundledPath = tryBundledKeyservice();
  if (bundledPath) {
    cached = { path: bundledPath, source: "bundled" };
    return cached;
  }

  // 3. System PATH fallback
  cached = { path: "clef-keyservice", source: "system" };
  return cached;
}

/**
 * Clear the cached resolution. Only intended for use in tests.
 */
export function resetKeyserviceResolution(): void {
  cached = undefined;
}
