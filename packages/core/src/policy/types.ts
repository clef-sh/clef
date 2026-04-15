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
 * Result of evaluating a single encrypted file against a {@link PolicyDocument}.
 *
 * Field names are part of the public compliance artifact contract — see the
 * notice at the top of this file.
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
   * `false` means `last_modified` is a synthetic fallback and the rotation
   * verdict should be treated with suspicion (tooling should surface this
   * distinctly from a normal "compliant" verdict).
   */
  last_modified_known: boolean;
  /** ISO 8601. Computed as `last_modified + max_age_days`. */
  rotation_due: string;
  rotation_overdue: boolean;
  /** `0` when not overdue. */
  days_overdue: number;
  /** `false` if `rotation_overdue`; `true` otherwise. */
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
