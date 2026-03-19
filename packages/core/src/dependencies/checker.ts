import {
  DependencyStatus,
  DependencyVersion,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
} from "../types";
import { resolveSopsPath } from "../sops/resolver";

// Minimum versions — update .github/workflows/ci.yml when these change
export const REQUIREMENTS = {
  sops: "3.8.0",
  git: "2.28.0",
} as const;

/**
 * Parse a version string like "3.8.1" into [major, minor, patch].
 * Returns null if the string is not a valid semver-like version.
 */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Returns true if `installed` >= `required` using semver comparison.
 */
function semverSatisfied(installed: string, required: string): boolean {
  const a = parseSemver(installed);
  const b = parseSemver(required);
  if (!a || !b) return false;

  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/**
 * Extract version from sops output.
 * Format: "sops 3.8.1 (latest)" or "sops 3.9.4"
 */
function parseSopsVersion(stdout: string): string | null {
  const match = stdout.match(/sops\s+(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract version from git output.
 * Format: "git version 2.43.0" or "git version 2.50.1 (Apple Git-155)"
 */
function parseGitVersion(stdout: string): string | null {
  const match = stdout.match(/git version\s+(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Get the platform-appropriate install hint for a binary.
 */
function getInstallHint(name: "sops" | "git"): string {
  const platform = process.platform;

  switch (name) {
    case "sops":
      if (platform === "darwin") return "brew install sops";
      return "see https://github.com/getsops/sops/releases";
    case "git":
      if (platform === "darwin") return "brew install git";
      if (platform === "linux") return "apt install git";
      return "see https://git-scm.com/downloads";
  }
}

/**
 * Check a single dependency. Returns null if the binary is not found.
 * Never throws.
 */
export async function checkDependency(
  name: "sops" | "git",
  runner: SubprocessRunner,
  commandOverride?: string,
): Promise<DependencyVersion | null> {
  try {
    // For sops, use the resolver to find the binary path (unless overridden)
    const resolution = name === "sops" && !commandOverride ? resolveSopsPath() : undefined;
    const command = commandOverride ?? (resolution ? resolution.path : name);

    const result = await runner.run(command, ["--version"]);

    if (result.exitCode !== 0) {
      return null;
    }

    const output = result.stdout.trim() || result.stderr.trim();
    let installed: string | null = null;

    switch (name) {
      case "sops":
        installed = parseSopsVersion(output);
        break;
      case "git":
        installed = parseGitVersion(output);
        break;
    }

    if (!installed) {
      return null;
    }

    const required = REQUIREMENTS[name];
    return {
      installed,
      required,
      satisfied: semverSatisfied(installed, required),
      installHint: getInstallHint(name),
      source: resolution?.source,
      resolvedPath: resolution?.path,
    };
  } catch {
    return null;
  }
}

/**
 * Check sops and git dependencies in parallel.
 */
export async function checkAll(runner: SubprocessRunner): Promise<DependencyStatus> {
  const [sops, git] = await Promise.all([
    checkDependency("sops", runner),
    checkDependency("git", runner),
  ]);

  return { sops, git };
}

/**
 * Assert that sops is installed and meets the minimum version.
 * Throws SopsMissingError or SopsVersionError.
 */
export async function assertSops(runner: SubprocessRunner, command?: string): Promise<void> {
  const dep = await checkDependency("sops", runner, command);

  if (!dep) {
    throw new SopsMissingError(getInstallHint("sops"));
  }

  if (!dep.satisfied) {
    throw new SopsVersionError(dep.installed, dep.required, getInstallHint("sops"));
  }
}

// Exported for testing
export { parseSopsVersion, parseGitVersion, semverSatisfied };
