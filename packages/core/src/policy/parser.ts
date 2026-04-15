/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * The parsed policy is embedded verbatim in compliance artifacts and hashed
 * for cross-repo drift detection. A validation slip here ships a corrupt
 * policy snapshot to every downstream consumer and breaks reproducibility of
 * older artifacts via hash mismatch. Before adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as fs from "fs";
import * as YAML from "yaml";
import { PolicyValidationError } from "../types";
import { DEFAULT_POLICY, PolicyDocument, PolicyRotationConfig } from "./types";

/** Canonical filename for the Clef policy file, relative to the repo root. */
export const CLEF_POLICY_FILENAME = ".clef/policy.yaml";

const SUPPORTED_VERSIONS = [1] as const;

/**
 * Parses and validates `.clef/policy.yaml` files.
 *
 * @example
 * ```ts
 * const parser = new PolicyParser();
 * const policy = parser.load(".clef/policy.yaml"); // returns DEFAULT_POLICY if missing
 * ```
 */
export class PolicyParser {
  /**
   * Read and validate a policy file from disk.
   *
   * @throws {@link PolicyValidationError} If the file cannot be read, contains
   *   invalid YAML, or fails schema validation.
   */
  parse(filePath: string): PolicyDocument {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new PolicyValidationError(`Could not read policy file at '${filePath}'.`);
    }
    return this.parseContent(raw);
  }

  /**
   * Parse and validate a policy document from a YAML string.
   *
   * @throws {@link PolicyValidationError} If the content is malformed or
   *   fails validation.
   */
  parseContent(content: string): PolicyDocument {
    let parsed: unknown;
    try {
      parsed = YAML.parse(content);
    } catch {
      throw new PolicyValidationError(
        "Policy file contains invalid YAML. Check for syntax errors.",
      );
    }
    return this.validate(parsed);
  }

  /**
   * Load policy from disk, returning {@link DEFAULT_POLICY} if the file does
   * not exist. Any other read or validation error throws.
   */
  load(filePath: string): PolicyDocument {
    if (!fs.existsSync(filePath)) return DEFAULT_POLICY;
    return this.parse(filePath);
  }

  private validate(raw: unknown): PolicyDocument {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new PolicyValidationError("Policy file must be a YAML object.");
    }
    const doc = raw as Record<string, unknown>;

    if (!SUPPORTED_VERSIONS.includes(doc.version as 1)) {
      throw new PolicyValidationError(
        `Policy file must declare 'version: 1', got: ${JSON.stringify(doc.version)}.`,
        "version",
      );
    }

    const rotation = doc.rotation === undefined ? undefined : this.validateRotation(doc.rotation);

    return { version: 1, ...(rotation ? { rotation } : {}) };
  }

  private validateRotation(raw: unknown): PolicyRotationConfig {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new PolicyValidationError("Policy 'rotation' must be an object.", "rotation");
    }
    const rot = raw as Record<string, unknown>;

    const maxAge = rot.max_age_days;
    if (typeof maxAge !== "number" || !Number.isFinite(maxAge) || maxAge <= 0) {
      throw new PolicyValidationError(
        "Policy 'rotation.max_age_days' must be a positive number.",
        "rotation.max_age_days",
      );
    }

    const result: PolicyRotationConfig = { max_age_days: maxAge };

    if (rot.environments !== undefined) {
      if (
        typeof rot.environments !== "object" ||
        rot.environments === null ||
        Array.isArray(rot.environments)
      ) {
        throw new PolicyValidationError(
          "Policy 'rotation.environments' must be an object keyed by environment name.",
          "rotation.environments",
        );
      }
      const envs: Record<string, { max_age_days: number }> = {};
      for (const [envName, envVal] of Object.entries(rot.environments as Record<string, unknown>)) {
        if (typeof envVal !== "object" || envVal === null || Array.isArray(envVal)) {
          throw new PolicyValidationError(
            `Policy 'rotation.environments.${envName}' must be an object.`,
            `rotation.environments.${envName}`,
          );
        }
        const envMaxAge = (envVal as Record<string, unknown>).max_age_days;
        if (typeof envMaxAge !== "number" || !Number.isFinite(envMaxAge) || envMaxAge <= 0) {
          throw new PolicyValidationError(
            `Policy 'rotation.environments.${envName}.max_age_days' must be a positive number.`,
            `rotation.environments.${envName}.max_age_days`,
          );
        }
        envs[envName] = { max_age_days: envMaxAge };
      }
      result.environments = envs;
    }

    return result;
  }
}
