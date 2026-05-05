/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 *
 * Schema of `.clef-meta.yaml` (co-located with each `.enc.yaml` cell):
 *
 *   version: 1
 *   pending:                     # placeholder values awaiting real secrets
 *     - key: DATABASE_URL
 *       since: "2026-04-10T14:22:01.000Z"
 *       setBy: "alice@example.com"
 *   rotations:                   # per-key rotation records (value changes only)
 *     - key: STRIPE_KEY
 *       last_rotated_at: "2026-03-15T09:11:02.000Z"
 *       rotated_by: "alice@example.com"
 *       rotation_count: 4
 *
 * A rotation record is created or updated only when a key's plaintext value
 * changes (clef set, clef rotate, clef import of a changed value, clef
 * delete).  Re-encryption operations (clef recipients add, clef migrate-
 * backend) leave rotations untouched — re-encrypting the same plaintext is
 * not a value rotation.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as YAML from "yaml";

interface PendingKey {
  key: string;
  since: Date;
  setBy: string;
}

interface RotationRecord {
  key: string;
  lastRotatedAt: Date;
  rotatedBy: string;
  rotationCount: number;
}

/**
 * Parsed contents of a `.clef-meta.yaml` sidecar.
 *
 * Both `pending` and `rotations` may be empty arrays — they represent two
 * independent per-key state sections.  A fresh cell with no sidecar file
 * on disk is represented as `{ version: 1, pending: [], rotations: [] }`.
 */
interface CellMetadata {
  version: 1;
  pending: PendingKey[];
  rotations: RotationRecord[];
}

/**
 * Derive the `.clef-meta.yaml` path from an `.enc.yaml` path.
 * Example: `database/dev.enc.yaml` → `database/dev.clef-meta.yaml`
 */
function metadataPath(encryptedFilePath: string): string {
  const dir = path.dirname(encryptedFilePath);
  const base = path.basename(encryptedFilePath).replace(/\.enc\.(yaml|json)$/, "");
  return path.join(dir, `${base}.clef-meta.yaml`);
}

const HEADER_COMMENT = "# Managed by Clef. Do not edit manually.\n";

function emptyMetadata(): CellMetadata {
  return { version: 1, pending: [], rotations: [] };
}

/** Load metadata for an encrypted file.  Returns empty metadata if the file is missing or unreadable. */
async function loadMetadata(filePath: string): Promise<CellMetadata> {
  const metaPath = metadataPath(filePath);
  try {
    if (!fs.existsSync(metaPath)) return emptyMetadata();
    const content = fs.readFileSync(metaPath, "utf-8");
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

/** Write metadata to disk.  Creates parent directories if needed. */
async function saveMetadata(filePath: string, metadata: CellMetadata): Promise<void> {
  const metaPath = metadataPath(filePath);
  const dir = path.dirname(metaPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Always write both sections, even when empty.  Consistent shape makes
  // the file simpler to read and parse; the git-diff cost of two empty
  // arrays is trivial.
  const data = {
    version: metadata.version,
    pending: metadata.pending.map((p) => ({
      key: p.key,
      since: p.since.toISOString(),
      setBy: p.setBy,
    })),
    rotations: metadata.rotations.map((r) => ({
      key: r.key,
      last_rotated_at: r.lastRotatedAt.toISOString(),
      rotated_by: r.rotatedBy,
      rotation_count: r.rotationCount,
    })),
  };
  fs.writeFileSync(metaPath, HEADER_COMMENT + YAML.stringify(data), "utf-8");
}

/**
 * Mark one or more keys as pending (placeholder value) for an encrypted file.
 * If a key is already pending, its timestamp and `setBy` are updated.
 */
async function markPending(filePath: string, keys: string[], setBy: string): Promise<void> {
  const metadata = await loadMetadata(filePath);
  const now = new Date();
  for (const key of keys) {
    const existing = metadata.pending.findIndex((p) => p.key === key);
    if (existing >= 0) {
      metadata.pending[existing] = { key, since: now, setBy };
    } else {
      metadata.pending.push({ key, since: now, setBy });
    }
  }
  await saveMetadata(filePath, metadata);
}

/** Remove keys from the pending list after they have received real values. */
async function markResolved(filePath: string, keys: string[]): Promise<void> {
  const metadata = await loadMetadata(filePath);
  metadata.pending = metadata.pending.filter((p) => !keys.includes(p.key));
  await saveMetadata(filePath, metadata);
}

/** Return the list of key names that are still pending for the given encrypted file. */
async function getPendingKeys(filePath: string): Promise<string[]> {
  const metadata = await loadMetadata(filePath);
  return metadata.pending.map((p) => p.key);
}

/** Check whether a single key is currently pending for the given encrypted file. */
async function isPending(filePath: string, key: string): Promise<boolean> {
  const metadata = await loadMetadata(filePath);
  return metadata.pending.some((p) => p.key === key);
}

/**
 * Record a rotation for one or more keys.  Creates a new record when the key
 * has never rotated before (rotation_count: 1), or upserts an existing record
 * by bumping rotation_count and updating last_rotated_at + rotated_by.
 *
 * Also removes the corresponding `pending` entry if present — a rotation is
 * the resolution of a pending placeholder, so the two states are mutually
 * exclusive.
 */
async function recordRotation(
  filePath: string,
  keys: string[],
  rotatedBy: string,
  now: Date = new Date(),
): Promise<void> {
  const metadata = await loadMetadata(filePath);
  for (const key of keys) {
    const existing = metadata.rotations.findIndex((r) => r.key === key);
    if (existing >= 0) {
      metadata.rotations[existing] = {
        key,
        lastRotatedAt: now,
        rotatedBy,
        rotationCount: metadata.rotations[existing].rotationCount + 1,
      };
    } else {
      metadata.rotations.push({
        key,
        lastRotatedAt: now,
        rotatedBy,
        rotationCount: 1,
      });
    }
  }
  // Rotation resolves pending state — strip matching pending entries.
  metadata.pending = metadata.pending.filter((p) => !keys.includes(p.key));
  await saveMetadata(filePath, metadata);
}

/**
 * Remove rotation records for the given keys.  Called when a key is deleted
 * from the cell via `clef delete` — leaving a stale record would mislead
 * policy evaluation.
 */
async function removeRotation(filePath: string, keys: string[]): Promise<void> {
  const metadata = await loadMetadata(filePath);
  metadata.rotations = metadata.rotations.filter((r) => !keys.includes(r.key));
  await saveMetadata(filePath, metadata);
}

/** Return the rotation records currently recorded for the given encrypted file. */
async function getRotations(filePath: string): Promise<RotationRecord[]> {
  const metadata = await loadMetadata(filePath);
  return metadata.rotations;
}

/** Generate a cryptographically random 64-character hex string for use as a placeholder value. */
function generateRandomValue(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Same as {@link markPending} but retries once after `retryDelayMs` on transient failure.
 */
async function markPendingWithRetry(
  filePath: string,
  keys: string[],
  setBy: string,
  retryDelayMs = 200,
): Promise<void> {
  try {
    await markPending(filePath, keys, setBy);
  } catch {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    await markPending(filePath, keys, setBy);
  }
}

export {
  PendingKey,
  RotationRecord,
  CellMetadata,
  metadataPath,
  loadMetadata,
  saveMetadata,
  markPending,
  markPendingWithRetry,
  markResolved,
  getPendingKeys,
  isPending,
  recordRotation,
  removeRotation,
  getRotations,
  generateRandomValue,
};
