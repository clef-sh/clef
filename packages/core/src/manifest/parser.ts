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
import { ClefManifest, ClefEnvironment, ManifestValidationError } from "../types";

/**
 * Canonical filename for the Clef manifest.
 * All code that references this filename must import this constant.
 */
export const CLEF_MANIFEST_FILENAME = "clef.yaml";

const VALID_BACKENDS = ["age", "awskms", "gcpkms", "pgp"] as const;
const VALID_TOP_LEVEL_KEYS = ["version", "environments", "namespaces", "sops", "file_pattern"];
const ENV_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const FILE_PATTERN_REQUIRED_TOKENS = ["{namespace}", "{environment}"];

/**
 * Parses and validates `clef.yaml` manifest files.
 *
 * @example
 * ```ts
 * const parser = new ManifestParser();
 * const manifest = parser.parse("/path/to/clef.yaml");
 * ```
 */
export class ManifestParser {
  /**
   * Read and validate a `clef.yaml` file from disk.
   *
   * @param filePath - Absolute or relative path to the manifest file.
   * @returns Validated {@link ClefManifest}.
   * @throws {@link ManifestValidationError} If the file cannot be read, contains invalid YAML,
   *   or fails schema validation.
   */
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

  /**
   * Validate an already-parsed object against the manifest schema.
   *
   * @param input - Raw value returned by `YAML.parse`.
   * @returns Validated {@link ClefManifest}.
   * @throws {@link ManifestValidationError} On any schema violation.
   */
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
    const environments: ClefEnvironment[] = obj.environments.map((env: unknown, i: number) => {
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

      const result: ClefEnvironment = {
        name: envObj.name,
        description: envObj.description,
        ...(typeof envObj.protected === "boolean" ? { protected: envObj.protected } : {}),
      };

      // Parse optional per-environment sops override
      if (envObj.sops !== undefined) {
        if (typeof envObj.sops !== "object" || envObj.sops === null) {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' has an invalid 'sops' field. It must be an object.`,
            "environments",
          );
        }
        const sopsOverride = envObj.sops as Record<string, unknown>;
        if (!sopsOverride.backend || typeof sopsOverride.backend !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' sops override is missing 'backend'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
            "environments",
          );
        }
        if (!(VALID_BACKENDS as readonly string[]).includes(sopsOverride.backend)) {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' has invalid sops backend '${sopsOverride.backend}'. Must be one of: ${VALID_BACKENDS.join(", ")}.`,
            "environments",
          );
        }
        const backend = sopsOverride.backend as (typeof VALID_BACKENDS)[number];

        // Validate required fields per backend
        if (backend === "awskms" && typeof sopsOverride.aws_kms_arn !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'awskms' backend but is missing 'aws_kms_arn'.`,
            "environments",
          );
        }
        if (backend === "gcpkms" && typeof sopsOverride.gcp_kms_resource_id !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'gcpkms' backend but is missing 'gcp_kms_resource_id'.`,
            "environments",
          );
        }
        if (backend === "pgp" && typeof sopsOverride.pgp_fingerprint !== "string") {
          throw new ManifestValidationError(
            `Environment '${envObj.name}' uses 'pgp' backend but is missing 'pgp_fingerprint'.`,
            "environments",
          );
        }

        result.sops = {
          backend,
          ...(typeof sopsOverride.aws_kms_arn === "string"
            ? { aws_kms_arn: sopsOverride.aws_kms_arn }
            : {}),
          ...(typeof sopsOverride.gcp_kms_resource_id === "string"
            ? { gcp_kms_resource_id: sopsOverride.gcp_kms_resource_id }
            : {}),
          ...(typeof sopsOverride.pgp_fingerprint === "string"
            ? { pgp_fingerprint: sopsOverride.pgp_fingerprint }
            : {}),
        };
      }

      return result;
    });

    // Check for duplicate environment names
    const envNames = new Set<string>();
    for (const env of environments) {
      if (envNames.has(env.name)) {
        throw new ManifestValidationError(
          `Duplicate environment name '${env.name}'. Each environment must have a unique name.`,
          "environments",
        );
      }
      envNames.add(env.name);
    }

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

    // Check for duplicate namespace names
    const nsNames = new Set<string>();
    for (const ns of namespaces) {
      if (nsNames.has(ns.name)) {
        throw new ManifestValidationError(
          `Duplicate namespace name '${ns.name}'. Each namespace must have a unique name.`,
          "namespaces",
        );
      }
      nsNames.add(ns.name);
    }

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

  /**
   * Watch a manifest file for changes and invoke a callback on each successful parse.
   *
   * @param filePath - Path to the manifest file to watch.
   * @param onChange - Called with the newly parsed manifest on each valid change.
   * @returns Unsubscribe function — call it to stop watching.
   */
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
