import * as fs from "fs";
import * as path from "path";
import type { ScanMatch } from "./patterns";

export interface ClefIgnoreRules {
  files: string[];
  patterns: string[];
  paths: string[];
}

/**
 * Load .clefignore rules from the repo root.
 * Returns empty rules if the file does not exist.
 */
export function loadIgnoreRules(repoRoot: string): ClefIgnoreRules {
  const ignorePath = path.join(repoRoot, ".clefignore");
  try {
    const content = fs.readFileSync(ignorePath, "utf-8");
    return parseIgnoreContent(content);
  } catch {
    return { files: [], patterns: [], paths: [] };
  }
}

/**
 * Parse raw `.clefignore` content into structured rules.
 * Lines starting with `ignore-pattern:` suppress named patterns; lines ending with `/`
 * suppress entire directory paths; all other lines are treated as file glob patterns.
 *
 * @param content - Raw `.clefignore` file content.
 */
export function parseIgnoreContent(content: string): ClefIgnoreRules {
  const files: string[] = [];
  const patterns: string[] = [];
  const paths: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("ignore-pattern:")) {
      const patternName = line.slice("ignore-pattern:".length).trim();
      if (patternName) patterns.push(patternName);
    } else if (line.endsWith("/")) {
      paths.push(line.slice(0, -1));
    } else {
      files.push(line);
    }
  }

  return { files, patterns, paths };
}

/**
 * Returns true if a file path should be ignored per .clefignore rules.
 */
export function shouldIgnoreFile(filePath: string, rules: ClefIgnoreRules): boolean {
  const normalized = filePath.replace(/\\/g, "/");

  for (const p of rules.paths) {
    const dir = p.replace(/\\/g, "/");
    if (normalized === dir || normalized.startsWith(dir + "/")) return true;
  }

  for (const pattern of rules.files) {
    if (matchesGlob(normalized, pattern)) return true;
  }

  return false;
}

/**
 * Returns true if a scan match should be suppressed per .clefignore rules.
 */
export function shouldIgnoreMatch(match: ScanMatch, rules: ClefIgnoreRules): boolean {
  if (match.matchType === "pattern" && match.patternName) {
    return rules.patterns.includes(match.patternName);
  }
  return false;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex: support *, **, and ? wildcards.
  // Step 1: stash ** segments, Step 2: escape all regex metacharacters,
  // Step 3: restore wildcards as their regex equivalents.
  const DOUBLE_STAR = "\x00DS\x00";
  const SINGLE_STAR = "\x00SS\x00";
  const QUESTION = "\x00QM\x00";

  const escaped = pattern
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR)
    .replace(/\?/g, QUESTION)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(DOUBLE_STAR, ".*")
    .replace(SINGLE_STAR, "[^/]*")
    .replace(QUESTION, "[^/]");

  const regex = new RegExp("^" + escaped + "$");
  // Also match if the pattern matches a prefix directory
  const prefixRegex = new RegExp("^" + escaped + "/");
  return regex.test(filePath) || prefixRegex.test(filePath);
}
