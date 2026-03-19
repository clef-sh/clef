import * as path from "path";
import * as YAML from "yaml";

export type ImportFormat = "dotenv" | "json" | "yaml" | "auto";

export interface ParsedImport {
  pairs: Record<string, string>;
  format: Exclude<ImportFormat, "auto">;
  skipped: string[];
  warnings: string[];
}

/**
 * Auto-detect the format of a file from its extension, basename, and content heuristics.
 *
 * @param filePath - File path used for extension and basename detection.
 * @param content - Raw file content used as a fallback heuristic.
 * @returns Detected format (`"dotenv"`, `"json"`, or `"yaml"`).
 */
export function detectFormat(filePath: string, content: string): Exclude<ImportFormat, "auto"> {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // basename is ".env" or starts with ".env."
  if (base === ".env" || base.startsWith(".env.")) {
    return "dotenv";
  }

  // ends with ".env"
  if (base.endsWith(".env")) {
    return "dotenv";
  }

  // extension-based
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";

  // content heuristics
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    return "json";
  }

  // try JSON.parse — if it's a non-array object, it's JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return "json";
    }
  } catch {
    // not JSON
  }

  // try YAML.parse — if it's a non-array object, it's YAML
  try {
    const parsed = YAML.parse(content);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return "yaml";
    }
  } catch {
    // not YAML
  }

  // fallback
  return "dotenv";
}

/**
 * Parse dotenv-formatted content into flat key/value pairs.
 * Supports `export KEY=VALUE`, inline comments, and both single- and double-quoted values.
 */
export function parseDotenv(content: string): ParsedImport {
  const pairs: Record<string, string> = {};
  const skipped: string[] = [];
  const warnings: string[] = [];

  const lines = content.split("\n");
  for (const rawLine of lines) {
    let line = rawLine.trim();

    // Skip blank lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Strip "export " prefix
    if (line.startsWith("export ")) {
      line = line.slice(7);
    }

    // Must have KEY=VALUE format
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(eqIdx + 1);

    // Strip inline comments: everything after " #" (space-hash)
    const inlineCommentIdx = value.indexOf(" #");
    if (inlineCommentIdx !== -1) {
      value = value.slice(0, inlineCommentIdx);
    }

    // Strip matching outer quotes (" or ')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    pairs[key] = value;
  }

  return { pairs, format: "dotenv", skipped, warnings };
}

/**
 * Parse a JSON object into flat string key/value pairs.
 * Non-string values (numbers, booleans, nulls, arrays, objects) are skipped with warnings.
 *
 * @throws `Error` If the content is not valid JSON or the root is not an object.
 */
export function parseJson(content: string): ParsedImport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  if (Array.isArray(parsed)) {
    throw new Error(
      "JSON root must be an object, not an array. Clef keys are flat key/value pairs.",
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new Error("JSON root must be an object. Clef keys are flat key/value pairs.");
  }

  const pairs: Record<string, string> = {};
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      pairs[key] = value;
    } else if (value === null) {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is null, not string`);
    } else if (Array.isArray(value)) {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is array, not string`);
    } else if (typeof value === "object") {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is nested object, not string`);
    } else {
      // number, boolean
      skipped.push(key);
      warnings.push(`${key}: skipped — value is ${typeof value}, not string`);
    }
  }

  return { pairs, format: "json", skipped, warnings };
}

/**
 * Parse a YAML mapping into flat string key/value pairs.
 * Non-string values are skipped with warnings.
 *
 * @throws `Error` If the content is not valid YAML or the root is not a mapping.
 */
export function parseYaml(content: string): ParsedImport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = YAML.parse(content);
  } catch (err) {
    throw new Error(`Invalid YAML: ${(err as Error).message}`);
  }

  if (Array.isArray(parsed)) {
    throw new Error(
      "YAML root must be a mapping, not a sequence. Clef keys are flat key/value pairs.",
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new Error("YAML root must be a mapping. Clef keys are flat key/value pairs.");
  }

  const pairs: Record<string, string> = {};
  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      pairs[key] = value;
    } else if (value === null) {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is null, not string`);
    } else if (Array.isArray(value)) {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is array, not string`);
    } else if (typeof value === "object") {
      skipped.push(key);
      warnings.push(`${key}: skipped — value is nested object, not string`);
    } else {
      // number, boolean
      skipped.push(key);
      warnings.push(`${key}: skipped — value is ${typeof value}, not string`);
    }
  }

  return { pairs, format: "yaml", skipped, warnings };
}

/**
 * Parse content in the given format (or auto-detect) and return flat key/value pairs.
 *
 * @param content - Raw file content to parse.
 * @param format - Explicit format, or `"auto"` to detect from `filePath` and content.
 * @param filePath - File path used for format detection when `format` is `"auto"`.
 */
export function parse(content: string, format: ImportFormat, filePath?: string): ParsedImport {
  const resolved: Exclude<ImportFormat, "auto"> =
    format === "auto" ? detectFormat(filePath ?? "", content) : format;

  switch (resolved) {
    case "dotenv":
      return parseDotenv(content);
    case "json":
      return parseJson(content);
    case "yaml":
      return parseYaml(content);
  }
}
