import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { CLEF_MANIFEST_FILENAME } from "./parser";

export function readManifestYaml(repoRoot: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(repoRoot, CLEF_MANIFEST_FILENAME), "utf-8");
  return YAML.parse(raw) as Record<string, unknown>;
}

/**
 * Write the manifest atomically via write-file-atomic.
 *
 * Uses temp-file-then-rename in the same directory as the manifest, so the
 * rename is atomic on POSIX (cross-filesystem renames degrade to copy+delete
 * and are not atomic). Another reader sees either the old contents or the new
 * contents — never a half-written file. If the process dies mid-write, the
 * temp file is cleaned up by write-file-atomic's signal-exit handler. Handles
 * Windows EPERM retries internally.
 */
export function writeManifestYaml(repoRoot: string, doc: Record<string, unknown>): void {
  const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
  writeFileAtomic.sync(manifestPath, YAML.stringify(doc));
}

/**
 * Write a raw manifest string atomically. Used for rollback paths that need
 * to restore an exact byte-for-byte snapshot of the original file (avoiding
 * any YAML parse → stringify round-trip that could change formatting).
 */
export function writeManifestYamlRaw(repoRoot: string, contents: string): void {
  const manifestPath = path.join(repoRoot, CLEF_MANIFEST_FILENAME);
  writeFileAtomic.sync(manifestPath, contents);
}
