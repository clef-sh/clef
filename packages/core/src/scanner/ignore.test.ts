import * as fs from "fs";
import * as path from "path";
import { loadIgnoreRules, parseIgnoreContent, shouldIgnoreFile, shouldIgnoreMatch } from "./ignore";
import type { ScanMatch } from "./patterns";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

describe("parseIgnoreContent", () => {
  it("parses directory paths (lines ending with /)", () => {
    const rules = parseIgnoreContent("vendor/\n.terraform/\n");
    expect(rules.paths).toEqual(["vendor", ".terraform"]);
  });

  it("parses file patterns", () => {
    const rules = parseIgnoreContent("*.lock\npackage-lock.json\n");
    expect(rules.files).toContain("*.lock");
    expect(rules.files).toContain("package-lock.json");
  });

  it("parses ignore-pattern directives", () => {
    const rules = parseIgnoreContent("ignore-pattern: Private key header\n");
    expect(rules.patterns).toEqual(["Private key header"]);
  });

  it("ignores blank lines and comments", () => {
    const content = "# This is a comment\n\n# Another comment\nvendor/\n";
    const rules = parseIgnoreContent(content);
    expect(rules.paths).toEqual(["vendor"]);
    expect(rules.files).toHaveLength(0);
    expect(rules.patterns).toHaveLength(0);
  });
});

describe("loadIgnoreRules", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns empty rules when .clefignore does not exist", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const rules = loadIgnoreRules("/repo");
    expect(rules.files).toHaveLength(0);
    expect(rules.paths).toHaveLength(0);
    expect(rules.patterns).toHaveLength(0);
  });

  it("reads and parses .clefignore from repo root", () => {
    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (String(p) === path.join("/repo", ".clefignore")) {
        return "vendor/\n*.lock\n";
      }
      throw new Error("unexpected");
    });
    const rules = loadIgnoreRules("/repo");
    expect(rules.paths).toEqual(["vendor"]);
    expect(rules.files).toContain("*.lock");
  });
});

describe("shouldIgnoreFile", () => {
  const rules = {
    files: ["*.lock", "test/fixtures/*.yaml"],
    patterns: [],
    paths: ["vendor", ".terraform"],
  };

  it("ignores files in a matched directory path", () => {
    expect(shouldIgnoreFile("vendor/some/file.js", rules)).toBe(true);
  });

  it("ignores the directory itself", () => {
    expect(shouldIgnoreFile("vendor", rules)).toBe(true);
  });

  it("ignores files matching a glob pattern", () => {
    expect(shouldIgnoreFile("package-lock.json", rules)).toBe(false);
    expect(shouldIgnoreFile("yarn.lock", rules)).toBe(true);
  });

  it("does not ignore files outside excluded paths", () => {
    expect(shouldIgnoreFile("src/app.ts", rules)).toBe(false);
  });

  it("ignores files matching a glob with directory prefix", () => {
    expect(shouldIgnoreFile("test/fixtures/secret.yaml", rules)).toBe(true);
  });

  it("does not ignore files outside the fixture path", () => {
    expect(shouldIgnoreFile("test/other/secret.yaml", rules)).toBe(false);
  });
});

describe("shouldIgnoreMatch", () => {
  const rules = {
    files: [],
    patterns: ["Private key header", "AWS access key"],
    paths: [],
  };

  it("suppresses a pattern match whose name is in the rules", () => {
    const match: ScanMatch = {
      file: "f",
      line: 1,
      column: 1,
      matchType: "pattern",
      patternName: "Private key header",
      preview: "----••••••••",
    };
    expect(shouldIgnoreMatch(match, rules)).toBe(true);
  });

  it("does not suppress a pattern match not in the rules", () => {
    const match: ScanMatch = {
      file: "f",
      line: 1,
      column: 1,
      matchType: "pattern",
      patternName: "Stripe live key",
      preview: "sk_l••••••••",
    };
    expect(shouldIgnoreMatch(match, rules)).toBe(false);
  });

  it("does not suppress entropy matches (patterns only)", () => {
    const match: ScanMatch = {
      file: "f",
      line: 1,
      column: 1,
      matchType: "entropy",
      entropy: 5.1,
      preview: "DB_PASSWORD=••••••••",
    };
    expect(shouldIgnoreMatch(match, rules)).toBe(false);
  });
});
