/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as fs from "fs";
import * as YAML from "yaml";
import { ClefManifest, ManifestValidationError } from "../types";

// CANONICAL MANIFEST FILENAME
// This is the single source of truth for the manifest filename.
// All other references in the codebase must import this constant.
export const CLEF_MANIFEST_FILENAME = "clef.yaml";

const VALID_BACKENDS = ["age", "awskms", "gcpkms", "pgp"] as const;
const VALID_TOP_LEVEL_KEYS = ["version", "environments", "namespaces", "sops", "file_pattern"];
const ENV_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const FILE_PATTERN_REQUIRED_TOKENS = ["{namespace}", "{environment}"];

export class ManifestParser {
  parse(filePath: string): ClefManifest {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new ManifestValidationError(
        `Could not read manifest file at '${filePath}'. Run 'clef init' to create one.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      throw new ManifestValidationError(
        "Manifest file contains invalid YAML. Check for syntax errors in clef.yaml.",
      );
    }

    return this.validate(parsed);
  }

  validate(input: unknown): ClefManifest {
    if (input === null || input === undefined || typeof input !== "object") {
      throw new ManifestValidationError(
        "Manifest must be a YAML object, not null or a scalar value.",
        "root",
      );
    }

    const obj = input as Record<string, unknown>;

    // Check for unknown top-level keys
    for (const key of Object.keys(obj)) {
      if (!VALID_TOP_LEVEL_KEYS.includes(key)) {
        throw new ManifestValidationError(
          `Unknown top-level key '${key}' in manifest. Valid keys are: ${VALID_TOP_LEVEL_KEYS.join(", ")}.`,
          key,
        );
      }
    }

    // version
    if (obj.version === undefined) {
      throw new ManifestValidationError("Missing required field 'version'.", "version");
    }
    if (typeof obj.version !== "number" || obj.version !== 1) {
      throw new ManifestValidationError(
        "Field 'version' must be 1. Only version 1 is currently supported.",
        "version",
      );
    }

    // environments
    if (!obj.environments) {
      throw new ManifestValidationError(
        "Missing required field 'environments'. Define at least one environment.",
        "environments",
      );
    }
    if (!Array.isArray(obj.environments) || obj.environments.length === 0) {
      throw new ManifestValidationError(
        "Field 'environments' must be a non-empty array.",
        "environments",
      );
    }
    const environments = obj.environments.map((env: unknown, i: number) => {
      if (typeof env !== "object" || env === null) {
        throw new ManifestValidationError(
          `Environment at index ${i} must be an object with 'name' and 'description'.`,
          "environments",
        );
      }
      const envObj = env as Record<string, unknown>;
      if (!envObj.name || typeof envObj.name !== "string") {
        throw new ManifestValidationError(
          `Environment at index ${i} is missing a 'name' string.`,
          "environments",
        );
      }
      if (!ENV_NAME_PATTERN.test(envObj.name)) {
        throw new ManifestValidationError(
          `Environment name '${envObj.name}' is invalid. Names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, and underscores.`,
          "environments",
        );
      }
      if (!envObj.description || typeof envObj.description !== "string") {
        throw new ManifestValidationError(
          `Environment '${envObj.name}' is missing a 'description' string.`,
          "environments",
        );
      }
      return {
        name: envObj.name,
        description: envObj.description,
        ...(typeof envObj.protected === "boolean" ? { protected: envObj.protected } : {}),
      };
    });

    // namespaces
    // Design decision: all namespaces are encrypted. There is no `encrypted: false`
    // option on namespace definitions. This is intentional — see docs/guide/concepts.md
    // "Design decision: all namespaces are encrypted" for the full rationale.
    if (!obj.namespaces) {
      throw new ManifestValidationError(
        "Missing required field 'namespaces'. Define at least one namespace.",
        "namespaces",
      );
    }
    if (!Array.isArray(obj.namespaces) || obj.namespaces.length === 0) {
      throw new ManifestValidationError(
        "Field 'namespaces' must be a non-empty array.",
        "namespaces",
      );
    }
    const namespaces = obj.namespaces.map((ns: unknown, i: number) => {
      if (typeof ns !== "object" || ns === null) {
        throw new ManifestValidationError(
          `Namespace at index ${i} must be an object with 'name' and 'description'.`,
          "namespaces",
        );
      }
      const nsObj = ns as Record<string, unknown>;
      if (!nsObj.name || typeof nsObj.name !== "string") {
        throw new ManifestValidationError(
          `Namespace at index ${i} is missing a 'name' string.`,
          "namespaces",
        );
      }
      if (!nsObj.description || typeof nsObj.description !== "string") {
        throw new ManifestValidationError(
          `Namespace '${nsObj.name}' is missing a 'description' string.`,
          "namespaces",
        );
      }
      return {
        name: nsObj.name,
        description: nsObj.description,
        ...(typeof nsObj.schema === "string" ? { schema: nsObj.schema } : {}),
        ...(Array.isArray(nsObj.owners) ? { owners: nsObj.owners as string[] } : {}),
      };
    });

    // sops
    if (!obj.sops) {
      throw new ManifestValidationError(
        "Missing required field 'sops'. Configure at least 'default_backend'.",
        "sops",
      );
    }
    if (typeof obj.sops !== "object" || obj.sops === null) {
      throw new ManifestValidationError("Field 'sops' must be an object.", "sops");
    }
    const sopsObj = obj.sops as Record<string, unknown>;
    if (!sopsObj.default_backend || typeof sopsObj.default_backend !== "string") {
      throw new ManifestValidationError(
        "Field 'sops.default_backend' is required and must be one of: age, awskms, gcpkms, pgp.",
        "sops.default_backend",
      );
    }
    if (!(VALID_BACKENDS as readonly string[]).includes(sopsObj.default_backend)) {
      throw new ManifestValidationError(
        `Invalid sops.default_backend '${sopsObj.default_backend}'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
        "sops.default_backend",
      );
    }

