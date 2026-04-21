import { applyShape, applyTemplate, extractRefs, validateShape } from "./shape-template";

describe("extractRefs", () => {
  it("returns nothing for a pure literal", () => {
    expect(extractRefs("postgres://localhost:5432/app")).toEqual([]);
  });

  it("extracts a single reference", () => {
    expect(extractRefs("${DATABASE_URL}")).toEqual(["DATABASE_URL"]);
  });

  it("extracts multiple distinct references", () => {
    expect(extractRefs("postgres://${USER}:${PASS}@${HOST}:5432/db").sort()).toEqual([
      "HOST",
      "PASS",
      "USER",
    ]);
  });

  it("deduplicates repeated references", () => {
    expect(extractRefs("${X}-${X}-${X}")).toEqual(["X"]);
  });

  it("ignores malformed patterns that don't match the ref grammar", () => {
    // ${} is empty, ${1_STARTS_DIGIT} fails the identifier rule, ${with-dash} has a dash.
    expect(extractRefs("${} ${1X} ${a-b} plain")).toEqual([]);
  });

  it("accepts identifiers with underscores and digits after the first char", () => {
    expect(extractRefs("${DB_HOST_2}").sort()).toEqual(["DB_HOST_2"]);
  });
});

describe("applyTemplate", () => {
  it("passes literals through unchanged", () => {
    expect(applyTemplate("us-east-1", {})).toBe("us-east-1");
  });

  it("substitutes a single reference", () => {
    expect(applyTemplate("${HOST}", { HOST: "db.internal" })).toBe("db.internal");
  });

  it("substitutes references inside a composite template", () => {
    const out = applyTemplate("postgres://${USER}:${PASS}@${HOST}:5432/db", {
      USER: "app",
      PASS: "s3cr3t",
      HOST: "db.internal",
    });
    expect(out).toBe("postgres://app:s3cr3t@db.internal:5432/db");
  });

  it("throws on unknown references (defence-in-depth against synth skipping validation)", () => {
    expect(() => applyTemplate("${MISSING}", {})).toThrow(/\$\{MISSING\}/);
  });
});

describe("applyShape", () => {
  it("produces a mapped object with literals and substitutions (Record shape)", () => {
    const result = applyShape(
      {
        region: "us-east-1",
        dbHost: "${DATABASE_HOST}",
        connectionString: "postgres://${USER}:${PASS}@${DATABASE_HOST}:5432/app",
      },
      {
        DATABASE_HOST: "db.internal",
        USER: "app",
        PASS: "hunter2",
      },
    );
    expect(result).toEqual({
      region: "us-east-1",
      dbHost: "db.internal",
      connectionString: "postgres://app:hunter2@db.internal:5432/app",
    });
  });

  it("returns an empty object for an empty Record shape", () => {
    expect(applyShape({}, { X: "y" })).toEqual({});
  });

  it("returns a plain string when shape is a string template", () => {
    const result = applyShape("postgres://${USER}:${PASS}@${HOST}:5432/app", {
      USER: "app",
      PASS: "hunter2",
      HOST: "db.internal",
    });
    expect(result).toBe("postgres://app:hunter2@db.internal:5432/app");
  });

  it("returns the string literally when shape has no refs", () => {
    expect(applyShape("static-value", {})).toBe("static-value");
  });
});

describe("validateShape", () => {
  const baseArgs = {
    identity: "api-gateway",
    environment: "production",
    availableKeys: ["DATABASE_HOST", "DATABASE_USER", "DATABASE_PASSWORD", "API_KEY"],
  };

  it("passes when every reference resolves", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: {
          dbHost: "${DATABASE_HOST}",
          dbUser: "${DATABASE_USER}",
          connStr: "postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}",
          region: "us-east-1", // pure literal
        },
      }),
    ).not.toThrow();
  });

  it("passes for an empty shape", () => {
    expect(() => validateShape({ ...baseArgs, shape: {} })).not.toThrow();
  });

  it("throws a message that names the offending field and the bad reference", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { dbHost: "${DATABSAE_HOST}" }, // typo
      }),
    ).toThrow(/shape\['dbHost'\] references unknown Clef key: \$\{DATABSAE_HOST\}/);
  });

  it("surfaces a 'Did you mean' suggestion for a likely typo", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { dbHost: "${DATABSAE_HOST}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Did you mean \$\{DATABASE_HOST\}/);
    }
  });

  it("skips the suggestion when no candidate is close enough", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { weird: "${TOTALLY_UNRELATED_XYZ}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/Did you mean/);
    }
  });

  it("lists the valid keys in sorted order", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { x: "${NOPE}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Sorted alphabetically.
      expect(msg).toMatch(
        /API_KEY[\s\S]*DATABASE_HOST[\s\S]*DATABASE_PASSWORD[\s\S]*DATABASE_USER/,
      );
    }
  });

  it("notes the identity and environment in the error", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { x: "${NOPE}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/identity:\s+api-gateway/);
      expect(msg).toMatch(/environment:\s+production/);
    }
  });

  it("throws a helpful message for empty available keys", () => {
    try {
      validateShape({
        ...baseArgs,
        availableKeys: [],
        shape: { x: "${MISSING}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/\(none — did you forget to set any values\?\)/);
    }
  });

  it("rejects non-string values in the Record shape map", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { port: 5432 as unknown as string },
      }),
    ).toThrow(/shape\['port'\] must be a string/);
  });

  describe("string shape", () => {
    it("passes when every reference in the string resolves", () => {
      expect(() =>
        validateShape({
          ...baseArgs,
          shape: "postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}",
        }),
      ).not.toThrow();
    });

    it("passes for a pure literal string", () => {
      expect(() =>
        validateShape({
          ...baseArgs,
          shape: "us-east-1",
        }),
      ).not.toThrow();
    });

    it("throws with a <value> location pointer when an unknown ref appears", () => {
      try {
        validateShape({
          ...baseArgs,
          shape: "postgres://${DATABSAE_HOST}",
        });
        fail("expected throw");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toMatch(/<value> references unknown Clef key: \$\{DATABSAE_HOST\}/);
        expect(msg).toMatch(/Did you mean \$\{DATABASE_HOST\}/);
      }
    });
  });

  it("rejects a shape that is neither string nor object", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: 42 as unknown as string,
      }),
    ).toThrow(/shape must be a string or an object of strings/);
  });
});
