import { DiffEngine } from "./engine";
import type { SecretSource } from "../source/types";

describe("DiffEngine", () => {
  let engine: DiffEngine;

  beforeEach(() => {
    engine = new DiffEngine();
  });

  describe("diff", () => {
    it("should detect changed values", () => {
      const result = engine.diff(
        { KEY: "valueA" },
        { KEY: "valueB" },
        "dev",
        "production",
        "database",
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("changed");
      expect(result.rows[0].valueA).toBe("valueA");
      expect(result.rows[0].valueB).toBe("valueB");
    });

    it("should detect identical values", () => {
      const result = engine.diff({ KEY: "same" }, { KEY: "same" }, "dev", "production", "database");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("identical");
    });

    it("should detect keys missing in B", () => {
      const result = engine.diff({ ONLY_IN_A: "value" }, {}, "dev", "production", "database");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("missing_b");
      expect(result.rows[0].valueA).toBe("value");
      expect(result.rows[0].valueB).toBeNull();
    });

    it("should detect keys missing in A", () => {
      const result = engine.diff({}, { ONLY_IN_B: "value" }, "dev", "production", "database");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("missing_a");
      expect(result.rows[0].valueA).toBeNull();
      expect(result.rows[0].valueB).toBe("value");
    });

    it("should handle all four status types simultaneously", () => {
      const result = engine.diff(
        { CHANGED: "a", SAME: "v", ONLY_A: "x" },
        { CHANGED: "b", SAME: "v", ONLY_B: "y" },
        "dev",
        "staging",
        "auth",
      );

      expect(result.rows).toHaveLength(4);
      expect(result.rows.find((r) => r.key === "CHANGED")?.status).toBe("changed");
      expect(result.rows.find((r) => r.key === "SAME")?.status).toBe("identical");
      expect(result.rows.find((r) => r.key === "ONLY_A")?.status).toBe("missing_b");
      expect(result.rows.find((r) => r.key === "ONLY_B")?.status).toBe("missing_a");
    });

    it("should handle empty files (both empty)", () => {
      const result = engine.diff({}, {}, "dev", "production", "database");

      expect(result.rows).toHaveLength(0);
      expect(result.namespace).toBe("database");
      expect(result.envA).toBe("dev");
      expect(result.envB).toBe("production");
    });

    it("should handle one-sided empty file", () => {
      const result = engine.diff({ A: "1", B: "2" }, {}, "dev", "staging", "auth");

      expect(result.rows).toHaveLength(2);
      expect(result.rows.every((r) => r.status === "missing_b")).toBe(true);
    });

    it("should handle identical files", () => {
      const values = { X: "1", Y: "2", Z: "3" };
      const result = engine.diff(values, { ...values }, "dev", "staging", "database");

      expect(result.rows).toHaveLength(3);
      expect(result.rows.every((r) => r.status === "identical")).toBe(true);
    });

    it("should sort results with missing/changed before identical", () => {
      const result = engine.diff(
        { Z_SAME: "v", A_CHANGED: "a" },
        { Z_SAME: "v", A_CHANGED: "b" },
        "dev",
        "staging",
        "ns",
      );

      // Changed should come before identical
      expect(result.rows[0].status).toBe("changed");
      expect(result.rows[1].status).toBe("identical");
    });

    it("should set namespace, envA, and envB on result", () => {
      const result = engine.diff({}, {}, "dev", "production", "payments");

      expect(result.namespace).toBe("payments");
      expect(result.envA).toBe("dev");
      expect(result.envB).toBe("production");
    });
  });

  describe("diffCells", () => {
    it("should read both cells from the source and diff them", async () => {
      const mockSource = {
        readCell: jest
          .fn()
          .mockImplementation(async (cell: { namespace: string; environment: string }) => {
            if (cell.environment === "dev") {
              return {
                values: { KEY: "dev-val", DEV_ONLY: "x" },
                metadata: {
                  backend: "age" as const,
                  recipients: ["age1test"],
                  lastModified: new Date(),
                },
              };
            }
            return {
              values: { KEY: "prod-val", PROD_ONLY: "y" },
              metadata: {
                backend: "age" as const,
                recipients: ["age1test"],
                lastModified: new Date(),
              },
            };
          }),
      } as unknown as SecretSource;

      const result = await engine.diffCells("auth", "dev", "production", mockSource);

      expect(result.namespace).toBe("auth");
      expect(result.envA).toBe("dev");
      expect(result.envB).toBe("production");
      expect(result.rows).toHaveLength(3);
      expect(result.rows.find((r) => r.key === "KEY")?.status).toBe("changed");
      expect(result.rows.find((r) => r.key === "DEV_ONLY")?.status).toBe("missing_b");
      expect(result.rows.find((r) => r.key === "PROD_ONLY")?.status).toBe("missing_a");
    });
  });
});
