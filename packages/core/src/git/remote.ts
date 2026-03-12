import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SubprocessRunner } from "../types";

/**
 * Returns true if value looks like a git remote URL (SSH or HTTPS).
 * Local paths — absolute or relative — return false.
 *
 * @example
 * ```ts
 * isGitUrl("git@github.com:acme/secrets.git") // true
 * isGitUrl("https://github.com/acme/secrets") // true
 * isGitUrl("/home/user/secrets")               // false
 * ```
 */
export function isGitUrl(value: string): boolean {
  if (value.startsWith("http://")) {
    process.stderr.write(
      "Warning: http:// URLs use plaintext transport. Use https:// or SSH for secrets repositories.\n",
    );
  }
  return value.startsWith("https://") || value.startsWith("http://") || /^git@[^:]+:/.test(value);
}

function cachePathForUrl(url: string): string {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
  return path.join(os.homedir(), ".cache", "clef", hash);
}

function sanitizeUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

/**
 * Resolves a git URL to a local path by cloning or updating a shallow cache.
 *
 * Cache lives at `~/.cache/clef/<url-hash>/`. On every call, the cache is
 * either created (first use) or refreshed to the tip of the requested branch.
 * Shallow clones (`--depth 1`) keep the operation fast.
 *
 * This is intentionally read-only — no commit or push operations are performed.
 *
 * @param url - SSH (`git@...`) or HTTPS (`https://...`) git remote URL.
 * @param branch - Branch to check out. Defaults to the remote's HEAD if omitted.
 * @param runner - Subprocess runner used to invoke git.
 * @returns Absolute path to the local clone, ready for use as a `repoRoot`.
 * @throws `Error` If the clone or fetch fails (e.g. auth failure, unknown branch).
 */
export async function resolveRemoteRepo(
  url: string,
  branch: string | undefined,
  runner: SubprocessRunner,
): Promise<string> {
  const localPath = cachePathForUrl(url);

  if (fs.existsSync(localPath)) {
    // Refresh existing shallow clone
    const fetchArgs = ["fetch", "--depth", "1", "origin"];
    if (branch) fetchArgs.push(branch);

    const fetchResult = await runner.run("git", fetchArgs, { cwd: localPath });
    if (fetchResult.exitCode !== 0) {
      throw new Error(`Failed to fetch '${sanitizeUrl(url)}': ${fetchResult.stderr.trim()}`);
    }

    const ref = branch ? `origin/${branch}` : "origin/HEAD";
    const resetResult = await runner.run("git", ["reset", "--hard", ref], { cwd: localPath });
    if (resetResult.exitCode !== 0) {
      throw new Error(`Failed to reset to ${ref}: ${resetResult.stderr.trim()}`);
    }
  } else {
    // Fresh shallow clone
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) cloneArgs.push("--branch", branch);
    cloneArgs.push(url, localPath);

    const cloneResult = await runner.run("git", cloneArgs);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone '${sanitizeUrl(url)}': ${cloneResult.stderr.trim()}`);
    }
  }

  return localPath;
}
