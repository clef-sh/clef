import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

export const POLICY_FILE_PATH = ".clef/policy.yaml";

const CLEF_GITIGNORE_PATH = ".clef/.gitignore";
const POLICY_GITIGNORE_EXCEPTION = "!policy.yaml";

export const POLICY_TEMPLATE = `# Clef bot policy. https://docs.clef.sh/bot
#
# This file controls how the Clef bot behaves on your repo. Commit it to git
# alongside clef.yaml. Changes to this file are reviewed via PR like any other
# config change.

version: 1

# Block PRs that introduce plaintext secrets outside the matrix
scan:
  enabled: true
  block_on: error

# Run clef lint on every PR touching secrets/, schemas/, or clef.yaml
lint:
  enabled: true

# Open weekly drift PRs if environments diverge
drift:
  enabled: true
  schedule: weekly

# Open issues when secrets are overdue for rotation.
# Default applies to all namespaces unless overridden below.
rotation:
  default: 90d
  # Per-namespace overrides:
  # namespaces:
  #   stripe-api:
  #     schedule: 90d
  #     compliance: SOC2
  #     owners: ["@payments-team"]
`;

export interface ScaffoldResult {
  /** `true` if the file was written; `false` if it already existed. */
  created: boolean;
  /** Absolute path to the policy file. */
  filePath: string;
}

export type ParsePolicyResult = { valid: true } | { valid: false; reason: string };

/**
 * Write `.clef/policy.yaml` with the default template.
 * Also ensures `.clef/.gitignore` has a `!policy.yaml` exception so the file
 * can be staged — the `.clef/` directory is otherwise fully gitignored.
 * Does nothing if the file already exists.
 */
export function scaffoldPolicyFile(repoRoot: string): ScaffoldResult {
  const filePath = path.join(repoRoot, POLICY_FILE_PATH);
  if (fs.existsSync(filePath)) {
    return { created: false, filePath };
  }

  const clefDir = path.dirname(filePath);
  fs.mkdirSync(clefDir, { recursive: true });

  // Ensure .clef/.gitignore allows policy.yaml to be tracked
  const gitignorePath = path.join(repoRoot, CLEF_GITIGNORE_PATH);
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf-8");
    if (!existing.includes(POLICY_GITIGNORE_EXCEPTION)) {
      fs.writeFileSync(
        gitignorePath,
        existing.trimEnd() + "\n" + POLICY_GITIGNORE_EXCEPTION + "\n",
        "utf-8",
      );
    }
  } else {
    fs.writeFileSync(gitignorePath, "*\n" + POLICY_GITIGNORE_EXCEPTION + "\n", "utf-8");
  }

  fs.writeFileSync(filePath, POLICY_TEMPLATE, "utf-8");
  return { created: true, filePath };
}

/**
 * Read and validate an existing `.clef/policy.yaml`.
 * Checks: file is readable, parses as valid YAML, has `version: 1`.
 */
export function parsePolicyFile(repoRoot: string): ParsePolicyResult {
  const filePath = path.join(repoRoot, POLICY_FILE_PATH);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Could not read file: ${message}` };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Invalid YAML: ${message}` };
  }

  if (doc === null || typeof doc !== "object") {
    return { valid: false, reason: "Policy file is empty or not a YAML mapping." };
  }

  const version = (doc as Record<string, unknown>).version;
  if (version !== 1) {
    return {
      valid: false,
      reason: `Expected version: 1, got: ${JSON.stringify(version)}`,
    };
  }

  return { valid: true };
}
