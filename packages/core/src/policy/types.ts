/**
 * Public types for `.clef/policy.yaml` and the per-file evaluation results
 * produced by {@link PolicyEvaluator}.
 *
 * These types are part of the compliance artifact contract — renaming or
 * removing any field here breaks downstream consumers (the compliance GitHub
 * Action, dashboards, and audit tooling that re-reads compliance documents).
 * Add fields freely; do not rename or repurpose existing ones without bumping
 * the artifact `schema_version`.
 */

import { BackendType } from "../types";

/** Per-environment override of {@link PolicyRotationConfig.max_age_days}. */
export interface PolicyEnvironmentRotation {
  /** Maximum secret age in days before rotation is required for this environment. */
  max_age_days: number;
}

/** Rotation policy block of {@link PolicyDocument}. */
export interface PolicyRotationConfig {
  /** Maximum secret age in days before rotation is required. */
  max_age_days: number;
  /**
   * Per-environment overrides keyed by environment name (must match
   * `clef.yaml`). Takes precedence over the top-level `max_age_days`.
   */
  environments?: Record<string, PolicyEnvironmentRotation>;
}

/** Parsed contents of `.clef/policy.yaml`. */
export interface PolicyDocument {
  version: 1;
  rotation?: PolicyRotationConfig;
}

/**
 * Per-key rotation verdict inside a {@link FileRotationStatus}.  Each entry
 * corresponds to one plaintext key present in the encrypted file.
 *
 * The authoritative signal is `last_rotated_at` from `.clef-meta.yaml`
 * (recorded by `clef set` / `clef import` when a value actually changes).
 * When no record exists, `last_rotated_known: false` and `compliant: false` —
 * unknown rotation state is treated as a policy violation by design.
 */
export interface KeyRotationStatus {
  /** Key name as it appears in the cipher (plaintext). */
  key: string;
  /** ISO 8601 of the last recorded rotation, or `null` when unknown. */
  last_rotated_at: string | null;
  /** Whether `.clef-meta.yaml` had a rotation record for this key. */
  last_rotated_known: boolean;
  /** Git identity that performed the last rotation, or `null` when unknown. */
  rotated_by: string | null;
  /** Monotonically increasing counter across rotations, or `0` when unknown. */
  rotation_count: number;
  /** `last_rotated_at + max_age_days`.  `null` when `last_rotated_known: false`. */
  rotation_due: string | null;
  /** `true` iff the rotation is known and past due. */
  rotation_overdue: boolean;
  /** `0` when not overdue or unknown. */
  days_overdue: number;
  /** `true` iff `last_rotated_known && !rotation_overdue`. */
  compliant: boolean;
}

/**
 * Result of evaluating a single encrypted file against a {@link PolicyDocument}.
 *
 * Field names are part of the public compliance artifact contract — see the
 * notice at the top of this file.
 *
 * The policy gate is driven by per-key rotation state (`keys[*].compliant`).
 * `compliant` on this struct is the AND of the per-key verdicts.  File-level
 * rotation fields are intentionally absent — `sops.lastmodified` is a file
 * freshness signal, not a value-rotation signal, and the two answer different
 * questions (see the rotation policy docs for rationale).
 */
export interface FileRotationStatus {
  /** Repo-relative or absolute path the evaluator was given. */
  path: string;
  /** Environment name resolved from the matrix. */
  environment: string;
  backend: BackendType;
  recipients: string[];
  /** ISO 8601 timestamp from `sops.lastmodified`, or the parse-time fallback. */
  last_modified: string;
  /**
   * Whether the underlying SOPS file actually carried a `lastmodified` field.
   * `false` means `last_modified` is a synthetic fallback.  Kept as a raw
   * signal for audit consumers; does not gate policy.
   */
  last_modified_known: boolean;
  /** Per-key rotation verdicts.  Empty array only for cells that have no keys. */
  keys: KeyRotationStatus[];
  /** AND of `keys[*].compliant`.  `true` only when every key is compliant. */
  compliant: boolean;
}

/**
 * Default policy applied when `.clef/policy.yaml` is absent.
 *
 * **Frozen on purpose.** Compliance artifacts embed the resolved policy and
 * its hash; mutating this object would silently invalidate every previously
 * archived `policy_hash`. Use a fresh object if you need a different default.
 */
export const DEFAULT_POLICY: PolicyDocument = Object.freeze({
  version: 1 as const,
  rotation: Object.freeze({ max_age_days: 90 }),
}) as PolicyDocument;
