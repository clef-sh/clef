/**
 * Resolves the path to the `sops` binary using a three-tier resolution chain:
 *
 *   1. `CLEF_SOPS_PATH` environment variable (explicit user override)
 *   2. Bundled platform-specific package (`@clef-sh/sops-{os}-{arch}`)
 *   3. System PATH fallback (bare `"sops"` command name)
 *
 * The result is cached after the first call — subsequent calls return the
 * same resolution without re-probing the filesystem.
 */
import * as fs from "fs";
import * as path from "path";
import { tryBundled } from "./bundled";

function validateSopsPath(candidate: string): void {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`CLEF_SOPS_PATH must be an absolute path, got '${candidate}'.`);
  }
  const segments = candidate.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `CLEF_SOPS_PATH contains '..' path segments ('${candidate}'). ` +
        "Use an absolute path without directory traversal.",
    );
  }
}

export type SopsSource = "env" | "bundled" | "system";

export interface SopsResolution {
  /** Absolute path to the sops binary, or "sops" for system PATH fallback. */
  path: string;
  /** How the binary was located. */
  source: SopsSource;
}

let cached: SopsResolution | undefined;

/**
 * Resolve the sops binary path.
 *
 * Resolution order:
 *   1. `CLEF_SOPS_PATH` env var — explicit override, used as-is
 *   2. Bundled `@clef-sh/sops-{platform}-{arch}` package
 *   3. System PATH fallback — returns bare `"sops"`
 *
 * The result is cached module-wide. Call {@link resetSopsResolution} in tests
 * to clear the cache.
 */
export function resolveSopsPath(): SopsResolution {
  if (cached) return cached;

  // 1. Explicit environment override
  const envPath = process.env.CLEF_SOPS_PATH?.trim();
  if (envPath) {
    validateSopsPath(envPath);
    if (!fs.existsSync(envPath)) {
      throw new Error(`CLEF_SOPS_PATH points to '${envPath}' but the file does not exist.`);
    }
    cached = { path: envPath, source: "env" };
    return cached;
  }

  // 2. Bundled platform package
  const bundledPath = tryBundled();
  if (bundledPath) {
    cached = { path: bundledPath, source: "bundled" };
    return cached;
  }

  // 3. System PATH fallback
  cached = { path: "sops", source: "system" };
  return cached;
}

/**
 * Clear the cached resolution. Only intended for use in tests.
 */
export function resetSopsResolution(): void {
  cached = undefined;
}
