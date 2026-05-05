import { SopsMergeDriver } from "./driver";
import { SopsClient } from "../sops/client";

describe("SopsMergeDriver", () => {
  let driver: SopsMergeDriver;
  let mockSopsClient: jest.Mocked<SopsClient>;

  beforeEach(() => {
    mockSopsClient = {
      decryptFile: jest.fn(),
      encrypt: jest.fn(),
    } as unknown as jest.Mocked<SopsClient>;
    driver = new SopsMergeDriver(mockSopsClient);
  });

  describe("merge", () => {
    it("should handle no changes (identical files)", () => {
      const base = { A: "1", B: "2" };
      const result = driver.merge(base, { ...base }, { ...base });

      expect(result.clean).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.merged).toEqual({ A: "1", B: "2" });
      expect(result.keys.every((k) => k.status === "unchanged")).toBe(true);
    });

    it("should accept changes only in ours", () => {
      const base = { A: "1", B: "2" };
      const ours = { A: "changed", B: "2" };
      const result = driver.merge(base, ours, { ...base });

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "changed", B: "2" });
      expect(result.keys.find((k) => k.key === "A")?.status).toBe("ours");
      expect(result.keys.find((k) => k.key === "B")?.status).toBe("unchanged");
    });

    it("should accept changes only in theirs", () => {
      const base = { A: "1", B: "2" };
      const theirs = { A: "1", B: "changed" };
      const result = driver.merge(base, { ...base }, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "1", B: "changed" });
      expect(result.keys.find((k) => k.key === "B")?.status).toBe("theirs");
    });

    it("should merge non-overlapping changes from both sides", () => {
      const base = { A: "1", B: "2", C: "3" };
      const ours = { A: "changed-by-alice", B: "2", C: "3" };
      const theirs = { A: "1", B: "2", C: "changed-by-bob" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({
        A: "changed-by-alice",
        B: "2",
        C: "changed-by-bob",
      });
    });

    it("should accept key added only in ours", () => {
      const base = { A: "1" };
      const ours = { A: "1", NEW: "from-ours" };
      const result = driver.merge(base, ours, { ...base });

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "1", NEW: "from-ours" });
      expect(result.keys.find((k) => k.key === "NEW")?.status).toBe("ours");
    });

    it("should accept key added only in theirs", () => {
      const base = { A: "1" };
      const theirs = { A: "1", NEW: "from-theirs" };
      const result = driver.merge(base, { ...base }, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "1", NEW: "from-theirs" });
      expect(result.keys.find((k) => k.key === "NEW")?.status).toBe("theirs");
    });

    it("should accept key added on both sides with same value", () => {
      const base = { A: "1" };
      const ours = { A: "1", NEW: "same" };
      const theirs = { A: "1", NEW: "same" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "1", NEW: "same" });
      expect(result.keys.find((k) => k.key === "NEW")?.status).toBe("both_added");
    });

    it("should conflict when key added on both sides with different values", () => {
      const base = { A: "1" };
      const ours = { A: "1", NEW: "ours-val" };
      const theirs = { A: "1", NEW: "theirs-val" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("NEW");
      expect(result.conflicts[0].oursValue).toBe("ours-val");
      expect(result.conflicts[0].theirsValue).toBe("theirs-val");
    });

    it("should conflict when both sides change same key differently", () => {
      const base = { A: "original" };
      const ours = { A: "alice-version" };
      const theirs = { A: "bob-version" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("A");
      expect(result.conflicts[0].baseValue).toBe("original");
    });

    it("should accept when both sides make the same change", () => {
      const base = { A: "original" };
      const ours = { A: "both-agree" };
      const theirs = { A: "both-agree" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "both-agree" });
    });

    it("should accept key deleted only in ours", () => {
      const base = { A: "1", B: "2" };
      const ours = { B: "2" };
      const result = driver.merge(base, ours, { ...base });

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ B: "2" });
      expect(result.keys.find((k) => k.key === "A")?.status).toBe("ours");
      expect(result.keys.find((k) => k.key === "A")?.value).toBeNull();
    });

    it("should accept key deleted only in theirs", () => {
      const base = { A: "1", B: "2" };
      const theirs = { B: "2" };
      const result = driver.merge(base, { ...base }, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ B: "2" });
      expect(result.keys.find((k) => k.key === "A")?.status).toBe("theirs");
    });

    it("should accept key deleted on both sides", () => {
      const base = { A: "1", B: "2" };
      const ours = { B: "2" };
      const theirs = { B: "2" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ B: "2" });
    });

    it("should conflict when one side deletes and other modifies", () => {
      const base = { A: "1" };
      const ours = {}; // deleted
      const theirs = { A: "modified" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("A");
      expect(result.conflicts[0].oursValue).toBeNull();
      expect(result.conflicts[0].theirsValue).toBe("modified");
    });

    it("should conflict when other side deletes and ours modifies", () => {
      const base = { A: "1" };
      const ours = { A: "modified" };
      const theirs = {}; // deleted
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].oursValue).toBe("modified");
      expect(result.conflicts[0].theirsValue).toBeNull();
    });

    it("should handle empty base (new file on both branches)", () => {
      const base = {};
      const ours = { A: "from-ours" };
      const theirs = { B: "from-theirs" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "from-ours", B: "from-theirs" });
    });

    it("should handle all three empty", () => {
      const result = driver.merge({}, {}, {});

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({});
      expect(result.keys).toHaveLength(0);
    });

    it("should sort keys alphabetically in output", () => {
      const base = { Z: "1", A: "2", M: "3" };
      const result = driver.merge(base, { ...base }, { ...base });

      expect(result.keys.map((k) => k.key)).toEqual(["A", "M", "Z"]);
    });

    it("should handle the motivating example: pool size + timeout", () => {
      const base = {
        DATABASE_URL: "postgres://prod-db:5432/app",
        DATABASE_POOL_SIZE: "10",
        DATABASE_SSL: "true",
      };
      const ours = {
        DATABASE_URL: "postgres://prod-db:5432/app",
        DATABASE_POOL_SIZE: "25", // Alice changed this
        DATABASE_SSL: "true",
      };
      const theirs = {
        DATABASE_URL: "postgres://prod-db:5432/app",
        DATABASE_POOL_SIZE: "10",
        DATABASE_SSL: "true",
        DATABASE_TIMEOUT: "30", // Bob added this
      };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({
        DATABASE_URL: "postgres://prod-db:5432/app",
        DATABASE_POOL_SIZE: "25",
        DATABASE_SSL: "true",
        DATABASE_TIMEOUT: "30",
      });
    });

    it("should handle multiple conflicts alongside clean merges", () => {
      const base = { A: "1", B: "2", C: "3" };
      const ours = { A: "alice-A", B: "alice-B", C: "3" };
      const theirs = { A: "bob-A", B: "2", C: "bob-C" };
      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("A");
      // B should be resolved (only ours changed), C should be resolved (only theirs changed)
      expect(result.merged.B).toBe("alice-B");
      expect(result.merged.C).toBe("bob-C");
    });

    // ── Edge cases raised in whitepaper review ─────────────────────────────

    it("should treat JSON-stringified nested values as atomic strings", () => {
      // SOPS flattens all values to strings. If a value happens to be
      // serialized JSON, the merge driver treats it as a single opaque string.
      const config = JSON.stringify({ host: "db.example.com", port: 5432 });
      const base = { DB_CONFIG: config, API_KEY: "key1" };
      const ours = {
        DB_CONFIG: JSON.stringify({ host: "db.example.com", port: 5433 }),
        API_KEY: "key1",
      };
      const theirs = { DB_CONFIG: config, API_KEY: "key2" };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      // DB_CONFIG changed only in ours, API_KEY changed only in theirs
      expect(result.merged.DB_CONFIG).toBe(ours.DB_CONFIG);
      expect(result.merged.API_KEY).toBe("key2");
    });

    it("should conflict when both sides change a JSON-stringified value differently", () => {
      const base = { DB_CONFIG: JSON.stringify({ host: "db.example.com" }) };
      const ours = { DB_CONFIG: JSON.stringify({ host: "db-ours.example.com" }) };
      const theirs = { DB_CONFIG: JSON.stringify({ host: "db-theirs.example.com" }) };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe("DB_CONFIG");
    });

    it("should handle multiline string values (PEM certificates, etc.)", () => {
      const cert = "-----BEGIN CERTIFICATE-----\nMIIBxTCCAW...\n-----END CERTIFICATE-----";
      const base = { TLS_CERT: cert, API_KEY: "old" };
      const ours = { TLS_CERT: cert, API_KEY: "new" };
      const theirs = { TLS_CERT: cert, API_KEY: "old" };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged.TLS_CERT).toBe(cert);
      expect(result.merged.API_KEY).toBe("new");
    });

    it("should conflict on multiline value changes from both sides", () => {
      const base = { TLS_CERT: "cert-v1" };
      const ours = { TLS_CERT: "cert-v2-ours" };
      const theirs = { TLS_CERT: "cert-v2-theirs" };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts[0].oursValue).toBe("cert-v2-ours");
      expect(result.conflicts[0].theirsValue).toBe("cert-v2-theirs");
    });

    it("should handle large key counts without issues", () => {
      const base: Record<string, string> = {};
      const ours: Record<string, string> = {};
      const theirs: Record<string, string> = {};
      for (let i = 0; i < 200; i++) {
        base[`KEY_${i}`] = `base-${i}`;
        ours[`KEY_${i}`] = i < 100 ? `ours-${i}` : `base-${i}`;
        theirs[`KEY_${i}`] = i >= 100 ? `theirs-${i}` : `base-${i}`;
      }

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(Object.keys(result.merged)).toHaveLength(200);
      // First 100 changed by ours, last 100 changed by theirs, no overlap
      expect(result.merged.KEY_0).toBe("ours-0");
      expect(result.merged.KEY_100).toBe("theirs-100");
    });

    it("should handle simultaneous additions and deletions across branches", () => {
      const base = { A: "1", B: "2", C: "3" };
      const ours = { A: "1", C: "3", D: "new-ours" }; // deleted B, added D
      const theirs = { A: "1", B: "2", E: "new-theirs" }; // deleted C, added E

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "1", D: "new-ours", E: "new-theirs" });
      // B deleted by ours, C deleted by theirs — both clean
      expect("B" in result.merged).toBe(false);
      expect("C" in result.merged).toBe(false);
    });

    it("should conflict when one side deletes and other modifies same key", () => {
      const base = { SHARED_SECRET: "original" };
      const ours = {}; // deleted
      const theirs = { SHARED_SECRET: "modified" };

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].oursValue).toBeNull();
      expect(result.conflicts[0].theirsValue).toBe("modified");
    });

    it("should handle empty string values distinctly from missing keys", () => {
      const base = { A: "value", B: "" };
      const ours = { A: "", B: "" }; // A changed to empty string
      const theirs = { A: "value", B: "filled" }; // B changed from empty to filled

      const result = driver.merge(base, ours, theirs);

      expect(result.clean).toBe(true);
      expect(result.merged.A).toBe(""); // ours changed to empty
      expect(result.merged.B).toBe("filled"); // theirs changed from empty
    });
  });

  describe("mergeFiles", () => {
    it("should decrypt all three files and merge", async () => {
      const metadata = {
        backend: "age" as const,
        recipients: ["age1test"],
        lastModified: new Date(),
      };

      const files: Record<string, Record<string, string>> = {
        "/tmp/base": { A: "1", B: "2" },
        "/tmp/ours": { A: "changed", B: "2" },
        "/tmp/theirs": { A: "1", B: "2", C: "new" },
      };
      mockSopsClient.decryptFile.mockImplementation(async (filePath: string) => {
        if (files[filePath]) return { values: files[filePath], metadata };
        throw new Error(`Unexpected path: ${filePath}`);
      });

      const result = await driver.mergeFiles("/tmp/base", "/tmp/ours", "/tmp/theirs");

      expect(result.clean).toBe(true);
      expect(result.merged).toEqual({ A: "changed", B: "2", C: "new" });
      expect(mockSopsClient.decryptFile).toHaveBeenCalledTimes(3);
    });

    it("should propagate decryption errors", async () => {
      mockSopsClient.decryptFile.mockRejectedValue(new Error("key not found"));

      await expect(driver.mergeFiles("/base", "/ours", "/theirs")).rejects.toThrow("key not found");
    });

    it("should report conflicts from file merge", async () => {
      const metadata = {
        backend: "age" as const,
        recipients: ["age1test"],
        lastModified: new Date(),
      };

      mockSopsClient.decryptFile.mockImplementation(async (filePath: string) => {
        if (filePath === "/base") return { values: { A: "original" }, metadata };
        if (filePath === "/ours") return { values: { A: "alice" }, metadata };
        if (filePath === "/theirs") return { values: { A: "bob" }, metadata };
        throw new Error(`Unexpected path: ${filePath}`);
      });

      const result = await driver.mergeFiles("/base", "/ours", "/theirs");

      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
    });
  });
});
