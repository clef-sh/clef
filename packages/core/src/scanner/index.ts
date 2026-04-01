import * as fs from "fs";
import * as path from "path";
import type { ClefManifest, SubprocessRunner } from "../types";
import { matchPatterns, isHighEntropy, shannonEntropy, redactValue, ScanMatch } from "./patterns";
import { loadIgnoreRules, shouldIgnoreFile, shouldIgnoreMatch } from "./ignore";

export type { ScanMatch } from "./patterns";
export type { ClefIgnoreRules } from "./ignore";
export { shannonEntropy, isHighEntropy, matchPatterns, redactValue } from "./patterns";
export { loadIgnoreRules, shouldIgnoreFile, shouldIgnoreMatch, parseIgnoreContent } from "./ignore";

export interface ScanResult {
  matches: ScanMatch[];
  filesScanned: number;
  filesSkipped: number;
  unencryptedMatrixFiles: string[];
  durationMs: number;
}

export interface ScanOptions {
  stagedOnly?: boolean;
  paths?: string[];
  severity?: "all" | "high";
}

const ALWAYS_SKIP_EXTENSIONS = [".enc.yaml", ".enc.json"] as const;
const ALWAYS_SKIP_NAMES = [
  ".clef-meta.yaml",
  ".sops.yaml", // contains age public keys and KMS ARNs — configuration, not secrets
  "clef.yaml", // manifest — contains public keys and config, not secrets
] as const;
const ALWAYS_SKIP_DIRS = ["node_modules", ".git"] as const;
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

/**
 * Scans repository files for plaintext secrets using pattern matching and entropy detection.
 *
 * @example
 * ```ts
 * const scanner = new ScanRunner(runner);
 * const result = await scanner.scan(repoRoot, manifest, { stagedOnly: true });
 * ```
 */
export class ScanRunner {
  constructor(private readonly runner: SubprocessRunner) {}

  /**
   * Scan tracked (or staged) files for secret-like values and unencrypted matrix files.
   *
   * The scan respects `.clefignore` rules and inline `# clef-ignore` suppressions.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @param manifest - Parsed manifest used to identify matrix file paths.
   * @param options - Optional scan filters.
   */
  async scan(
    repoRoot: string,
    manifest: ClefManifest,
    options: ScanOptions = {},
  ): Promise<ScanResult> {
    const startMs = Date.now();
    const ignoreRules = loadIgnoreRules(repoRoot);
    const matches: ScanMatch[] = [];
    const unencryptedMatrixFiles: string[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;

    // ── Check 1: unencrypted matrix files ───────────────────────────────────
    for (const ns of manifest.namespaces) {
      for (const env of manifest.environments) {
        const relPath = manifest.file_pattern
          .replace("{namespace}", ns.name)
          .replace("{environment}", env.name);
        const absPath = path.join(repoRoot, relPath);
        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath, "utf-8");
          if (!content.includes("sops:") && !content.includes('"sops"')) {
            unencryptedMatrixFiles.push(relPath);
          }
        }
      }
    }

    // ── Determine files to scan ──────────────────────────────────────────────
    let filesToScan: string[];
    if (options.stagedOnly) {
      filesToScan = await this.getStagedFiles(repoRoot);
    } else if (options.paths && options.paths.length > 0) {
      filesToScan = await this.getFilesInPaths(repoRoot, options.paths);
    } else {
      filesToScan = await this.getAllTrackedFiles(repoRoot);
    }

