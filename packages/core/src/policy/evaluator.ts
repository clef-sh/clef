/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module produces the per-file rotation verdicts that are aggregated
 * into compliance artifacts and surfaced as PR check results. A logic slip
 * here either silently passes overdue secrets (false-negative compliance)
 * or floods CI with false alarms. Before adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import { SopsMetadata } from "../types";
import { RotationRecord } from "../pending/metadata";
import { FileRotationStatus, KeyRotationStatus, PolicyDocument } from "./types";

const MS_PER_DAY = 86_400_000;
/** Default `max_age_days` applied when policy omits the rotation block entirely. */
const DEFAULT_MAX_AGE_DAYS = 90;

/**
 * Evaluates per-key rotation state against a {@link PolicyDocument}.
 *
 * The evaluator is intentionally pure — it never reads the filesystem and
 * never decrypts.  All inputs (file metadata, key names, rotation records)
 * come from the caller.
 */
export class PolicyEvaluator {
  constructor(private readonly policy: PolicyDocument) {}

  /**
   * Evaluate a single encrypted file's per-key rotation state.
   *
   * @param filePath    Repo-relative or absolute path to the encrypted file.
   * @param environment Environment name; selects per-env overrides.
   * @param metadata    SOPS metadata for the file (carries last_modified,
   *                    backend, recipients).  The evaluator does not read
   *                    `last_modified` for the policy gate — it is echoed
   *                    into the output for audit consumers only.
   * @param keys        Plaintext key names present in the cipher, enumerated
   *                    from the unencrypted YAML top-level keys (no decrypt
   *                    required since SOPS stores key names in plaintext).
   * @param rotations   Rotation records from `.clef-meta.yaml`.  Records for
   *                    keys not in `keys` are ignored (those are orphans;
   *                    lint surfaces them as a warning).
   * @param now         Reference time.  Inject for deterministic tests.
   */
  evaluateFile(
    filePath: string,
    environment: string,
    metadata: SopsMetadata,
    keys: string[],
    rotations: RotationRecord[],
    now: Date = new Date(),
  ): FileRotationStatus {
    const maxAgeDays = this.resolveMaxAgeDays(environment);
    const byKey = new Map(rotations.map((r) => [r.key, r]));

    const keyStatuses: KeyRotationStatus[] = keys.map((key) =>
      this.evaluateKey(key, byKey.get(key), maxAgeDays, now),
    );

    return {
      path: filePath,
      environment,
      backend: metadata.backend,
      recipients: metadata.recipients,
      last_modified: metadata.lastModified.toISOString(),
      last_modified_known: metadata.lastModifiedPresent !== false,
      keys: keyStatuses,
      // Cell-level compliance is the AND of per-key verdicts.  An empty
      // `keys` array (cell with no secrets) is vacuously compliant.
      compliant: keyStatuses.every((k) => k.compliant),
    };
  }

  private evaluateKey(
    key: string,
    record: RotationRecord | undefined,
    maxAgeDays: number,
    now: Date,
  ): KeyRotationStatus {
    if (!record) {
      // Unknown rotation state.  Per the design rule, unknown = violation —
      // we can't prove the value has been rotated within the window, so we
      // don't claim it.
      return {
        key,
        last_rotated_at: null,
        last_rotated_known: false,
        rotated_by: null,
        rotation_count: 0,
        rotation_due: null,
        rotation_overdue: false,
        days_overdue: 0,
        compliant: false,
      };
    }

    const rotationDue = new Date(record.lastRotatedAt.getTime() + maxAgeDays * MS_PER_DAY);
    const rotationOverdue = now.getTime() > rotationDue.getTime();
    const daysOverdue = rotationOverdue
      ? Math.floor((now.getTime() - rotationDue.getTime()) / MS_PER_DAY)
      : 0;

    return {
      key,
      last_rotated_at: record.lastRotatedAt.toISOString(),
      last_rotated_known: true,
      rotated_by: record.rotatedBy,
      rotation_count: record.rotationCount,
      rotation_due: rotationDue.toISOString(),
      rotation_overdue: rotationOverdue,
      days_overdue: daysOverdue,
      compliant: !rotationOverdue,
    };
  }

  private resolveMaxAgeDays(environment: string): number {
    const envOverride = this.policy.rotation?.environments?.[environment];
    if (envOverride !== undefined) return envOverride.max_age_days;
    return this.policy.rotation?.max_age_days ?? DEFAULT_MAX_AGE_DAYS;
  }
}
