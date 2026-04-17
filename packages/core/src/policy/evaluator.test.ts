import { SopsMetadata } from "../types";
import { RotationRecord } from "../pending/metadata";
import { PolicyEvaluator } from "./evaluator";
import { PolicyDocument } from "./types";

const NOW = new Date("2026-04-14T00:00:00Z");
const MS_PER_DAY = 86_400_000;

function metaAt(daysAgo: number, overrides: Partial<SopsMetadata> = {}): SopsMetadata {
  const lastModified = new Date(NOW.getTime() - daysAgo * MS_PER_DAY);
  return {
    backend: "age",
    recipients: ["age1abc"],
    lastModified,
    lastModifiedPresent: true,
    ...overrides,
  };
}

function rotation(key: string, daysAgo: number, count = 1): RotationRecord {
  return {
    key,
    lastRotatedAt: new Date(NOW.getTime() - daysAgo * MS_PER_DAY),
    rotatedBy: "alice@example.com",
    rotationCount: count,
  };
}

describe("PolicyEvaluator", () => {
  describe("per-key compliance", () => {
    it("marks a key compliant when rotated within max_age_days", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(30),
        ["STRIPE_KEY"],
        [rotation("STRIPE_KEY", 30)],
        NOW,
      );

      expect(result.compliant).toBe(true);
      expect(result.keys).toHaveLength(1);
      expect(result.keys[0]).toMatchObject({
        key: "STRIPE_KEY",
        last_rotated_known: true,
        rotation_overdue: false,
        days_overdue: 0,
        compliant: true,
      });
    });

    it("marks a key overdue when rotated past max_age_days", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["OLD_KEY"],
        [rotation("OLD_KEY", 40)],
        NOW,
      );

      expect(result.keys[0].rotation_overdue).toBe(true);
      expect(result.keys[0].days_overdue).toBe(10);
      expect(result.keys[0].compliant).toBe(false);
      expect(result.compliant).toBe(false);
    });

    it("marks a key unknown (violation) when no rotation record exists", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["UNTRACKED"],
        [], // no records
        NOW,
      );

      expect(result.keys[0]).toMatchObject({
        key: "UNTRACKED",
        last_rotated_at: null,
        last_rotated_known: false,
        rotation_due: null,
        rotation_overdue: false,
        compliant: false, // unknown = violation
      });
      expect(result.compliant).toBe(false);
    });

    it("cell compliant iff every key is compliant (AND semantics)", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["FRESH", "STALE"],
        [rotation("FRESH", 5), rotation("STALE", 40)],
        NOW,
      );

      expect(result.keys.find((k) => k.key === "FRESH")?.compliant).toBe(true);
      expect(result.keys.find((k) => k.key === "STALE")?.compliant).toBe(false);
      expect(result.compliant).toBe(false); // AND → one stale key fails the cell
    });

    it("cell with no keys is vacuously compliant", () => {
      const policy: PolicyDocument = { version: 1 };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        [],
        [],
        NOW,
      );

      expect(result.keys).toEqual([]);
      expect(result.compliant).toBe(true);
    });

    it("ignores rotation records for keys not in the cipher (orphans)", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["LIVE_KEY"],
        [rotation("LIVE_KEY", 10), rotation("DELETED_KEY", 5)],
        NOW,
      );

      // Orphan "DELETED_KEY" record does not appear in the output.
      expect(result.keys).toHaveLength(1);
      expect(result.keys[0].key).toBe("LIVE_KEY");
    });
  });

  describe("per-environment overrides", () => {
    it("applies per-env max_age_days to a given cell", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: { production: { max_age_days: 30 } },
        },
      };
      const evaluator = new PolicyEvaluator(policy);
      const record = rotation("KEY", 40);

      const prod = evaluator.evaluateFile(
        "api/prod.enc.yaml",
        "production",
        metaAt(1),
        ["KEY"],
        [record],
        NOW,
      );
      const dev = evaluator.evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["KEY"],
        [record],
        NOW,
      );

      // Same rotation age (40 days); production window is 30d → overdue.
      // Dev window is 90d → compliant.
      expect(prod.keys[0].rotation_overdue).toBe(true);
      expect(prod.keys[0].days_overdue).toBe(10);
      expect(dev.keys[0].rotation_overdue).toBe(false);
    });

    it("falls back to default 90-day window when policy omits rotation block", () => {
      const policy: PolicyDocument = { version: 1 };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["KEY"],
        [rotation("KEY", 89)],
        NOW,
      );

      expect(result.keys[0].rotation_overdue).toBe(false);
    });

    it("falls back to top-level max_age_days for envs without an override", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 60,
          environments: { production: { max_age_days: 7 } },
        },
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/staging.enc.yaml",
        "staging",
        metaAt(1),
        ["KEY"],
        [rotation("KEY", 50)],
        NOW,
      );

      expect(result.keys[0].rotation_overdue).toBe(false); // 50d < 60d top-level
    });
  });

  describe("propagated raw fields", () => {
    it("echoes path, environment, backend, and recipients verbatim", () => {
      const policy: PolicyDocument = { version: 1 };
      const meta = metaAt(1, {
        backend: "awskms",
        recipients: ["arn:aws:kms:us-east-1:123:key/abc"],
      });
      const result = new PolicyEvaluator(policy).evaluateFile(
        "billing/prod.enc.yaml",
        "prod",
        meta,
        [],
        [],
        NOW,
      );

      expect(result.path).toBe("billing/prod.enc.yaml");
      expect(result.environment).toBe("prod");
      expect(result.backend).toBe("awskms");
      expect(result.recipients).toEqual(["arn:aws:kms:us-east-1:123:key/abc"]);
    });

    it("echoes last_modified from the sops metadata (no policy dependency)", () => {
      const policy: PolicyDocument = { version: 1 };
      const meta = metaAt(100); // far older than any window
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        meta,
        [],
        [],
        NOW,
      );

      expect(result.last_modified).toBe(meta.lastModified.toISOString());
      expect(result.last_modified_known).toBe(true);
      // File-level rotation fields are intentionally absent — cell is
      // vacuously compliant because it has no keys.
      expect(result.compliant).toBe(true);
    });

    it("reflects last_modified_known: false when sops metadata lacks the field", () => {
      const policy: PolicyDocument = { version: 1 };
      const meta = metaAt(1, { lastModifiedPresent: false });
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        meta,
        [],
        [],
        NOW,
      );

      expect(result.last_modified_known).toBe(false);
    });
  });

  describe("boundary cases", () => {
    it("flags 1ms past due as overdue with 0 days_overdue", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const record: RotationRecord = {
        key: "K",
        lastRotatedAt: new Date(NOW.getTime() - 30 * MS_PER_DAY - 1),
        rotatedBy: "alice",
        rotationCount: 1,
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["K"],
        [record],
        NOW,
      );

      expect(result.keys[0].rotation_overdue).toBe(true);
      expect(result.keys[0].days_overdue).toBe(0);
    });

    it("treats exactly max_age_days as not yet overdue", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const record: RotationRecord = {
        key: "K",
        lastRotatedAt: new Date(NOW.getTime() - 30 * MS_PER_DAY),
        rotatedBy: "alice",
        rotationCount: 1,
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["K"],
        [record],
        NOW,
      );

      expect(result.keys[0].rotation_overdue).toBe(false);
    });

    it("exposes rotation_count and rotated_by from the record", () => {
      const policy: PolicyDocument = { version: 1 };
      const record: RotationRecord = {
        key: "K",
        lastRotatedAt: new Date(NOW.getTime() - MS_PER_DAY),
        rotatedBy: "bob <bob@example.com>",
        rotationCount: 7,
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["K"],
        [record],
        NOW,
      );

      expect(result.keys[0].rotated_by).toBe("bob <bob@example.com>");
      expect(result.keys[0].rotation_count).toBe(7);
    });

    it("uses the system clock when `now` is omitted (default-parameter path)", () => {
      // Guard for the documented default on evaluateFile's `now` parameter.
      // A record rotated ~1 second ago must be fresh against a 30-day window
      // regardless of when this test runs, so we can assert compliance without
      // pinning wall-clock time.  Coverage-wise this exercises the default
      // value branch the other tests bypass by always passing NOW explicitly.
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 30 } };
      const record: RotationRecord = {
        key: "K",
        lastRotatedAt: new Date(Date.now() - 1000),
        rotatedBy: "alice",
        rotationCount: 1,
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(1),
        ["K"],
        [record],
        // `now` intentionally omitted — triggers `new Date()` default.
      );

      expect(result.keys[0].compliant).toBe(true);
      expect(result.keys[0].rotation_overdue).toBe(false);
    });
  });
});
