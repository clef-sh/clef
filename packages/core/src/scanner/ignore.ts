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
  const body = globToRegex(pattern);
  // Exact match — pattern matches the full path.
  const exact = new RegExp("^" + body + "$");
  // Also match if the pattern matches a directory prefix, so a file pattern
  // like `node_modules` (no trailing slash) also catches files inside it.
  const prefix = new RegExp("^" + body + "/");
  return exact.test(filePath) || prefix.test(filePath);
}

/**
 * Convert a glob pattern (gitignore-style) to a regex body.
 *
 * Globstar semantics — `**` denotes zero-or-more path segments. The four
 * positions where `**` can appear each get distinct treatment:
 *
 *   `**\/foo`   — leading: zero-or-more segments, including zero. So
 *                 `**\/package.json` must match `package.json` at the root
 *                 just as it matches `apps/web/package.json`.
 *   `foo/**\/bar` — interior: zero-or-more segments between, so `src/**\/x`
 *                 matches `src/x` (zero segments) and `src/a/b/x`.
 *   `foo/**`    — trailing: matches the directory itself plus everything
 *                 inside it.
 *   bare `**`   — matches anything across separators (rare in real configs).
 *
 * Single `*` matches anything except `/`. `?` matches one non-slash char.
 * Regex metacharacters in literal segments are escaped.
 */
function globToRegex(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    // /**/ — interior globstar: zero-or-more segments between two literals.
    if (pattern.startsWith("/**/", i)) {
      out += "/(?:.*/)?";
      i += 4;
      continue;
    }
    // **/ at the very start — leading globstar: zero-or-more segments at root.
    if (i === 0 && pattern.startsWith("**/")) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    // /** at the very end — trailing globstar: the dir itself + everything inside.
    if (pattern.startsWith("/**", i) && i + 3 === pattern.length) {
      out += "(?:/.*)?";
      i += 3;
      continue;
    }
    // bare ** elsewhere — degenerate but treated as "anything across slashes".
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    const ch = pattern[i];
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}
