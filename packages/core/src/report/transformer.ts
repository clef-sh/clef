import {
  ClefReport,
  CloudApiReport,
  CloudCellHealthStatus,
  CloudPolicyResult,
  CloudReportCell,
  CloudReportDrift,
  CloudReportSummary,
  ReportMatrixCell,
  ReportPolicyIssue,
} from "../types";

/**
 * Transforms a local {@link ClefReport} into the {@link CloudApiReport} payload
 * expected by the Clef Pro API. Mapping is deterministic and side-effect-free.
 */
export class ReportTransformer {
  transform(report: ClefReport): CloudApiReport {
    const summary = this.buildSummary(report);
    const drift = this.buildDrift(report);
    const policyResults = this.buildPolicyResults(report.policy.issues);

    return {
      commitSha: report.repoIdentity.commitSha,
      branch: report.repoIdentity.branch,
      commitTimestamp: new Date(report.repoIdentity.commitTimestamp).getTime(),
      cliVersion: report.repoIdentity.clefVersion,
      summary,
      drift,
      policyResults,
    };
  }

  private buildSummary(report: ClefReport): CloudReportSummary {
    const namespaces = [...new Set(report.matrix.map((c) => c.namespace))];
    const environments = [...new Set(report.matrix.map((c) => c.environment))];
    const cells = report.matrix.map((cell) => this.buildCell(cell, report.policy.issues));
    const violations = report.policy.issues.filter((i) => i.severity === "error").length;

    return {
      filesScanned: report.matrix.length,
      namespaces,
      environments,
      cells,
      violations,
      passed: violations === 0,
    };
  }

  private buildCell(cell: ReportMatrixCell, issues: ReportPolicyIssue[]): CloudReportCell {
    const healthStatus = this.computeHealthStatus(cell, issues);
    const description = this.describeCell(cell, healthStatus);

    return {
      namespace: cell.namespace,
      environment: cell.environment,
      healthStatus,
      description,
    };
  }

  private computeHealthStatus(
    cell: ReportMatrixCell,
    issues: ReportPolicyIssue[],
  ): CloudCellHealthStatus {
    if (!cell.exists) return "unknown";

    const cellIssues = issues.filter(
      (i) =>
        (i.namespace === cell.namespace && i.environment === cell.environment) ||
        (i.file !== undefined &&
          i.file.includes(cell.namespace) &&
          i.file.includes(cell.environment)),
    );

    if (cellIssues.some((i) => i.severity === "error")) return "critical";
    if (cellIssues.some((i) => i.severity === "warning") || cell.pendingCount > 0) return "warning";
    return "healthy";
  }

  private describeCell(cell: ReportMatrixCell, status: CloudCellHealthStatus): string {
    switch (status) {
      case "unknown":
        return "File does not exist";
      case "critical":
        return "Has error-severity policy issues";
      case "warning":
        return cell.pendingCount > 0
          ? `${cell.pendingCount} pending key(s) awaiting values`
          : "Has warning-severity policy issues";
      case "healthy":
        return `${cell.keyCount} key(s), no issues`;
    }
  }

  private buildDrift(report: ClefReport): CloudReportDrift[] {
    const namespaces = [...new Set(report.matrix.map((c) => c.namespace))];
    const driftIssues = report.policy.issues.filter((i) => i.category === "drift");

    return namespaces.map((namespace) => {
      const nsIssues = driftIssues.filter((i) => i.namespace === namespace);
      const totalDrift = nsIssues.reduce((sum, i) => sum + (i.driftCount ?? 1), 0);
      return {
        namespace,
        isDrifted: totalDrift > 0,
        driftCount: totalDrift,
      };
    });
  }

  private buildPolicyResults(issues: ReportPolicyIssue[]): CloudPolicyResult[] {
    return issues.map((issue) => ({
      ruleId: `${issue.category}/${issue.severity}`,
      ruleName: issue.category,
      passed: issue.severity !== "error",
      severity: issue.severity,
      message: issue.message,
      ...(issue.namespace || issue.environment
        ? {
            scope: {
              ...(issue.namespace ? { namespace: issue.namespace } : {}),
              ...(issue.environment ? { environment: issue.environment } : {}),
            },
          }
        : {}),
    }));
  }
}
