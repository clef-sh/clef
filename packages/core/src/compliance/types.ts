/**
 * Compliance artifact schema produced by {@link ComplianceGenerator}.
 *
 * **Public artifact contract.** These types describe the shape of
 * `compliance.json`, the artifact that the GitHub Action uploads on every
 * merge.  Bots, dashboards, and audit tooling re-parse this artifact months
 * or years after it was written.  Renaming or removing fields silently
 * breaks observability — bump {@link ComplianceDocument.schema_version}
 * and provide a migration if you need to.  Adding optional fields is safe.
 */

import { LintResult } from "../types";
import { ScanResult } from "../scanner";
import { FileRotationStatus, PolicyDocument } from "../policy/types";

/** Aggregate counts surfaced in {@link ComplianceDocument.summary}. */
export interface ComplianceSummary {
  total_files: number;
  /** Files where `rotation_overdue === false`. */
  compliant: number;
  rotation_overdue: number;
  /** Count of {@link ScanResult.matches} entries. */
  scan_violations: number;
  /** Count of {@link LintResult.issues} entries with `severity === 'error'`. */
  lint_errors: number;
}

/**
 * Top-level compliance document. Stable schema — do not break consumers.
 *
 * `policy_snapshot` is inlined so downstream tooling (the bot, the dashboard,
 * auditors) never needs to re-fetch `.clef/policy.yaml` to interpret the
 * verdicts.  `policy_hash` is the canonical-JSON SHA-256 of that snapshot,
 * usable for cross-repo drift detection without parsing the snapshot itself.
 */
export interface ComplianceDocument {
  /** Bumped whenever the schema breaks consumer compatibility. */
  schema_version: "1";
  /** ISO 8601 timestamp of when this document was generated. */
  generated_at: string;
  /** Git commit SHA of the merge commit that triggered this run. */
  sha: string;
  /** Repository in `owner/repo` format. */
  repo: string;
  /** `sha256:` + hex SHA-256 of canonicalized JSON of `policy_snapshot`. */
  policy_hash: string;
  /** Inline copy of the policy used for this evaluation. */
  policy_snapshot: PolicyDocument;
  summary: ComplianceSummary;
  /** Per-file rotation verdicts.  One entry per existing matrix file. */
  files: FileRotationStatus[];
  /** Full scan result. */
  scan: ScanResult;
  /** Full lint result. */
  lint: LintResult;
}

/** Inputs for {@link ComplianceGenerator.generate}. */
export interface GenerateOptions {
  /** Git commit SHA of the merge commit being evaluated. */
  sha: string;
  /** Repository in `owner/repo` format. */
  repo: string;
  /** Resolved policy document (extends/merges already applied by the caller). */
  policy: PolicyDocument;
  scanResult: ScanResult;
  lintResult: LintResult;
  /** Per-file rotation verdicts from {@link PolicyEvaluator.evaluateFile}. */
  files: FileRotationStatus[];
  /**
   * Reference time for `generated_at`.  Defaults to `new Date()`.  Inject for
   * deterministic tests and reproducible artifacts.
   */
  now?: Date;
}
