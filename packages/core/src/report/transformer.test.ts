import { ClefReport } from "../types";
import { ReportTransformer } from "./transformer";

function makeReport(overrides: Partial<ClefReport> = {}): ClefReport {
  return {
    schemaVersion: 1,
    repoIdentity: {
      repoOrigin: "github.com/org/repo",
      commitSha: "abc1234567890def",
      branch: "main",
      commitTimestamp: "2024-06-15T12:00:00Z",
      reportGeneratedAt: "2024-06-15T12:01:00Z",
      clefVersion: "1.2.0",
      sopsVersion: "3.9.4",
    },
    manifest: {
      manifestVersion: 1,
      filePattern: "{namespace}/{environment}.enc.yaml",
      environments: [
        { name: "dev", protected: false },
        { name: "prod", protected: true },
      ],
      namespaces: [
        { name: "database", hasSchema: true, owners: [] },
        { name: "auth", hasSchema: false, owners: [] },
      ],
      defaultBackend: "age",
    },
    matrix: [
      {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: true,
        keyCount: 5,
        pendingCount: 0,
        metadata: {
          backend: "age",
          recipients: ["age1abc"],
          lastModified: "2024-06-15T10:00:00.000Z",
        },
      },
      {
        namespace: "database",
        environment: "prod",
        filePath: "/repo/database/prod.enc.yaml",
        exists: true,
        keyCount: 5,
        pendingCount: 1,
        metadata: {
          backend: "age",
          recipients: ["age1abc"],
          lastModified: "2024-06-15T10:00:00.000Z",
        },
      },
      {
        namespace: "auth",
        environment: "dev",
        filePath: "/repo/auth/dev.enc.yaml",
        exists: true,
        keyCount: 3,
        pendingCount: 0,
        metadata: {
          backend: "age",
          recipients: ["age1abc"],
          lastModified: "2024-06-15T10:00:00.000Z",
        },
      },
      {
        namespace: "auth",
        environment: "prod",
        filePath: "/repo/auth/prod.enc.yaml",
        exists: false,
        keyCount: 0,
        pendingCount: 0,
        metadata: null,
      },
    ],
    policy: {
      issueCount: { error: 1, warning: 2, info: 0 },
      issues: [
        {
          severity: "error",
          category: "schema",
          file: "/repo/database/dev.enc.yaml",
          namespace: "database",
          environment: "dev",
          message: "1 key fails schema validation",
          count: 1,
        },
        {
          severity: "warning",
          category: "drift",
          namespace: "auth",
          environment: "prod",
          sourceEnvironment: "dev",
          driftCount: 2,
          message: "2 keys in [dev] missing from prod",
        },
        {
          severity: "warning",
          category: "schema",
          file: "/repo/database/prod.enc.yaml",
          namespace: "database",
          environment: "prod",
          message: "1 key has schema warnings",
          count: 1,
        },
      ],
    },
    recipients: {
      age1abc: { type: "age", environments: ["dev", "prod"], fileCount: 3 },
    },
    ...overrides,
  };
}

