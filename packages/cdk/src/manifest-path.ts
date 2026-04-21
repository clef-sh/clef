import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MANIFEST_FILENAME = "clef.yaml";

/**
 * Resolve the path to a `clef.yaml` manifest.
 *
 * When `explicit` is provided, it is resolved relative to `cwd` (default
 * `process.cwd()`) and returned if the file exists; otherwise this throws.
 *
 * When `explicit` is undefined, walks up from `cwd` looking for `clef.yaml`.
 * The walk checks the current directory first, then each parent, and stops
 * at (and inclusive of) any of:
 *   - the git root (a directory containing `.git`)
 *   - the user's home directory
 *   - the filesystem root
 *
 * Throws with a specific message when nothing is found so users know
 * whether to set `manifest:` explicitly or run from a different cwd.
 */
export function resolveManifestPath(explicit?: string, cwd: string = process.cwd()): string {
  if (explicit !== undefined) {
    const resolved = path.resolve(cwd, explicit);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Clef manifest not found at '${resolved}'. ` +
          `Check the 'manifest' prop path (resolved relative to cwd '${cwd}').`,
      );
    }
    return resolved;
  }

  const home = os.homedir();
  let dir = path.resolve(cwd);

  while (true) {
    const candidate = path.join(dir, MANIFEST_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const isGitRoot = fs.existsSync(path.join(dir, ".git"));
    const isHome = dir === home;
    const parent = path.dirname(dir);
    const isFsRoot = parent === dir;
    if (isGitRoot || isHome || isFsRoot) {
      throw new Error(
        `Could not find clef.yaml by walking up from '${cwd}'. ` +
          `Stopped at '${dir}'. ` +
          `Pass an explicit 'manifest:' prop or run CDK synth from a directory inside a clef repo.`,
      );
    }
    dir = parent;
  }
}
