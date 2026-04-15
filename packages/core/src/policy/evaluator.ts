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
import { FileRotationStatus, PolicyDocument } from "./types";

const MS_PER_DAY = 86_400_000;
/** Default `max_age_days` applied when policy omits the rotation block entirely. */
const DEFAULT_MAX_AGE_DAYS = 90;

/**
 * Evaluates SOPS file metadata against a {@link PolicyDocument}.
 *
 * The evaluator is intentionally pure — it never reads the filesystem and
 * never decrypts.  All inputs come from the caller.
 */
export class PolicyEvaluator {
  constructor(private readonly policy: PolicyDocument) {}

  /**
   * Evaluate a single encrypted file's rotation state.
   *
   * @param filePath    Repo-relative or absolute path to the encrypted file.
   * @param environment Environment name from the matrix; selects per-env
   *                    overrides if present in the policy.
   * @param metadata    Result of `SopsClient.getMetadata()` for the file.
   * @param now         Reference time (defaults to `new Date()`).  Inject for
   *                    deterministic tests and reproducible audits.
   */
  evaluateFile(
    filePath: string,
    environment: string,
    metadata: SopsMetadata,
    now: Date = new Date(),
  ): FileRotationStatus {
    const maxAgeDays = this.resolveMaxAgeDays(environment);

    const rotationDue = new Date(metadata.lastModified.getTime() + maxAgeDays * MS_PER_DAY);
    const rotationOverdue = now.getTime() > rotationDue.getTime();
    const daysOverdue = rotationOverdue
      ? Math.floor((now.getTime() - rotationDue.getTime()) / MS_PER_DAY)
      : 0;

    return {
      path: filePath,
      environment,
      backend: metadata.backend,
      recipients: metadata.recipients,
      last_modified: metadata.lastModified.toISOString(),
      // Treat a missing `lastModifiedPresent` as `true` — the field is
      // optional on SopsMetadata and only `parseMetadataFromFile` knows
      // authoritatively whether the underlying file carried `sops.lastmodified`.
      // Hand-constructed metadata is assumed trustworthy.
      last_modified_known: metadata.lastModifiedPresent !== false,
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
