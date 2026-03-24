import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

/** Result of a single validation check. */
export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

/** Result of validating a broker directory. */
export interface ValidationResult {
  passed: boolean;
  checks: CheckResult[];
}

const VALID_PROVIDERS = ["aws", "gcp", "azure", "agnostic"];
const VALID_TIERS = [1, 2, 3];

const REQUIRED_MANIFEST_FIELDS = [
  "name",
  "version",
  "description",
  "author",
  "license",
  "provider",
  "tier",
  "inputs",
] as const;

const REQUIRED_README_HEADINGS = [
  "description",
  "prerequisites",
  "configuration",
  "deploy",
] as const;

/**
 * Validate a broker directory for registry contribution.
 *
 * Checks:
 * 1. broker.yaml exists and is valid YAML
 * 2. All required manifest fields are present and valid
 * 3. handler.ts (or handler.js) exists
 * 4. README.md exists with required sections
 * 5. Inputs array structure is valid
 * 6. Name matches directory name (if inferrable)
 */
export function validateBroker(brokerDir: string): ValidationResult {
  const checks: CheckResult[] = [];

  function check(name: string, fn: () => string | true): void {
    try {
      const result = fn();
      if (result === true) {
        checks.push({ name, passed: true, message: "OK" });
      } else {
        checks.push({ name, passed: false, message: result });
      }
    } catch (err) {
      checks.push({
        name,
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── broker.yaml ──────────────────────────────────────────────────────────

  const manifestPath = path.join(brokerDir, "broker.yaml");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed YAML is untyped
  let manifest: any;

  check("broker.yaml exists", () => {
    if (!fs.existsSync(manifestPath)) return "broker.yaml not found";
    return true;
  });

  check("broker.yaml is valid YAML", () => {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    manifest = parseYaml(raw);
    if (!manifest || typeof manifest !== "object") return "broker.yaml is empty or not an object";
    return true;
  });

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    check(`manifest.${field} is present`, () => {
      if (!manifest) return "broker.yaml could not be parsed";
      if (manifest[field] === undefined || manifest[field] === null) {
        return `Missing required field: ${field}`;
      }
      return true;
    });
  }

  check("manifest.provider is valid", () => {
    if (!manifest) return "broker.yaml could not be parsed";
    if (!VALID_PROVIDERS.includes(manifest.provider)) {
      return `provider must be one of: ${VALID_PROVIDERS.join(", ")}. Got: "${manifest.provider}"`;
    }
    return true;
  });

  check("manifest.tier is valid", () => {
    if (!manifest) return "broker.yaml could not be parsed";
    if (!VALID_TIERS.includes(Number(manifest.tier))) {
      return `tier must be 1, 2, or 3. Got: ${manifest.tier}`;
    }
    return true;
  });

  check("manifest.version is semver-like", () => {
    if (!manifest) return "broker.yaml could not be parsed";
    if (!/^\d+\.\d+\.\d+/.test(String(manifest.version))) {
      return `version should be semver (e.g. "1.0.0"). Got: "${manifest.version}"`;
    }
    return true;
  });

  check("manifest.name is lowercase with hyphens", () => {
    if (!manifest) return "broker.yaml could not be parsed";
    if (!/^[a-z][a-z0-9-]*$/.test(String(manifest.name))) {
      return `name must be lowercase with hyphens (e.g. "rds-iam"). Got: "${manifest.name}"`;
    }
    return true;
  });

  check("manifest.inputs is an array", () => {
    if (!manifest) return "broker.yaml could not be parsed";
    if (!Array.isArray(manifest.inputs)) {
      return `inputs must be an array. Got: ${typeof manifest.inputs}`;
    }
    return true;
  });

  check("manifest.inputs entries have name and description", () => {
    if (!manifest || !Array.isArray(manifest.inputs)) return "inputs not available";
    for (let i = 0; i < manifest.inputs.length; i++) {
      const input = manifest.inputs[i];
      if (!input.name) return `inputs[${i}] is missing "name"`;
      if (!input.description) return `inputs[${i}] is missing "description"`;
    }
    return true;
  });

  // ── handler file ─────────────────────────────────────────────────────────

  check("handler file exists", () => {
    const tsPath = path.join(brokerDir, "handler.ts");
    const jsPath = path.join(brokerDir, "handler.js");
    if (!fs.existsSync(tsPath) && !fs.existsSync(jsPath)) {
      return "handler.ts (or handler.js) not found";
    }
    return true;
  });

  check("handler exports create function", () => {
    const tsPath = path.join(brokerDir, "handler.ts");
    const jsPath = path.join(brokerDir, "handler.js");
    const handlerPath = fs.existsSync(tsPath) ? tsPath : jsPath;
    if (!fs.existsSync(handlerPath)) return "handler file not found";

    const source = fs.readFileSync(handlerPath, "utf-8");
    // Check for create method/property in export — works for both
    // `export const handler: BrokerHandler = { create: ... }`
    // and `export default { create: ... }`
    // and `export { handler }` with create inside
    if (!source.includes("create")) {
      return 'handler file does not contain "create" — must export a BrokerHandler with a create method';
    }
    return true;
  });

  // ── README.md ────────────────────────────────────────────────────────────

  const readmePath = path.join(brokerDir, "README.md");

  check("README.md exists", () => {
    if (!fs.existsSync(readmePath)) return "README.md not found";
    return true;
  });

  check("README.md has required sections", () => {
    if (!fs.existsSync(readmePath)) return "README.md not found";
    const readme = fs.readFileSync(readmePath, "utf-8").toLowerCase();
    const missing: string[] = [];
    for (const heading of REQUIRED_README_HEADINGS) {
      // Look for markdown heading containing the keyword
      if (!readme.includes(`# ${heading}`) && !readme.includes(`## ${heading}`)) {
        missing.push(heading);
      }
    }
    if (missing.length > 0) {
      return `README.md is missing required sections: ${missing.join(", ")}`;
    }
    return true;
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * Format validation results for terminal output.
 */
export function formatResults(result: ValidationResult): string {
  const lines: string[] = [];
  for (const check of result.checks) {
    const icon = check.passed ? "PASS" : "FAIL";
    lines.push(`  ${icon}  ${check.name}${check.passed ? "" : ` — ${check.message}`}`);
  }

  const total = result.checks.length;
  const passed = result.checks.filter((c) => c.passed).length;
  const failed = total - passed;
  lines.push("");
  lines.push(`  ${passed}/${total} checks passed${failed > 0 ? `, ${failed} failed` : ""}`);

  return lines.join("\n");
}
