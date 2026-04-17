import { createHash } from "crypto";
import { LintResult } from "../types";
import { ScanResult } from "../scanner";
import { FileRotationStatus, PolicyDocument } from "../policy/types";
import { ComplianceGenerator } from "./generator";

const NOW = new Date("2026-04-14T00:00:00Z");

function emptyScan(): ScanResult {
  return {
    matches: [],
    filesScanned: 0,
    filesSkipped: 0,
    unencryptedMatrixFiles: [],
    durationMs: 0,
  };
}

function emptyLint(): LintResult {
  return { issues: [], fileCount: 0, pendingCount: 0 };
}

function statusOf(overrides: Partial<FileRotationStatus> = {}): FileRotationStatus {
  return {
    path: "api/dev.enc.yaml",
    environment: "dev",
    backend: "age",
    recipients: ["age1abc"],
    last_modified: "2026-03-01T00:00:00.000Z",
    last_modified_known: true,
    keys: [],
    compliant: true,
    ...overrides,
  };
}

describe("ComplianceGenerator", () => {
  const generator = new ComplianceGenerator();

  describe("schema", () => {
    it("stamps schema_version '1' (string)", () => {
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.schema_version).toBe("1");
      // Belt-and-braces: explicit string check, not numeric coercion
      expect(typeof doc.schema_version).toBe("string");
    });

    it("uses the injected `now` for generated_at when provided", () => {
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.generated_at).toBe(NOW.toISOString());
    });

    it("falls back to current time when `now` is omitted", () => {
      const before = Date.now();
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
      });
      const stamped = new Date(doc.generated_at).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });

    it("inlines policy_snapshot verbatim (round-trips through JSON)", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: { production: { max_age_days: 30 } },
        },
      };
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy,
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(JSON.parse(JSON.stringify(doc.policy_snapshot))).toEqual(policy);
    });

    it("propagates sha, repo, scan, lint, and files unchanged", () => {
      const scan = emptyScan();
      const lint = emptyLint();
      const files = [statusOf()];
      const doc = generator.generate({
        sha: "deadbeef",
        repo: "clef-sh/clef",
        policy: { version: 1 },
        scanResult: scan,
        lintResult: lint,
        files,
        now: NOW,
      });
      expect(doc.sha).toBe("deadbeef");
      expect(doc.repo).toBe("clef-sh/clef");
      expect(doc.scan).toBe(scan);
      expect(doc.lint).toBe(lint);
      expect(doc.files).toBe(files);
    });
  });

  describe("policy_hash", () => {
    it("is sha256: + 64 hex chars", () => {
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.policy_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("is identical for policies that differ only in key order", () => {
      const a: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: {
            production: { max_age_days: 30 },
            dev: { max_age_days: 365 },
          },
        },
      };
      // Same policy, JSON-equivalent but with rearranged property insertion order
      const b: PolicyDocument = JSON.parse(
        JSON.stringify({
          rotation: {
            environments: {
              dev: { max_age_days: 365 },
              production: { max_age_days: 30 },
            },
            max_age_days: 90,
          },
          version: 1,
        }),
      );
      expect(ComplianceGenerator.hashPolicy(a)).toBe(ComplianceGenerator.hashPolicy(b));
    });

    it("differs for materially different policies", () => {
      const a: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const b: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      expect(ComplianceGenerator.hashPolicy(a)).not.toBe(ComplianceGenerator.hashPolicy(b));
    });

    it("matches the generator's policy_hash", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 45 } };
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy,
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.policy_hash).toBe(ComplianceGenerator.hashPolicy(policy));
    });

    it("produces a stable hex value for a known input", () => {
      // Lock the canonicalization output so a refactor cannot silently shift
      // every previously archived hash.  Recompute by hand if you must change
      // the canonicalizer, and bump schema_version.
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const expected = createHash("sha256")
        .update('{"rotation":{"max_age_days":90},"version":1}')
        .digest("hex");
      expect(ComplianceGenerator.hashPolicy(policy)).toBe(`sha256:${expected}`);
    });

    it("handles arrays in the policy without sorting their elements", () => {
      // We don't currently use arrays in PolicyDocument, but the canonicalizer
      // is a general-purpose routine and array element order is semantically
      // meaningful.  Lock that behavior here.
      const a = { items: ["b", "a"] } as unknown as PolicyDocument;
      const b = { items: ["a", "b"] } as unknown as PolicyDocument;
      expect(ComplianceGenerator.hashPolicy(a)).not.toBe(ComplianceGenerator.hashPolicy(b));
    });
  });

  describe("summary", () => {
    it("counts compliant and overdue files", () => {
      const files = [
        statusOf({ compliant: true }),
        statusOf({ compliant: true }),
        // Non-compliant cell → counted in rotation_overdue summary (the
        // cell-level summary now tracks "any non-compliant cell" rather
        // than the old file-level rotation_overdue flag).
        statusOf({ compliant: false }),
      ];
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files,
        now: NOW,
      });
      expect(doc.summary.total_files).toBe(3);
      expect(doc.summary.compliant).toBe(2);
      expect(doc.summary.rotation_overdue).toBe(1);
    });

    it("counts scan_violations from scan.matches.length", () => {
      const scan: ScanResult = {
        matches: [
          {
            file: "a",
            line: 1,
            column: 1,
            matchType: "pattern",
            patternName: "AWS Access Key",
            preview: "AKIA••••",
          },
          {
            file: "b",
            line: 2,
            column: 1,
            matchType: "entropy",
            preview: "abcd••••",
          },
        ],
        filesScanned: 5,
        filesSkipped: 0,
        unencryptedMatrixFiles: [],
        durationMs: 0,
      };
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: scan,
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.summary.scan_violations).toBe(2);
    });

    it("counts only severity=error lint issues", () => {
      const lint: LintResult = {
        issues: [
          { severity: "error", category: "matrix", file: "a", message: "x" },
          { severity: "warning", category: "schema", file: "b", message: "y" },
          { severity: "error", category: "sops", file: "c", message: "z" },
          { severity: "info", category: "matrix", file: "d", message: "w" },
        ],
        fileCount: 4,
        pendingCount: 0,
      };
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: lint,
        files: [],
        now: NOW,
      });
      expect(doc.summary.lint_errors).toBe(2);
    });

    it("returns zeroed summary for an empty matrix", () => {
      const doc = generator.generate({
        sha: "abc",
        repo: "o/r",
        policy: { version: 1 },
        scanResult: emptyScan(),
        lintResult: emptyLint(),
        files: [],
        now: NOW,
      });
      expect(doc.summary).toEqual({
        total_files: 0,
        compliant: 0,
        rotation_overdue: 0,
        scan_violations: 0,
        lint_errors: 0,
      });
    });
  });
});