describe("ReportTransformer", () => {
  let transformer: ReportTransformer;

  beforeEach(() => {
    transformer = new ReportTransformer();
  });

  it("maps commitSha, branch, and cliVersion from repoIdentity", () => {
    const result = transformer.transform(makeReport());
    expect(result.commitSha).toBe("abc1234567890def");
    expect(result.branch).toBe("main");
    expect(result.cliVersion).toBe("1.2.0");
  });

  it("converts commitTimestamp to epoch ms", () => {
    const result = transformer.transform(makeReport());
    expect(result.commitTimestamp).toBe(new Date("2024-06-15T12:00:00Z").getTime());
  });

  it("computes summary.filesScanned from matrix length", () => {
    const result = transformer.transform(makeReport());
    expect(result.summary.filesScanned).toBe(4);
  });

  it("deduplicates namespaces and environments in summary", () => {
    const result = transformer.transform(makeReport());
    expect(result.summary.namespaces).toEqual(["database", "auth"]);
    expect(result.summary.environments).toEqual(["dev", "prod"]);
  });

  it("counts violations as error-severity issues", () => {
    const result = transformer.transform(makeReport());
    expect(result.summary.violations).toBe(1);
    expect(result.summary.passed).toBe(false);
  });

  it("marks passed=true when no errors", () => {
    const report = makeReport({
      policy: { issueCount: { error: 0, warning: 1, info: 0 }, issues: [] },
    });
    const result = transformer.transform(report);
    expect(result.summary.passed).toBe(true);
  });

  describe("cell health status", () => {
    it("marks non-existent cells as unknown", () => {
      const result = transformer.transform(makeReport());
      const authProd = result.summary.cells.find(
        (c) => c.namespace === "auth" && c.environment === "prod",
      );
      expect(authProd?.healthStatus).toBe("unknown");
      expect(authProd?.description).toBe("File does not exist");
    });

    it("marks cells with error issues as critical", () => {
      const result = transformer.transform(makeReport());
      const dbDev = result.summary.cells.find(
        (c) => c.namespace === "database" && c.environment === "dev",
      );
      expect(dbDev?.healthStatus).toBe("critical");
    });

    it("marks cells with pending keys as warning", () => {
      const result = transformer.transform(makeReport());
      const dbProd = result.summary.cells.find(
        (c) => c.namespace === "database" && c.environment === "prod",
      );
      expect(dbProd?.healthStatus).toBe("warning");
    });

    it("marks clean cells as healthy", () => {
      const report = makeReport({
        policy: { issueCount: { error: 0, warning: 0, info: 0 }, issues: [] },
      });
      report.matrix = [report.matrix[0]];
      report.matrix[0].pendingCount = 0;
      const result = transformer.transform(report);
      expect(result.summary.cells[0].healthStatus).toBe("healthy");
    });
  });

  describe("drift", () => {
    it("builds drift entries for each namespace", () => {
      const result = transformer.transform(makeReport());
      expect(result.drift).toHaveLength(2);
    });

    it("marks namespace with drift issues as isDrifted", () => {
      const result = transformer.transform(makeReport());
      const authDrift = result.drift.find((d) => d.namespace === "auth");
      expect(authDrift?.isDrifted).toBe(true);
      expect(authDrift?.driftCount).toBe(2);
    });

    it("marks namespace without drift as not drifted", () => {
      const result = transformer.transform(makeReport());
      const dbDrift = result.drift.find((d) => d.namespace === "database");
      expect(dbDrift?.isDrifted).toBe(false);
      expect(dbDrift?.driftCount).toBe(0);
    });
  });

  describe("policyResults", () => {
    it("maps each issue to a policy result", () => {
      const result = transformer.transform(makeReport());
      expect(result.policyResults).toHaveLength(3);
    });

    it("sets ruleId as category/severity", () => {
      const result = transformer.transform(makeReport());
      expect(result.policyResults[0].ruleId).toBe("schema/error");
    });

    it("sets passed=false for error severity", () => {
      const result = transformer.transform(makeReport());
      const errorResult = result.policyResults.find((p) => p.severity === "error");
      expect(errorResult?.passed).toBe(false);
    });

    it("sets passed=true for non-error severity", () => {
      const result = transformer.transform(makeReport());
      const warningResult = result.policyResults.find((p) => p.severity === "warning");
      expect(warningResult?.passed).toBe(true);
    });

    it("includes scope when namespace/environment present", () => {
      const result = transformer.transform(makeReport());
      const driftResult = result.policyResults.find((p) => p.ruleId === "drift/warning");
      expect(driftResult?.scope).toEqual({ namespace: "auth", environment: "prod" });
    });
  });

  it("does not include ciContext by default", () => {
    const result = transformer.transform(makeReport());
    expect(result.ciContext).toBeUndefined();
  });

  it("handles empty matrix", () => {
    const report = makeReport({ matrix: [] });
    const result = transformer.transform(report);
    expect(result.summary.filesScanned).toBe(0);
    expect(result.summary.cells).toEqual([]);
    expect(result.drift).toEqual([]);
  });
});
