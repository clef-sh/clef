import * as fs from "fs";
import * as YAML from "yaml";
import {
  NamespaceSchema,
  SchemaLoadError,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from "../types";

export class SchemaValidator {
  loadSchema(filePath: string): NamespaceSchema {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new SchemaLoadError(`Could not read schema file at '${filePath}'.`, filePath);
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      throw new SchemaLoadError(`Schema file '${filePath}' contains invalid YAML.`, filePath);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new SchemaLoadError(
        `Schema file '${filePath}' must be a YAML object with a 'keys' map.`,
        filePath,
      );
    }

    const obj = parsed as Record<string, unknown>;
    if (!obj.keys || typeof obj.keys !== "object") {
      throw new SchemaLoadError(
        `Schema file '${filePath}' is missing the required 'keys' map.`,
        filePath,
      );
    }

    const keys: NamespaceSchema["keys"] = {};
    const keysObj = obj.keys as Record<string, unknown>;

    for (const [keyName, keyDef] of Object.entries(keysObj)) {
      if (!keyDef || typeof keyDef !== "object") {
        throw new SchemaLoadError(
          `Schema key '${keyName}' must be an object with at least 'type' and 'required'.`,
          filePath,
        );
      }

      const def = keyDef as Record<string, unknown>;
      const type = def.type as string;
      if (!["string", "integer", "boolean"].includes(type)) {
        throw new SchemaLoadError(
          `Schema key '${keyName}' has invalid type '${type}'. Must be 'string', 'integer', or 'boolean'.`,
          filePath,
        );
      }

      keys[keyName] = {
        type: type as "string" | "integer" | "boolean",
        required: def.required === true,
        ...(typeof def.pattern === "string" ? { pattern: def.pattern } : {}),
        ...(def.default !== undefined ? { default: def.default } : {}),
        ...(typeof def.description === "string" ? { description: def.description } : {}),
        ...(typeof def.max === "number" ? { max: def.max } : {}),
      };
    }

    return { keys };
  }

  validate(values: Record<string, string>, schema: NamespaceSchema): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required keys and type/pattern validation
    for (const [keyName, keyDef] of Object.entries(schema.keys)) {
      const value = values[keyName];

      if (value === undefined || value === null) {
        if (keyDef.required) {
          errors.push({
            key: keyName,
            message: `Required key '${keyName}' is missing.`,
            rule: "required",
          });
        }
        continue;
      }

      // Type validation
      switch (keyDef.type) {
        case "integer": {
          const num = Number(value);
          if (!Number.isInteger(num) || value.trim() === "") {
            errors.push({
              key: keyName,
              message: `Key '${keyName}' must be an integer, got '${value}'.`,
              rule: "type",
            });
          } else if (keyDef.max !== undefined && num > keyDef.max) {
            warnings.push({
              key: keyName,
              message: `Key '${keyName}' value ${num} exceeds maximum ${keyDef.max}.`,
              rule: "max_exceeded",
            });
          }
          break;
        }
        case "boolean": {
          const lower = value.toLowerCase();
          if (!["true", "false"].includes(lower)) {
            errors.push({
              key: keyName,
              message: `Key '${keyName}' must be a boolean ('true' or 'false'), got '${value}'.`,
              rule: "type",
            });
          }
          break;
        }
        case "string":
          // Strings are always valid type-wise
          break;
      }

      // Pattern validation (only for strings)
      if (keyDef.pattern && keyDef.type === "string") {
        const regex = new RegExp(keyDef.pattern);
        if (!regex.test(value)) {
          errors.push({
            key: keyName,
            message: `Key '${keyName}' value does not match required pattern '${keyDef.pattern}'.`,
            rule: "pattern",
          });
        }
      }
    }

    // Check for undeclared keys
    for (const keyName of Object.keys(values)) {
      if (!(keyName in schema.keys)) {
        warnings.push({
          key: keyName,
          message: `Key '${keyName}' is not declared in the schema.`,
          rule: "undeclared",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
