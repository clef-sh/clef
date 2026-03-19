import { LintIssue } from "../types";
import { ReportSanitizer } from "./sanitizer";

const sanitizer = new ReportSanitizer();

describe("ReportSanitizer", () => {
  it("returns zero counts and empty issues for empty input", () => {
    const result = sanitizer.sanitize([]);
    expect(result.issueCount).toEqual({ error: 0, warning: 0, info: 0 });
    expect(result.issues).toHaveLength(0);
  });

  it("groups schema errors with keys by file — no key names in output", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "schema",
        file: "database/dev.enc.yaml",
        key: "DB_PASSWORD",
        message: "Required key DB_PASSWORD is missing.",
      },
      {
        severity: "error",
        category: "schema",
        file: "database/dev.enc.yaml",
        key: "DB_HOST",
        message: "Required key DB_HOST is missing.",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.error).toBe(1);
    const issue = result.issues[0];
    expect(issue.severity).toBe("error");
    expect(issue.category).toBe("schema");
    expect(issue.file).toBe("database/dev.enc.yaml");
    expect(issue.count).toBe(2);
    expect(issue.message).toBe("2 keys fail schema validation");
    expect(issue.message).not.toContain("DB_PASSWORD");
    expect(issue.message).not.toContain("DB_HOST");
  });

  it("groups pending-key warnings by file, reclassifies to info/matrix", () => {
    const issues: LintIssue[] = [
      {
        severity: "warning",
        category: "schema",
        file: "app/staging.enc.yaml",
        key: "API_KEY",
        message: "Value is a random placeholder \u2014 replace with the real secret.",
        fixCommand: "clef set app/staging API_KEY",
      },
      {
        severity: "warning",
        category: "schema",
        file: "app/staging.enc.yaml",
        key: "SECRET_TOKEN",
        message: "Value is a random placeholder \u2014 replace with the real secret.",
        fixCommand: "clef set app/staging SECRET_TOKEN",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.info).toBe(1);
    expect(result.issueCount.warning).toBe(0);
    const issue = result.issues[0];
    expect(issue.severity).toBe("info");
    expect(issue.category).toBe("matrix");
    expect(issue.file).toBe("app/staging.enc.yaml");
    expect(issue.count).toBe(2);
    expect(issue.message).toBe("2 pending keys awaiting values");
    expect(issue.message).not.toContain("API_KEY");
    expect(issue.message).not.toContain("SECRET_TOKEN");
  });

  it("drops schema info issues with keys entirely", () => {
    const issues: LintIssue[] = [
      {
        severity: "info",
        category: "schema",
        file: "app/dev.enc.yaml",
        key: "MY_SECRET",
        message: "Key 'MY_SECRET' has no schema definition.",
      },
      {
        severity: "info",
        category: "schema",
        file: "app/dev.enc.yaml",
        key: "OTHER_KEY",
        message: "Key 'OTHER_KEY' has no schema definition.",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issues).toHaveLength(0);
    expect(result.issueCount).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it("groups cross-env drift issues by namespace/targetEnv/sourceEnvs", () => {
    const issues: LintIssue[] = [
      {
        severity: "warning",
        category: "matrix",
        file: "database/dev.enc.yaml",
        key: "DB_REPLICA_URL",
        message: "Key 'DB_REPLICA_URL' is missing in dev but present in staging, prod.",
        fixCommand: "clef set database/dev DB_REPLICA_URL <value>",
      },
      {
        severity: "warning",
        category: "matrix",
        file: "database/dev.enc.yaml",
        key: "DB_POOL_SIZE",
        message: "Key 'DB_POOL_SIZE' is missing in dev but present in staging, prod.",
        fixCommand: "clef set database/dev DB_POOL_SIZE <value>",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.warning).toBe(1);
    const issue = result.issues[0];
    expect(issue.severity).toBe("warning");
    expect(issue.category).toBe("drift");
    expect(issue.namespace).toBe("database");
    expect(issue.environment).toBe("dev");
    expect(issue.sourceEnvironment).toBe("staging, prod");
    expect(issue.driftCount).toBe(2);
    expect(issue.message).toBe("2 keys in [staging, prod] missing from dev");
    expect(issue.message).not.toContain("DB_REPLICA_URL");
    expect(issue.message).not.toContain("DB_POOL_SIZE");
  });

  it("passes through matrix completeness issues without keys", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "matrix",
        file: "database/dev.enc.yaml",
        message: "Missing encrypted file for database/dev.",
        fixCommand: "clef init",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.error).toBe(1);
    const issue = result.issues[0];
    expect(issue.severity).toBe("error");
    expect(issue.category).toBe("matrix");
    expect(issue.file).toBe("database/dev.enc.yaml");
    expect(issue.message).toBe("Missing encrypted file for database/dev.");
  });

  it("passes through SOPS integrity issues without keys", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "sops",
        file: "secrets/prod.enc.yaml",
        message: "Could not validate SOPS metadata. The file may be corrupted.",
      },
      {
        severity: "info",
        category: "sops",
        file: "secrets/dev.enc.yaml",
        message: "File is encrypted with only 1 recipient(s).",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.error).toBe(1);
    expect(result.issueCount.info).toBe(1);
    expect(result.issues[0].category).toBe("sops");
    expect(result.issues[1].category).toBe("sops");
  });

  it("passes through recipient drift warnings without keys", () => {
    const issues: LintIssue[] = [
      {
        severity: "warning",
        category: "sops",
        file: "database/prod.enc.yaml",
        message: "Expected recipient 'age1…abcdef12' is missing from encrypted file.",
        fixCommand: "clef recipients add age1xyz -e prod",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.warning).toBe(1);
    const issue = result.issues[0];
    expect(issue.category).toBe("sops");
    expect(issue.message).toContain("Expected recipient");
  });

  it("passes through service-identity issues unchanged", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "service-identity",
        file: "clef.yaml",
        message: "Service identity 'deploy-bot' references non-existent namespace 'payments'.",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.error).toBe(1);
    const issue = result.issues[0];
    expect(issue.category).toBe("service-identity");
    expect(issue.message).toContain("deploy-bot");
  });

  it("strips fixCommand from all pass-through issues", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "matrix",
        file: "ns/env.enc.yaml",
        message: "Missing file.",
        fixCommand: "clef init",
      },
      {
        severity: "warning",
        category: "sops",
        file: "ns/env.enc.yaml",
        message: "Recipient issue.",
        fixCommand: "clef recipients add key -e env",
      },
    ];
    const result = sanitizer.sanitize(issues);
    for (const issue of result.issues) {
      expect((issue as { fixCommand?: string }).fixCommand).toBeUndefined();
    }
  });

  it("emits no key field in any output issue", () => {
    const issues: LintIssue[] = [
      {
        severity: "error",
        category: "schema",
        file: "a/b.enc.yaml",
        key: "SECRET",
        message: "Missing.",
      },
      {
        severity: "warning",
        category: "matrix",
        file: "a/b.enc.yaml",
        key: "OTHER",
        message: "Key 'OTHER' is missing in dev but present in prod.",
      },
      {
        severity: "info",
        category: "schema",
        file: "a/b.enc.yaml",
        key: "NOISY",
        message: "No schema.",
      },
    ];
    const result = sanitizer.sanitize(issues);
    for (const issue of result.issues) {
      expect((issue as { key?: string }).key).toBeUndefined();
    }
  });

  it("correctly aggregates issue counts by severity", () => {
    const issues: LintIssue[] = [
      { severity: "error", category: "schema", file: "a.enc.yaml", key: "K1", message: "Err1." },
      { severity: "error", category: "matrix", file: "b.enc.yaml", message: "Missing." },
      { severity: "warning", category: "sops", file: "c.enc.yaml", message: "Warn1." },
      { severity: "warning", category: "sops", file: "d.enc.yaml", message: "Warn2." },
      {
        severity: "warning",
        category: "schema",
        file: "e.enc.yaml",
        key: "PK",
        message: "Value is a random placeholder \u2014 replace with the real secret.",
      },
      { severity: "info", category: "sops", file: "f.enc.yaml", message: "Single recipient." },
    ];
    const result = sanitizer.sanitize(issues);
    // errors: schema group (1) + missing matrix (1) = 2
    expect(result.issueCount.error).toBe(2);
    // warnings: sops (2) = 2 (pending reclassified to info)
    expect(result.issueCount.warning).toBe(2);
    // info: sops (1) + pending reclassified (1) = 2
    expect(result.issueCount.info).toBe(2);
  });

  it("groups schema warnings with keys (non-placeholder) by file", () => {
    const issues: LintIssue[] = [
      {
        severity: "warning",
        category: "schema",
        file: "app/dev.enc.yaml",
        key: "OPTIONAL_FIELD",
        message: "Optional key OPTIONAL_FIELD not present.",
      },
    ];
    const result = sanitizer.sanitize(issues);
    expect(result.issueCount.warning).toBe(1);
    const issue = result.issues[0];
    expect(issue.category).toBe("schema");
    expect(issue.severity).toBe("warning");
    expect(issue.message).toBe("1 key has schema warnings");
    expect(issue.message).not.toContain("OPTIONAL_FIELD");
  });
});
