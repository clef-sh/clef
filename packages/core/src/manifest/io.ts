import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { CLEF_MANIFEST_FILENAME } from "./parser";

export function readManifestYaml(repoRoot: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(repoRoot, CLEF_MANIFEST_FILENAME), "utf-8");
  return YAML.parse(raw) as Record<string, unknown>;
}

/**
 * Write the manifest atomically.
 *
 * Uses a temp file in the same directory as the manifest, then atomically
 * renames it into place. This guarantees that another reader will see either
 * the old contents or the new contents — never a half-written file. If the
 * process dies mid-write, the temp file is orphaned but the manifest is
 * untouched.
 *
 * The temp file MUST live on the same filesystem as the manifest because
 * `fs.renameSync` is only atomic within a single filesystem. Using `os.tmpdir`
 * is unsafe on Linux servers and Docker volumes where /tmp is often a
 * separate mount.
 */
export function writeManifestYaml(repoRoot: string, doc: Record<string, unknown>): void {
  atomicWriteManifest(repoRoot, YAML.stringify(doc));
}

/**
 * Write a raw manifest string atomically. Used for rollback paths that need
 * to restore an exact byte-for-byte snapshot of the original file (avoiding
 * any YAML parse → stringify round-trip that could change formatting).
 */
export function writeManifestYamlRaw(repoRoot: string, contents: string): void {
  atomicWriteManifest(repoRoot, contents);
}

function atomicWriteManifest(repoRoot: string, contents: string): void {
  const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
  const dir = path.dirname(manifestPath);
  // Same-directory temp ensures rename is atomic on POSIX (rename across
  // filesystems falls back to copy+delete, which is not atomic).
  const tmpPath = path.join(dir, `.${CLEF_MANIFEST_FILENAME}.tmp.${process.pid}.${Date.now()}`);

  try {
    fs.writeFileSync(tmpPath, contents, "utf-8");
    fs.renameSync(tmpPath, manifestPath);
  } catch (err) {
    // Cleanup orphaned temp file on any failure (write or rename).
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Temp file may not exist — ignore.
    }
    throw err;
  }
}
