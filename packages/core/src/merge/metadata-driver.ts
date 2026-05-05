/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * Three-way merge driver for `.clef-meta.yaml` sidecar files.  Invoked by
 * git via the `merge=clef-metadata` attribute registered in
 * `.gitattributes`.  Public entry point: {@link mergeMetadataFiles} —
 * thin filesystem wrapper around the internal `mergeMetadataContents`
 * (pure string → string) helper.
 *
 * Unlike the SOPS merge driver, this one auto-resolves every conflict —
 * the data model (timestamps + counters) lets us pick the later value
 * without losing information.  The SOPS driver cannot do this because
 * ciphertext values are not ordered.
 *
 * Merge rules (see docstrings on each helper for detail):
 *
 *   rotations (per key)
 *     both sides changed → later `last_rotated_at` wins, `rotated_by`
 *       follows the winner, `rotation_count` = max + 1 to record the merge.
 *     one side only → take it.
 *
 *   pending (per key)
 *     key resolved on one side (absent from that side's `pending`, present
 *       in that side's `rotations`) → resolution wins; drop from pending.
 *     both sides pending with different `since` → later `since` wins.
 *     one side pending, other unchanged → keep pending.
 */
import * as fs from "fs";
import * as YAML from "yaml";
import type { PendingKey, RotationRecord, CellMetadata } from "../pending/metadata";

interface RawMetadata {
  version: 1;
  pending: PendingKey[];
  rotations: RotationRecord[];
}

const HEADER_COMMENT = "# Managed by Clef. Do not edit manually.\n";

/**
 * Parse a `.clef-meta.yaml` content string into the normalized in-memory
 * shape.  Returns empty sections on any parse failure — merging an empty
 * side against a non-empty side is the safe fallback, preserving the
 * non-empty side's records.
 */
function parseMetadata(content: string): RawMetadata {
  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== "object") return emptyMetadata();

    const pendingRaw: unknown[] = Array.isArray(parsed.pending) ? parsed.pending : [];
    const pending = pendingRaw
      .filter(
        (p): p is { key: string; since: string; setBy: string } =>
          !!p &&
          typeof p === "object" &&
          typeof (p as { key: unknown }).key === "string" &&
          typeof (p as { since: unknown }).since === "string" &&
          typeof (p as { setBy: unknown }).setBy === "string",
      )
      .map((p) => ({ key: p.key, since: new Date(p.since), setBy: p.setBy }));

    const rotationsRaw: unknown[] = Array.isArray(parsed.rotations) ? parsed.rotations : [];
    const rotations = rotationsRaw
      .filter(
        (
          r,
        ): r is {
          key: string;
          last_rotated_at: string;
          rotated_by: string;
          rotation_count: number;
        } =>
          !!r &&
          typeof r === "object" &&
          typeof (r as { key: unknown }).key === "string" &&
          typeof (r as { last_rotated_at: unknown }).last_rotated_at === "string" &&
          typeof (r as { rotated_by: unknown }).rotated_by === "string" &&
          typeof (r as { rotation_count: unknown }).rotation_count === "number",
      )
      .map((r) => ({
        key: r.key,
        lastRotatedAt: new Date(r.last_rotated_at),
        rotatedBy: r.rotated_by,
        rotationCount: r.rotation_count,
      }));

    return { version: 1, pending, rotations };
  } catch {
    return emptyMetadata();
  }
}

function emptyMetadata(): RawMetadata {
  return { version: 1, pending: [], rotations: [] };
}

function serializeMetadata(m: CellMetadata): string {
  const data = {
    version: m.version,
    pending: m.pending.map((p) => ({
      key: p.key,
      since: p.since.toISOString(),
      setBy: p.setBy,
    })),
    rotations: m.rotations.map((r) => ({
      key: r.key,
      last_rotated_at: r.lastRotatedAt.toISOString(),
      rotated_by: r.rotatedBy,
      rotation_count: r.rotationCount,
    })),
  };
  return HEADER_COMMENT + YAML.stringify(data);
}

/**
 * Merge the `rotations` arrays from ours and theirs.  For each key:
 *
 *   - Both sides → keep the record with the later `last_rotated_at`.
 *     `rotated_by` follows the winning timestamp.  `rotation_count`
 *     becomes `max(ours.count, theirs.count) + 1`; the +1 records that
 *     a merge happened, so the counter truthfully reflects the number of
 *     distinct rotation events the key has ever had.
 *   - One side only → take it verbatim.
 */
