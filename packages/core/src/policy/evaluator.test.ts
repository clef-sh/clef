import { SopsMetadata } from "../types";
import { PolicyEvaluator } from "./evaluator";
import { PolicyDocument } from "./types";

const NOW = new Date("2026-04-14T00:00:00Z");

function metaAt(daysAgo: number, overrides: Partial<SopsMetadata> = {}): SopsMetadata {
  const lastModified = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return {
    backend: "age",
    recipients: ["age1abc"],
    lastModified,
    lastModifiedPresent: true,
    ...overrides,
  };
}

describe("PolicyEvaluator", () => {
  describe("compliant cases", () => {
    it("marks a freshly modified file compliant", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(30),
        NOW,
      );

      expect(result.compliant).toBe(true);
      expect(result.rotation_overdue).toBe(false);
      expect(result.days_overdue).toBe(0);
      expect(result.last_modified_known).toBe(true);
    });

    it("returns ISO 8601 strings for date fields", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(30),
        NOW,
      );

      expect(result.last_modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.rotation_due).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // rotation_due === last_modified + 90 days
      const due = new Date(result.rotation_due).getTime();
      const lastMod = new Date(result.last_modified).getTime();
      expect(due - lastMod).toBe(90 * 86_400_000);
    });

    it("propagates path, environment, backend, and recipients verbatim", () => {
      const policy: PolicyDocument = { version: 1 };
      const meta = metaAt(1, {
        backend: "awskms",
        recipients: ["arn:aws:kms:us-east-1:123:key/abc"],
      });
      const result = new PolicyEvaluator(policy).evaluateFile(
        "billing/prod.enc.yaml",
        "prod",
        meta,
        NOW,
      );

      expect(result.path).toBe("billing/prod.enc.yaml");
      expect(result.environment).toBe("prod");
      expect(result.backend).toBe("awskms");
      expect(result.recipients).toEqual(["arn:aws:kms:us-east-1:123:key/abc"]);
    });
  });

  describe("overdue cases", () => {
    it("marks a file past max_age_days as overdue and counts days_overdue", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(100),
        NOW,
      );

      expect(result.rotation_overdue).toBe(true);
      expect(result.compliant).toBe(false);
      expect(result.days_overdue).toBe(10);
    });

    it("treats a file exactly at max_age_days as still compliant", () => {
      // rotation_due === lastModified + 90d.  At exactly 90d, now === due,
      // and `now > due` is false → compliant.
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "api/dev.enc.yaml",
        "dev",
        metaAt(90),
        NOW,
      );
      expect(result.compliant).toBe(true);
      expect(result.days_overdue).toBe(0);
    });

    it("flags a file 1 ms past due as overdue with 0 days_overdue", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const lastModified = new Date(NOW.getTime() - 90 * 86_400_000 - 1);
      const meta: SopsMetadata = {
        backend: "age",
        recipients: ["age1"],
        lastModified,
        lastModifiedPresent: true,
      };
      const result = new PolicyEvaluator(policy).evaluateFile("a/dev.enc.yaml", "dev", meta, NOW);
      expect(result.rotation_overdue).toBe(true);
      expect(result.days_overdue).toBe(0);
    });
  });

  describe("environment overrides", () => {
    it("applies a tighter per-env max_age_days", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: { production: { max_age_days: 30 } },
        },
      };
      const evaluator = new PolicyEvaluator(policy);

      // 31 days old in production → overdue (override applies)
      const prodResult = evaluator.evaluateFile("a/prod.enc.yaml", "production", metaAt(31), NOW);
      expect(prodResult.rotation_overdue).toBe(true);
      expect(prodResult.days_overdue).toBe(1);

      // Same age in dev → still compliant (top-level 90d applies)
      const devResult = evaluator.evaluateFile("a/dev.enc.yaml", "dev", metaAt(31), NOW);
      expect(devResult.rotation_overdue).toBe(false);
    });

    it("applies a looser per-env max_age_days", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 30,
          environments: { dev: { max_age_days: 365 } },
        },
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "a/dev.enc.yaml",
        "dev",
        metaAt(100),
        NOW,
      );
      expect(result.compliant).toBe(true);
    });

    it("falls through to top-level max_age_days for unmapped environments", () => {
      const policy: PolicyDocument = {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: { production: { max_age_days: 30 } },
        },
      };
      const result = new PolicyEvaluator(policy).evaluateFile(
        "a/staging.enc.yaml",
        "staging",
        metaAt(31),
        NOW,
      );
      expect(result.compliant).toBe(true);
    });
  });

  describe("default behavior", () => {
    it("uses 90-day default when policy has no rotation block", () => {
      const policy: PolicyDocument = { version: 1 };
      const overdue = new PolicyEvaluator(policy).evaluateFile(
        "a/dev.enc.yaml",
        "dev",
        metaAt(91),
        NOW,
      );
      expect(overdue.rotation_overdue).toBe(true);

      const fresh = new PolicyEvaluator(policy).evaluateFile(
        "a/dev.enc.yaml",
        "dev",
        metaAt(89),
        NOW,
      );
      expect(fresh.compliant).toBe(true);
    });

    it("defaults `now` to current time when not injected", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const meta = metaAt(0); // last modified at NOW reference
      const result = new PolicyEvaluator(policy).evaluateFile("a/dev.enc.yaml", "dev", meta);
      // metaAt() built lastModified relative to NOW, but real `now` is later;
      // a 0-day-old file (relative to a fixed past NOW) is still compliant
      // because real-now is < lastModified + 90d.
      expect(result.compliant).toBe(true);
    });
  });

  describe("metadata trustworthiness", () => {
    it("treats missing lastModifiedPresent as last_modified_known: true (back-compat)", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      // Hand-rolled metadata without lastModifiedPresent — assumed trustworthy.
      const meta: SopsMetadata = {
        backend: "age",
        recipients: ["age1"],
        lastModified: new Date(NOW.getTime() - 30 * 86_400_000),
      };
      const result = new PolicyEvaluator(policy).evaluateFile("a/dev.enc.yaml", "dev", meta, NOW);
      expect(result.last_modified_known).toBe(true);
    });

    it("surfaces last_modified_known: false when metadata lacks lastmodified", () => {
      const policy: PolicyDocument = { version: 1, rotation: { max_age_days: 90 } };
      const meta: SopsMetadata = {
        backend: "age",
        recipients: ["age1"],
        lastModified: new Date(NOW.getTime() - 1000), // synthetic fallback
        lastModifiedPresent: false,
      };
      const result = new PolicyEvaluator(policy).evaluateFile("a/dev.enc.yaml", "dev", meta, NOW);
      expect(result.last_modified_known).toBe(false);
      // The verdict still reflects the (fallback) timestamp — caller decides
      // whether to surface unknown metadata distinctly from a real "compliant".
      expect(result.compliant).toBe(true);
    });
  });
});
