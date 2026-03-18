import { LintIssue, ReportIssueCounts, ReportPolicy, ReportPolicyIssue } from "../types";

/**
 * Transforms raw `LintIssue[]` from LintRunner into `ReportPolicy` with all
 * key names stripped and similar issues aggregated into counts.
 *
 * This is the trust boundary for Clef Cloud: nothing emitted by this class
 * should contain a secret key name.
 */
export class ReportSanitizer {
  sanitize(lintIssues: LintIssue[]): ReportPolicy {
    const output: ReportPolicyIssue[] = [];

    // ── Schema issues with a key field ──────────────────────────────────────

    const schemaWithKey = lintIssues.filter((i) => i.category === "schema" && i.key !== undefined);

    // Schema errors → group by file: "N keys fail schema validation"
    const schemaErrors = schemaWithKey.filter((i) => i.severity === "error");
    this.groupByFile(schemaErrors).forEach((issues, file) => {
      const n = issues.length;
      output.push({
        severity: "error",
        category: "schema",
        file,
        count: n,
        message: `${n} key${n !== 1 ? "s" : ""} fail schema validation`,
      });
    });

    // Schema warnings that are pending placeholders → group by file, reclassify to info/matrix
    const pendingWarnings = schemaWithKey.filter(
      (i) => i.severity === "warning" && i.message.includes("placeholder"),
    );
    this.groupByFile(pendingWarnings).forEach((issues, file) => {
      const n = issues.length;
      output.push({
        severity: "info",
        category: "matrix",
        file,
        count: n,
        message: `${n} pending key${n !== 1 ? "s" : ""} awaiting values`,
      });
    });

    // Schema warnings that are NOT pending → group by file: "N keys have schema warnings"
    const schemaWarnings = schemaWithKey.filter(
      (i) => i.severity === "warning" && !i.message.includes("placeholder"),
    );
    this.groupByFile(schemaWarnings).forEach((issues, file) => {
      const n = issues.length;
      output.push({
        severity: "warning",
        category: "schema",
        file,
        count: n,
        message: n === 1 ? "1 key has schema warnings" : `${n} keys have schema warnings`,
      });
    });

    // Schema info with key → DROP entirely (per-key noise that leaks key names)

    // ── Schema issues without a key field — pass through ────────────────────

    for (const issue of lintIssues.filter((i) => i.category === "schema" && i.key === undefined)) {
      output.push({
        severity: issue.severity,
        category: issue.category,
        file: issue.file,
        message: issue.message,
      });
    }

    // ── Matrix issues ────────────────────────────────────────────────────────

    const matrixIssues = lintIssues.filter((i) => i.category === "matrix");

    // Matrix with key = cross-env drift → group by (namespace, targetEnv, sourceEnvs)
    const driftIssues = matrixIssues.filter((i) => i.key !== undefined);
    const driftGroups = new Map<
      string,
      { namespace: string; targetEnv: string; sourceEnvs: string; count: number }
    >();
    for (const issue of driftIssues) {
      // Use indexOf/lastIndexOf instead of a regex with unbounded quantifiers to
      // avoid ReDoS on uncontrolled `issue.message` input.
      const prefix = "is missing in ";
      const middle = " but present in ";
      const pi = issue.message.indexOf(prefix);
      if (pi === -1) continue;
      const afterPrefix = issue.message.indexOf(middle, pi + prefix.length);
      if (afterPrefix === -1) continue;
      const targetEnv = issue.message.slice(pi + prefix.length, afterPrefix);
      if (!targetEnv || /\s/.test(targetEnv)) continue;
      const rest = issue.message.slice(afterPrefix + middle.length);
      if (!rest.endsWith(".")) continue;
      const sourceEnvs = rest.slice(0, -1);
      const namespace = this.extractNamespace(issue.file);
      const groupKey = `${namespace}|${targetEnv}|${sourceEnvs}`;
      const existing = driftGroups.get(groupKey);
      if (existing) {
        existing.count++;
      } else {
        driftGroups.set(groupKey, { namespace, targetEnv, sourceEnvs, count: 1 });
      }
    }
    for (const group of driftGroups.values()) {
      const n = group.count;
      output.push({
        severity: "warning",
        category: "drift",
        namespace: group.namespace,
        environment: group.targetEnv,
        sourceEnvironment: group.sourceEnvs,
        driftCount: n,
        message: `${n} key${n !== 1 ? "s" : ""} in [${group.sourceEnvs}] missing from ${group.targetEnv}`,
      });
    }

    // Matrix without key (missing file) → pass through
    for (const issue of matrixIssues.filter((i) => i.key === undefined)) {
      output.push({
        severity: issue.severity,
        category: issue.category,
        file: issue.file,
        message: issue.message,
      });
    }

    // ── SOPS issues — pass through ───────────────────────────────────────────

    for (const issue of lintIssues.filter((i) => i.category === "sops")) {
      output.push({
        severity: issue.severity,
        category: issue.category,
        file: issue.file,
        message: issue.message,
      });
    }

    // ── Service-identity issues — pass through ───────────────────────────────

    for (const issue of lintIssues.filter((i) => i.category === "service-identity")) {
      output.push({
        severity: issue.severity,
        category: issue.category,
        file: issue.file,
        message: issue.message,
      });
    }

    const issueCount: ReportIssueCounts = {
      error: output.filter((i) => i.severity === "error").length,
      warning: output.filter((i) => i.severity === "warning").length,
      info: output.filter((i) => i.severity === "info").length,
    };

    return { issueCount, issues: output };
  }

  private groupByFile(issues: LintIssue[]): Map<string, LintIssue[]> {
    const map = new Map<string, LintIssue[]>();
    for (const issue of issues) {
      const arr = map.get(issue.file) ?? [];
      arr.push(issue);
      map.set(issue.file, arr);
    }
    return map;
  }

  private extractNamespace(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : (parts[0] ?? "");
  }
}