    // ── Check 2: secret-looking values ──────────────────────────────────────
    for (const relFile of filesToScan) {
      const absFile = path.isAbsolute(relFile) ? relFile : path.join(repoRoot, relFile);
      const relPath = path.relative(repoRoot, absFile).replace(/\\/g, "/");

      if (this.shouldAlwaysSkip(relPath)) {
        filesSkipped++;
        continue;
      }

      if (shouldIgnoreFile(relPath, ignoreRules)) {
        filesSkipped++;
        continue;
      }

      if (!fs.existsSync(absFile)) {
        filesSkipped++;
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(absFile);
      } catch {
        filesSkipped++;
        continue;
      }

      if (stat.size > MAX_FILE_SIZE) {
        filesSkipped++;
        continue;
      }

      if (this.isBinary(absFile)) {
        filesSkipped++;
        continue;
      }

      filesScanned++;
      const content = fs.readFileSync(absFile, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Inline suppress: # clef-ignore on the same line
        if (line.includes("# clef-ignore")) continue;

        // Pattern matching
        const patternHits = matchPatterns(line, lineNum, relPath);
        for (const m of patternHits) {
          if (!shouldIgnoreMatch(m, ignoreRules)) {
            matches.push(m);
          }
        }

        // Entropy detection (skip when severity === 'high')
        if (options.severity !== "high") {
          const entropyHit = this.detectEntropy(line, lineNum, relPath);
          if (entropyHit && !shouldIgnoreMatch(entropyHit, ignoreRules)) {
            matches.push(entropyHit);
          }
        }
      }
    }

    return {
      matches,
      filesScanned,
      filesSkipped,
      unencryptedMatrixFiles,
      durationMs: Date.now() - startMs,
    };
  }

  private shouldAlwaysSkip(relPath: string): boolean {
    for (const dir of ALWAYS_SKIP_DIRS) {
      if (relPath === dir || relPath.startsWith(dir + "/")) return true;
    }
    for (const ext of ALWAYS_SKIP_EXTENSIONS) {
      if (relPath.endsWith(ext)) return true;
    }
    for (const name of ALWAYS_SKIP_NAMES) {
      if (relPath.endsWith(name)) return true;
    }
    return false;
  }

  private isBinary(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(512);
      const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private detectEntropy(line: string, lineNum: number, filePath: string): ScanMatch | null {
    // Look for values appearing after = or : (assignment positions)
    const valuePattern = /(?:=|:\s*)["']?([A-Za-z0-9+/=_-]{20,})["']?/;
    const match = valuePattern.exec(line);
    if (!match) return null;

    const value = match[1];
    const entropy = shannonEntropy(value);

    if (!isHighEntropy(value)) return null;

    // Extract variable name for the preview
    const varMatch = /(\w+)\s*(?:=|:)/.exec(line);
    const varName = varMatch ? varMatch[1] : "";
    const preview = varName
      ? `${varName}=\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022`
      : redactValue(value);

    return {
      file: filePath,
      line: lineNum,
      column: match.index + 1,
      matchType: "entropy",
      entropy,
      preview,
    };
  }

  private async getStagedFiles(repoRoot: string): Promise<string[]> {
    const result = await this.runner.run(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
      { cwd: repoRoot },
    );
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];
    return result.stdout.trim().split("\n");
  }

  private async getFilesInPaths(repoRoot: string, paths: string[]): Promise<string[]> {
    const files: string[] = [];
    for (const p of paths) {
      const absPath = path.isAbsolute(p) ? p : path.join(repoRoot, p);
      if (!fs.existsSync(absPath)) continue;
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        files.push(...this.walkDir(absPath, repoRoot));
      } else {
        files.push(path.relative(repoRoot, absPath).replace(/\\/g, "/"));
      }
    }
    return files;
  }

  private async getAllTrackedFiles(repoRoot: string): Promise<string[]> {
    // Use git ls-files to respect .gitignore automatically
    const result = await this.runner.run("git", ["ls-files"], { cwd: repoRoot });
    if (result.exitCode !== 0) {
      return this.walkDir(repoRoot, repoRoot);
    }
    return result.stdout.trim() ? result.stdout.trim().split("\n") : [];
  }

  private walkDir(dir: string, repoRoot: string): string[] {
    const files: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!(ALWAYS_SKIP_DIRS as readonly string[]).includes(entry.name)) {
          files.push(...this.walkDir(fullPath, repoRoot));
        }
      } else {
        files.push(relPath);
      }
    }
    return files;
  }
}