function mergeRotations(ours: RotationRecord[], theirs: RotationRecord[]): RotationRecord[] {
  const byKey = new Map<string, RotationRecord>();

  const ourByKey = new Map(ours.map((r) => [r.key, r] as const));
  const theirByKey = new Map(theirs.map((r) => [r.key, r] as const));
  const allKeys = new Set([...ourByKey.keys(), ...theirByKey.keys()]);

  for (const key of allKeys) {
    const o = ourByKey.get(key);
    const t = theirByKey.get(key);

    if (o && t) {
      const oTime = o.lastRotatedAt.getTime();
      const tTime = t.lastRotatedAt.getTime();
      const winner = tTime > oTime ? t : o;
      byKey.set(key, {
        key,
        lastRotatedAt: winner.lastRotatedAt,
        rotatedBy: winner.rotatedBy,
        rotationCount: Math.max(o.rotationCount, t.rotationCount) + 1,
      });
    } else if (o) {
      byKey.set(key, o);
    } else if (t) {
      byKey.set(key, t);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Merge the `pending` arrays.  The state-machine wrinkle: a key pending
 * on one side but resolved on the other (present in that side's
 * `rotations` and absent from its `pending`) is deliberately resolved —
 * dropping from the merged `pending` preserves the resolution.
 *
 * @param oursPending   Our branch's pending entries.
 * @param theirsPending Their branch's pending entries.
 * @param mergedRotations The already-merged rotations (used to detect
 *                        resolutions on either side).
 * @param oursRotations   Rotations on our side only (to identify
 *                        resolutions we did).
 * @param theirsRotations Rotations on their side only.
 */
function mergePending(
  oursPending: PendingKey[],
  theirsPending: PendingKey[],
  oursRotations: RotationRecord[],
  theirsRotations: RotationRecord[],
): PendingKey[] {
  const ourByKey = new Map(oursPending.map((p) => [p.key, p] as const));
  const theirByKey = new Map(theirsPending.map((p) => [p.key, p] as const));
  // A key is considered resolved if it appears in either side's rotations.
  // The resolution supersedes any lingering pending entry on the other
  // side — that entry is stale-by-merge-time and dropping it is correct.
  const rotatedKeys = new Set<string>([
    ...oursRotations.map((r) => r.key),
    ...theirsRotations.map((r) => r.key),
  ]);
  const allKeys = new Set([...ourByKey.keys(), ...theirByKey.keys()]);

  const out: PendingKey[] = [];
  for (const key of allKeys) {
    if (rotatedKeys.has(key)) continue; // resolved somewhere → drop pending

    const o = ourByKey.get(key);
    const t = theirByKey.get(key);

    if (o && t) {
      // Both sides still pending.  Take the later `since` (and its setBy).
      const winner = t.since.getTime() > o.since.getTime() ? t : o;
      out.push({ key, since: winner.since, setBy: winner.setBy });
    } else if (o) {
      out.push(o);
    } else if (t) {
      out.push(t);
    }
  }

  return out;
}

/**
 * Merge two `.clef-meta.yaml` contents (as strings).  Does not read the
 * base revision — the timestamp-ordered merge is associative without one,
 * which is the whole reason we can auto-resolve.  The caller is
 * responsible for reading / writing from disk.
 *
 * Returns the merged YAML content with the standard Clef header comment.
 */
export function mergeMetadataContents(oursContent: string, theirsContent: string): string {
  const ours = parseMetadata(oursContent);
  const theirs = parseMetadata(theirsContent);

  const rotations = mergeRotations(ours.rotations, theirs.rotations);
  const pending = mergePending(ours.pending, theirs.pending, ours.rotations, theirs.rotations);

  return serializeMetadata({ version: 1, pending, rotations });
}

/**
 * Filesystem wrapper around `mergeMetadataContents` (internal).  Reads
 * ours and theirs, writes the merged result back to `oursPath` (the
 * conventional destination git passes as `%A`).  Does not read
 * `basePath` — see the merge algorithm's docstring for why a base
 * revision is not needed.
 */
export function mergeMetadataFiles(_basePath: string, oursPath: string, theirsPath: string): void {
  const oursContent = fs.existsSync(oursPath) ? fs.readFileSync(oursPath, "utf-8") : "";
  const theirsContent = fs.existsSync(theirsPath) ? fs.readFileSync(theirsPath, "utf-8") : "";
  const merged = mergeMetadataContents(oursContent, theirsContent);
  fs.writeFileSync(oursPath, merged, "utf-8");
}
