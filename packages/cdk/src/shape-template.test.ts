import { applyShape, applyTemplate, extractRefs, validateShape } from "./shape-template";

describe("extractRefs", () => {
  it("returns nothing for a pure literal", () => {
    expect(extractRefs("postgres://localhost:5432/app")).toEqual([]);
  });

  it("extracts a single placeholder", () => {
    expect(extractRefs("{{databaseUrl}}")).toEqual(["databaseUrl"]);
  });

  it("extracts multiple distinct placeholders", () => {
    expect(extractRefs("postgres://{{user}}:{{pass}}@{{host}}:5432/db").sort()).toEqual([
      "host",
      "pass",
      "user",
    ]);
  });

  it("deduplicates repeated placeholders", () => {
    expect(extractRefs("{{x}}-{{x}}-{{x}}")).toEqual(["x"]);
  });

  it("ignores malformed patterns that don't match the placeholder grammar", () => {
    // {{}} is empty, {{1X}} fails the identifier rule, {{a-b}} has a dash, {x} is single-brace.
    expect(extractRefs("{{}} {{1X}} {{a-b}} {x} plain")).toEqual([]);
  });

  it("accepts identifiers with underscores and digits after the first char", () => {
    expect(extractRefs("{{db_host_2}}").sort()).toEqual(["db_host_2"]);
  });

  it("ignores escaped braces", () => {
    expect(extractRefs("\\{\\{not_a_placeholder\\}\\}")).toEqual([]);
  });
});

describe("applyTemplate", () => {
  const refs = {
    user: { namespace: "database", key: "USER" },
    pass: { namespace: "database", key: "PASS" },
    host: { namespace: "database", key: "HOST" },
  };
  const values = {
    database: { USER: "app", PASS: "s3cr3t", HOST: "db.internal" },
  };

  it("passes literals through unchanged", () => {
    expect(applyTemplate("us-east-1", refs, values)).toBe("us-east-1");
  });

  it("substitutes a single placeholder", () => {
    expect(applyTemplate("{{host}}", refs, values)).toBe("db.internal");
  });

  it("substitutes placeholders inside a composite template", () => {
    const out = applyTemplate("postgres://{{user}}:{{pass}}@{{host}}:5432/db", refs, values);
    expect(out).toBe("postgres://app:s3cr3t@db.internal:5432/db");
  });

  it("turns escaped braces into literal {{ and }}", () => {
    expect(applyTemplate("prefix \\{\\{user\\}\\} suffix", refs, values)).toBe(
      "prefix {{user}} suffix",
    );
  });

  it("mixes escapes and placeholders correctly", () => {
    expect(applyTemplate("\\{\\{literal\\}\\} but real={{user}}", refs, values)).toBe(
      "{{literal}} but real=app",
    );
  });

  it("throws on unknown placeholders (defence-in-depth)", () => {
    expect(() => applyTemplate("{{unknown}}", refs, values)).toThrow(
      /\{\{unknown\}\} has no matching refs entry/,
    );
  });

  it("throws when a ref points at a missing namespace at runtime", () => {
    expect(() => applyTemplate("{{user}}", refs, { otherNs: { USER: "x" } })).toThrow(
      /database\/USER not present/,
    );
  });
});

describe("applyShape", () => {
  const refs = {
    host: { namespace: "database", key: "HOST" },
    user: { namespace: "database", key: "USER" },
    pass: { namespace: "database", key: "PASS" },
  };
  const values = {
    database: { HOST: "db.internal", USER: "app", PASS: "hunter2" },
  };

  it("produces a mapped object with literals and substitutions (Record shape)", () => {
    const result = applyShape(
      {
        region: "us-east-1",
        dbHost: "{{host}}",
        connectionString: "postgres://{{user}}:{{pass}}@{{host}}:5432/app",
      },
      refs,
      values,
    );
    expect(result).toEqual({
      region: "us-east-1",
      dbHost: "db.internal",
      connectionString: "postgres://app:hunter2@db.internal:5432/app",
    });
  });

  it("returns an empty object for an empty Record shape", () => {
    expect(applyShape({}, refs, values)).toEqual({});
  });

  it("returns a plain string when shape is a string template", () => {
    const result = applyShape("postgres://{{user}}:{{pass}}@{{host}}:5432/app", refs, values);
    expect(result).toBe("postgres://app:hunter2@db.internal:5432/app");
  });

  it("returns the string literally when shape has no placeholders", () => {
    expect(applyShape("static-value", refs, values)).toBe("static-value");
  });
});

