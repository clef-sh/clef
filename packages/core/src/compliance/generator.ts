/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module produces the compliance artifact that downstream tooling
 * (the GitHub Action bot, dashboards, auditors) parses long after the
 * generating run has finished.  The artifact's hash is used for cross-repo
 * policy-drift detection — a non-deterministic hash silently breaks that
 * detection at scale.  Before adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import { createHash } from "crypto";
import { ComplianceDocument, ComplianceSummary, GenerateOptions } from "./types";
import { FileRotationStatus, PolicyDocument } from "../policy/types";
import { LintResult } from "../types";
import { ScanResult } from "../scanner";

const SCHEMA_VERSION = "1" as const;

/**
 * Stable, recursive JSON serializer with sorted object keys.  `JSON.stringify`
 * preserves insertion order, which is enough for V8 today but not a spec
 * guarantee — and per-key order leakage from YAML parsers, network DTOs, or
 * future Node versions would silently change `policy_hash` for an unchanged
 * policy.  Sorting keys deterministically makes the hash a function of the
 * policy *value*, not its in-memory layout.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Composes a {@link ComplianceDocument} from already-collected scan, lint,
 * policy-evaluation, and Git context inputs.  This class does no I/O — the
 * caller (the GitHub Action) owns reading `.clef/policy.yaml`, walking the
 * matrix, and invoking the runners.
 */
export class ComplianceGenerator {
  generate(opts: GenerateOptions): ComplianceDocument {
    const { sha, repo, policy, scanResult, lintResult, files, now } = opts;

    const generated_at = (now ?? new Date()).toISOString();
    const policy_hash = `sha256:${createHash("sha256").update(canonicalJson(policy)).digest("hex")}`;

    return {
      schema_version: SCHEMA_VERSION,
      generated_at,
      sha,
      repo,
      policy_hash,
      policy_snapshot: policy,
      summary: this.buildSummary(scanResult, lintResult, files),
      files,
      scan: scanResult,
      lint: lintResult,
    };
  }

  /**
   * Compute a {@link ComplianceDocument.policy_hash}-format hash of any
   * {@link PolicyDocument} without generating a full document.  Useful for
   * external consumers that want to compare policies across repos.
   */
  static hashPolicy(policy: PolicyDocument): string {
    return `sha256:${createHash("sha256").update(canonicalJson(policy)).digest("hex")}`;
  }

  private buildSummary(
    scan: ScanResult,
    lint: LintResult,
    files: FileRotationStatus[],
  ): ComplianceSummary {
    return {
      total_files: files.length,
      compliant: files.filter((f) => f.compliant).length,
      rotation_overdue: files.filter((f) => f.rotation_overdue).length,
      scan_violations: scan.matches.length,
      lint_errors: lint.issues.filter((i) => i.severity === "error").length,
    };
  }
}