    const sopsConfig = {
      default_backend: sopsObj.default_backend as (typeof VALID_BACKENDS)[number],
      ...(typeof sopsObj.age_key_file === "string" ? { age_key_file: sopsObj.age_key_file } : {}),
      ...(typeof sopsObj.aws_kms_arn === "string" ? { aws_kms_arn: sopsObj.aws_kms_arn } : {}),
      ...(typeof sopsObj.gcp_kms_resource_id === "string"
        ? { gcp_kms_resource_id: sopsObj.gcp_kms_resource_id }
        : {}),
      ...(typeof sopsObj.pgp_fingerprint === "string"
        ? { pgp_fingerprint: sopsObj.pgp_fingerprint }
        : {}),
    };

    // file_pattern
    if (!obj.file_pattern || typeof obj.file_pattern !== "string") {
      throw new ManifestValidationError(
        "Missing required field 'file_pattern'. Example: '{namespace}/{environment}.enc.yaml'.",
        "file_pattern",
      );
    }
    for (const token of FILE_PATTERN_REQUIRED_TOKENS) {
      if (!obj.file_pattern.includes(token)) {
        throw new ManifestValidationError(
          `file_pattern must contain '${token}'. Got: '${obj.file_pattern}'.`,
          "file_pattern",
        );
      }
    }

    return {
      version: 1,
      environments,
      namespaces,
      sops: sopsConfig,
      file_pattern: obj.file_pattern,
    };
  }

  watch(filePath: string, onChange: (manifest: ClefManifest) => void): () => void {
    const watcher = fs.watch(filePath, () => {
      try {
        const manifest = this.parse(filePath);
        onChange(manifest);
      } catch {
        // Ignore parse errors during watch — file may be mid-save
      }
    });

    return () => {
      watcher.close();
    };
  }
}