describe("validateShape", () => {
  const baseArgs = {
    identity: "api-gateway",
    environment: "production",
    availableKeys: {
      database: ["DATABASE_HOST", "DATABASE_USER", "DATABASE_PASSWORD"],
      api: ["API_KEY"],
    },
  };

  it("passes when every placeholder is bound and refs resolve", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: {
          dbHost: "{{host}}",
          dbUser: "{{user}}",
          connStr: "postgres://{{user}}:{{pass}}@{{host}}",
          region: "us-east-1", // pure literal
        },
        refs: {
          host: { namespace: "database", key: "DATABASE_HOST" },
          user: { namespace: "database", key: "DATABASE_USER" },
          pass: { namespace: "database", key: "DATABASE_PASSWORD" },
        },
      }),
    ).not.toThrow();
  });

  it("passes for an empty shape", () => {
    expect(() => validateShape({ ...baseArgs, shape: {} })).not.toThrow();
  });

  it("throws when a placeholder has no matching refs entry", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{host}}" },
        refs: {},
      }),
    ).toThrow(/shape\['dbHost'\] references placeholder \{\{host\}\} which is not declared/);
  });

  it("suggests a similar alias when a placeholder is misspelled", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{hsot}}" }, // typo of `host`
        refs: {
          host: { namespace: "database", key: "DATABASE_HOST" },
        },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Did you mean \{\{host\}\}/);
    }
  });

  it("throws when a ref's namespace is not in the envelope", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{host}}" },
        refs: { host: { namespace: "missing-ns", key: "DATABASE_HOST" } },
      }),
    ).toThrow(/refs\['host'\]\.namespace = 'missing-ns' is not a namespace/);
  });

  it("suggests a similar namespace when one is misspelled", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{host}}" },
        refs: { host: { namespace: "datbase", key: "DATABASE_HOST" } },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Did you mean 'database'/);
    }
  });

  it("throws when a ref's key is not in its namespace", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{host}}" },
        refs: { host: { namespace: "database", key: "DATABSAE_HOST" } },
      }),
    ).toThrow(/refs\['host'\] = database\/DATABSAE_HOST not found/);
  });

  it("suggests a similar key when one is misspelled", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { dbHost: "{{host}}" },
        refs: { host: { namespace: "database", key: "DATABSAE_HOST" } },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Did you mean database\/DATABASE_HOST/);
    }
  });

  it("warns about declared refs that aren't used by the shape", () => {
    const result = validateShape({
      ...baseArgs,
      shape: { dbHost: "{{host}}" },
      refs: {
        host: { namespace: "database", key: "DATABASE_HOST" },
        unused: { namespace: "database", key: "DATABASE_USER" },
      },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/refs\['unused'\] is declared but not used/);
  });

  it("returns no warnings when everything is used", () => {
    const result = validateShape({
      ...baseArgs,
      shape: { dbHost: "{{host}}" },
      refs: { host: { namespace: "database", key: "DATABASE_HOST" } },
    });
    expect(result.warnings).toEqual([]);
  });

  it("notes the identity and environment in placeholder errors", () => {
    try {
      validateShape({
        ...baseArgs,
        shape: { x: "{{nope}}" },
      });
      fail("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/identity:\s+api-gateway/);
      expect(msg).toMatch(/environment:\s+production/);
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

  it("rejects a shape that is neither string nor object", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: 42 as unknown as string,
      }),
    ).toThrow(/shape must be a string or an object of strings/);
  });

  it("rejects malformed ref entries", () => {
    expect(() =>
      validateShape({
        ...baseArgs,
        shape: { x: "{{host}}" },
        refs: { host: { namespace: "database" } as unknown as { namespace: string; key: string } },
      }),
    ).toThrow(/refs\['host'\]\.key must be a non-empty string/);
  });

  describe("string shape", () => {
    it("passes when every placeholder in the string is bound", () => {
      expect(() =>
        validateShape({
          ...baseArgs,
          shape: "postgres://{{user}}:{{pass}}@{{host}}",
          refs: {
            host: { namespace: "database", key: "DATABASE_HOST" },
            user: { namespace: "database", key: "DATABASE_USER" },
            pass: { namespace: "database", key: "DATABASE_PASSWORD" },
          },
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

    it("uses <value> as the location pointer for string shapes", () => {
      try {
        validateShape({
          ...baseArgs,
          shape: "postgres://{{host}}",
          refs: {},
        });
        fail("expected throw");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toMatch(/<value> references placeholder \{\{host\}\}/);
      }
    });
  });
});
