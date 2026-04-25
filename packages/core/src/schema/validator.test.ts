import * as fs from "fs";
import * as YAML from "yaml";
import { SchemaValidator } from "./validator";
import { NamespaceSchema, SchemaLoadError } from "../types";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

function testSchema(): NamespaceSchema {
  return {
    keys: {
      DATABASE_URL: {
        type: "string",
        required: true,
        pattern: "^postgres://",
        description: "PostgreSQL connection string",
      },
      DATABASE_POOL_SIZE: {
        type: "integer",
        required: false,
      },
      DATABASE_SSL: {
        type: "boolean",
        required: true,
      },
    },
  };
}

describe("SchemaValidator", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
    jest.clearAllMocks();
  });

  describe("loadSchema", () => {
    it("should load and parse a valid schema file", () => {
      const schemaYaml = YAML.stringify({
        keys: {
          DATABASE_URL: {
            type: "string",
            required: true,
            pattern: "^postgres://",
            description: "PostgreSQL connection string",
          },
          DATABASE_SSL: {
            type: "boolean",
            required: true,
          },
        },
      });
      mockFs.readFileSync.mockReturnValue(schemaYaml);

      const schema = validator.loadSchema("/repo/schemas/database.yaml");

      expect(schema.keys.DATABASE_URL.type).toBe("string");
      expect(schema.keys.DATABASE_URL.required).toBe(true);
      expect(schema.keys.DATABASE_URL.pattern).toBe("^postgres://");
      expect(schema.keys.DATABASE_SSL.type).toBe("boolean");
    });

    it("should throw SchemaLoadError when file does not exist", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => validator.loadSchema("/repo/schemas/missing.yaml")).toThrow(SchemaLoadError);
    });

    it("should throw SchemaLoadError on invalid YAML", () => {
      mockFs.readFileSync.mockReturnValue("{{bad yaml");

      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(SchemaLoadError);
    });

    it("should throw SchemaLoadError when keys map is missing", () => {
      mockFs.readFileSync.mockReturnValue(YAML.stringify({ not_keys: {} }));

      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(SchemaLoadError);
      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(/missing the required/);
    });

    it("should throw SchemaLoadError on non-object content", () => {
      mockFs.readFileSync.mockReturnValue("just a string");

      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(SchemaLoadError);
    });

    it("should throw SchemaLoadError for invalid key type", () => {
      const schemaYaml = YAML.stringify({
        keys: {
          BAD_KEY: { type: "float", required: true },
        },
      });
      mockFs.readFileSync.mockReturnValue(schemaYaml);

      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(SchemaLoadError);
      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(/invalid type/);
    });

    it("should throw SchemaLoadError for non-object key definition", () => {
      const schemaYaml = YAML.stringify({
        keys: {
          BAD_KEY: "just a string",
        },
      });
      mockFs.readFileSync.mockReturnValue(schemaYaml);

      expect(() => validator.loadSchema("/repo/schemas/bad.yaml")).toThrow(SchemaLoadError);
    });

    it("should include optional fields when present", () => {
      const schemaYaml = YAML.stringify({
        keys: {
          POOL: {
            type: "integer",
            required: false,
            description: "Pool size",
          },
        },
      });
      mockFs.readFileSync.mockReturnValue(schemaYaml);

      const schema = validator.loadSchema("/repo/schemas/test.yaml");
      expect(schema.keys.POOL.description).toBe("Pool size");
    });

    it("should ignore legacy default and max fields", () => {
      const schemaYaml = YAML.stringify({
        keys: {
          POOL: {
            type: "integer",
            required: false,
            default: 10,
            max: 50,
          },
        },
      });
      mockFs.readFileSync.mockReturnValue(schemaYaml);

      const schema = validator.loadSchema("/repo/schemas/test.yaml");
      expect(schema.keys.POOL).toEqual({ type: "integer", required: false });
    });
  });

  describe("validate", () => {
    it("should pass for valid values", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_POOL_SIZE: "10",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    // Required key missing (error)
    it("should error on missing required key", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          // DATABASE_SSL is missing and required
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe("DATABASE_SSL");
      expect(result.errors[0].rule).toBe("required");
    });

    it("should not error on missing optional key", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_SSL: "true",
          // DATABASE_POOL_SIZE is optional, so missing is fine
        },
        testSchema(),
      );

      expect(result.valid).toBe(true);
    });

    // Wrong type (error) — integer
    it("should error on non-integer value for integer type", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_POOL_SIZE: "not-a-number",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === "DATABASE_POOL_SIZE" && e.rule === "type")).toBe(
        true,
      );
    });

    it("should error on empty string for integer type", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_POOL_SIZE: "   ",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === "DATABASE_POOL_SIZE" && e.rule === "type")).toBe(
        true,
      );
    });

    it("should error on float for integer type", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_POOL_SIZE: "3.14",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
    });

    // Wrong type (error) — boolean
    it("should error on invalid boolean value", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_SSL: "yes",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === "DATABASE_SSL" && e.rule === "type")).toBe(true);
    });

    it("should accept case-insensitive booleans", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_SSL: "TRUE",
        },
        testSchema(),
      );

      expect(result.valid).toBe(true);
    });

    // Pattern mismatch (error)
    it("should error on pattern mismatch", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "mysql://localhost/mydb",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === "DATABASE_URL" && e.rule === "pattern")).toBe(
        true,
      );
    });

    it("should pass on matching pattern", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_SSL: "true",
        },
        testSchema(),
      );

      expect(result.valid).toBe(true);
    });

    // Undeclared key (warning)
    it("should warn on undeclared key", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "postgres://localhost/mydb",
          DATABASE_SSL: "true",
          UNKNOWN_KEY: "something",
        },
        testSchema(),
      );

      expect(result.valid).toBe(true); // Warnings don't make it invalid
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].key).toBe("UNKNOWN_KEY");
      expect(result.warnings[0].rule).toBe("undeclared");
    });

    // Multiple errors at once
    it("should collect multiple errors and warnings", () => {
      const result = validator.validate(
        {
          DATABASE_URL: "mysql://bad",
          EXTRA: "val",
        },
        testSchema(),
      );

      expect(result.valid).toBe(false);
      // Missing required DATABASE_SSL + pattern mismatch on DATABASE_URL
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      // Undeclared EXTRA
      expect(result.warnings.some((w) => w.rule === "undeclared" && w.key === "EXTRA")).toBe(true);
    });

    // Empty values
    it("should handle empty values map", () => {
      const result = validator.validate({}, testSchema());

      expect(result.valid).toBe(false);
      // Should report required keys as errors
      const requiredErrors = result.errors.filter((e) => e.rule === "required");
      expect(requiredErrors).toHaveLength(2); // DATABASE_URL + DATABASE_SSL
    });

    // Empty schema
    it("should pass any values against empty schema with warnings for all", () => {
      const result = validator.validate({ FOO: "bar", BAZ: "qux" }, { keys: {} });

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings.every((w) => w.rule === "undeclared")).toBe(true);
    });
  });
});
