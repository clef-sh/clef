import { FileEncryptionBackend } from "../types";

/** Status of a single key in a three-way merge. */
export type MergeKeyStatus = "unchanged" | "ours" | "theirs" | "both_added" | "conflict";

/** One key's resolution in the three-way merge. */
export interface MergeKey {
  key: string;
  status: MergeKeyStatus;
  /** Resolved value when status is not "conflict". `null` for deletions or unresolvable conflicts. */
  value: string | null;
  /** Base value (common ancestor). `null` if the key did not exist in base. */
  baseValue: string | null;
  /** Value from ours. `null` if the key was deleted or absent in ours. */
  oursValue: string | null;
  /** Value from theirs. `null` if the key was deleted or absent in theirs. */
  theirsValue: string | null;
}

/** Result of a three-way merge. */
export interface MergeResult {
  /** `true` when all keys merged cleanly with no conflicts. */
  clean: boolean;
  /** The merged key/value map. Only complete when `clean` is `true`. */
  merged: Record<string, string>;
  /** Per-key resolution details. */
  keys: MergeKey[];
  /** Keys that could not be auto-resolved. Empty when `clean` is `true`. */
  conflicts: MergeKey[];
}

/**
 * Three-way merge driver for SOPS-encrypted files.
 *
 * Decrypts the base (common ancestor), ours (current branch), and theirs (incoming branch)
 * versions of a file, performs a three-way merge on the plaintext key/value maps, and
 * returns the merged result for re-encryption.
 *
 * @example
 * ```ts
 * const driver = new SopsMergeDriver(sopsClient);
 * const result = await driver.mergeFiles(basePath, oursPath, theirsPath);
 * if (result.clean) {
 *   await sopsClient.encrypt(oursPath, result.merged, manifest, environment);
 * }
 * ```
 */
export class SopsMergeDriver {
  constructor(private readonly sopsClient: FileEncryptionBackend) {}

  /**
   * Perform a three-way merge on three in-memory key/value maps.
   *
   * Algorithm: For each key across all three maps, compare ours and theirs against base.
   * - If only one side changed relative to base, take that side's value.
   * - If both sides made the same change, take either (they agree).
   * - If both sides made different changes to the same key, it's a conflict.
   * - If a key was added on both sides with the same value, accept it.
   * - If a key was added on both sides with different values, it's a conflict.
   */
  merge(
    base: Record<string, string>,
    ours: Record<string, string>,
    theirs: Record<string, string>,
  ): MergeResult {
    const allKeys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);

    const merged: Record<string, string> = {};
    const keys: MergeKey[] = [];
    const conflicts: MergeKey[] = [];

    for (const key of allKeys) {
      const inBase = key in base;
      const inOurs = key in ours;
      const inTheirs = key in theirs;
      const baseVal = inBase ? base[key] : null;
      const oursVal = inOurs ? ours[key] : null;
      const theirsVal = inTheirs ? theirs[key] : null;

      const oursChanged = oursVal !== baseVal;
      const theirsChanged = theirsVal !== baseVal;

      let status: MergeKeyStatus;
      let value: string | null;

      if (!oursChanged && !theirsChanged) {
        // Neither side changed this key relative to base
        status = "unchanged";
        value = baseVal;
      } else if (oursChanged && !theirsChanged) {
        // Only ours changed (including additions and deletions)
        status = "ours";
        value = oursVal;
      } else if (!oursChanged && theirsChanged) {
        // Only theirs changed (including additions and deletions)
        status = "theirs";
        value = theirsVal;
      } else if (oursVal === theirsVal) {
        // Both changed to the same value (or both deleted)
        status = !inBase && inOurs && inTheirs ? "both_added" : "ours";
        value = oursVal;
      } else {
        // Both changed to different values — conflict
        status = "conflict";
        value = null;
      }

      const mergeKey: MergeKey = {
        key,
        status,
        value,
        baseValue: baseVal,
        oursValue: oursVal,
        theirsValue: theirsVal,
      };
      keys.push(mergeKey);

      if (status === "conflict") {
        conflicts.push(mergeKey);
      } else if (value !== null) {
        merged[key] = value;
      }
      // value === null && status !== "conflict" means the key was deleted — omit from merged
    }

    // Sort keys alphabetically for stable output
    keys.sort((a, b) => a.key.localeCompare(b.key));
    conflicts.sort((a, b) => a.key.localeCompare(b.key));

    return { clean: conflicts.length === 0, merged, keys, conflicts };
  }

  /**
   * Decrypt three file versions and perform a three-way merge.
   *
   * @param basePath - Path to the common ancestor file (git %O).
   * @param oursPath - Path to the current branch file (git %A).
   * @param theirsPath - Path to the incoming branch file (git %B).
   * @returns The merge result. When `clean` is `true`, `merged` contains the resolved values.
   */
  async mergeFiles(basePath: string, oursPath: string, theirsPath: string): Promise<MergeResult> {
    const [baseDecrypted, oursDecrypted, theirsDecrypted] = await Promise.all([
      this.sopsClient.decrypt(basePath),
      this.sopsClient.decrypt(oursPath),
      this.sopsClient.decrypt(theirsPath),
    ]);

    return this.merge(baseDecrypted.values, oursDecrypted.values, theirsDecrypted.values);
  }
}
