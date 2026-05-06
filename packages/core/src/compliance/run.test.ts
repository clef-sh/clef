import * as fs from "fs";
import { SubprocessRunner } from "../types";
import { runCompliance } from "./run";
import { DEFAULT_POLICY } from "../policy/types";

jest.mock("fs");

// Auto-pass `assertSops` (binary presence check) — compliance flow doesn't
// actually need a real sops binary because all calls fall back to YAML
// parsing of the file when `sops filestatus` exit-codes 1.
jest.mock("../dependencies/checker", () => ({
  assertSops: jest.fn().mockResolvedValue(undefined),
}));

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

const REPO_ROOT = "/repo";

const MANIFEST_YAML = `
version: 1
environments:
  - name: dev
    description: Dev
  - name: production
    description: Prod
namespaces:
  - name: api
    description: API
sops:
  default_backend: age
file_pattern: "{namespace}/{environment}.enc.yaml"
`;

function encFile(lastModifiedISO: string): string {
  return [
    "data: ENC[AES256_GCM,data:abc=]",
    "sops:",
    "  age:",
    "    - recipient: age1abc",
    "      enc: |",
    "        -----BEGIN AGE ENCRYPTED FILE-----",
    "        x",
    "        -----END AGE ENCRYPTED FILE-----",
    `  lastmodified: "${lastModifiedISO}"`,
    "  version: 3.12.2",
    "",
  ].join("\n");
}

/**
 * Build a `.clef-meta.yaml` sidecar with rotation records for the given
 * keys.  Used by per-key compliance tests to simulate a cell where the
 * values have genuinely been recorded as rotated at the given time.
 */
function metaFile(rotations: Array<{ key: string; rotatedAtISO: string }>): string {
  const lines = [
    "# Managed by Clef. Do not edit manually.",
    "version: 1",
    "pending: []",
    "rotations:",
    ...rotations.flatMap((r) => [
      `  - key: ${r.key}`,
      `    last_rotated_at: "${r.rotatedAtISO}"`,
      `    rotated_by: "test"`,
      `    rotation_count: 1`,
    ]),
    "",
  ];
  return lines.join("\n");
}

interface RunnerSpec {
  /** stdout for `git rev-parse HEAD`. */
  gitSha?: string;
  /** stdout for `git remote get-url origin`. */
  gitRemoteUrl?: string;
  /** Force a non-zero exit on either git command. */
  gitFails?: boolean;
}

function makeRunner(spec: RunnerSpec = {}): SubprocessRunner {
  return {
    run: jest.fn(async (command: string, args: string[]) => {
      // git rev-parse HEAD
      if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
        if (spec.gitFails) return { stdout: "", stderr: "", exitCode: 128 };
        return { stdout: `${spec.gitSha ?? "deadbeef"}\n`, stderr: "", exitCode: 0 };
      }
      // git remote get-url origin
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
        if (spec.gitFails) return { stdout: "", stderr: "", exitCode: 128 };
        return {
          stdout: `${spec.gitRemoteUrl ?? "git@github.com:clef-sh/clef.git"}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      // sops filestatus → fail to force YAML fallback in parseMetadataFromFile
      if (command === "sops") {
        return { stdout: "", stderr: "not sops", exitCode: 1 };
      }
      // Anything else (git ls-files etc. used by ScanRunner) → empty success
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

interface FsLayout {
  manifest?: string; // override MANIFEST_YAML
  policy?: string; // contents of .clef/policy.yaml
  cells?: Record<string, string>; // relative path → file content
  // Files that should report as "exists" but aren't read (e.g. .clefignore)
  alsoExist?: string[];
}

function setupFs(layout: FsLayout = {}): void {
  const manifest = layout.manifest ?? MANIFEST_YAML;
  const policy = layout.policy;
  const cells = layout.cells ?? {};
  const alsoExist = new Set(layout.alsoExist ?? []);

  mockExistsSync.mockImplementation((p) => {
    const s = String(p);
    if (s === `${REPO_ROOT}/clef.yaml`) return true;
    if (s === `${REPO_ROOT}/.clef/policy.yaml`) return policy !== undefined;
    if (alsoExist.has(s)) return true;
    for (const cellPath of Object.keys(cells)) {
      if (s === `${REPO_ROOT}/${cellPath}`) return true;
    }
    return false;
  });

  mockReadFileSync.mockImplementation((p) => {
    const s = String(p);
    if (s === `${REPO_ROOT}/clef.yaml`) return manifest;
    if (s === `${REPO_ROOT}/.clef/policy.yaml`) return policy ?? "";
    for (const [cellPath, content] of Object.entries(cells)) {
      if (s === `${REPO_ROOT}/${cellPath}`) return content;
    }
    throw new Error(`ENOENT: ${s}`);
  });

  mockStatSync.mockImplementation(() => ({ size: 100, isDirectory: () => false }) as fs.Stats);
  mockWriteFileSync.mockImplementation(() => {});
}

const NOW = new Date("2026-04-14T00:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  // Strip CI-detection env vars so tests are hermetic.
  delete process.env.GITHUB_SHA;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.CI_COMMIT_SHA;
  delete process.env.CI_PROJECT_PATH;
  delete process.env.BITBUCKET_COMMIT;
  delete process.env.BITBUCKET_REPO_FULL_NAME;
  delete process.env.CIRCLE_SHA1;
  delete process.env.CIRCLE_PROJECT_USERNAME;
  delete process.env.CIRCLE_PROJECT_REPONAME;
  delete process.env.BUILD_VCS_NUMBER;
});

describe("runCompliance", () => {
  describe("happy path", () => {
    it("produces a passing document with no files", async () => {
      setupFs({
        cells: {}, // empty matrix on disk → all cells "missing" (lint errors)
      });
      const runner = makeRunner();
      const result = await runCompliance({
        runner,
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false }, // skip lint to keep "passed" true
      });
      expect(result.document.schema_version).toBe("1");
      expect(result.document.sha).toBe("abc");
      expect(result.document.repo).toBe("o/r");
      expect(result.document.summary.total_files).toBe(0);
      expect(result.passed).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("evaluates each existing cell against policy and marks compliant", async () => {
      setupFs({
        policy: "version: 1\nrotation:\n  max_age_days: 90\n",
        cells: {
          "api/dev.enc.yaml": encFile("2026-03-15T00:00:00Z"),
          "api/dev.clef-meta.yaml": metaFile([
            { key: "data", rotatedAtISO: "2026-03-15T00:00:00Z" },
          ]),
          "api/production.enc.yaml": encFile("2026-04-10T00:00:00Z"),
          "api/production.clef-meta.yaml": metaFile([
            { key: "data", rotatedAtISO: "2026-04-10T00:00:00Z" },
          ]),
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.summary.total_files).toBe(2);
      expect(result.document.summary.compliant).toBe(2);
      expect(result.document.summary.rotation_overdue).toBe(0);
      expect(result.passed).toBe(true);
    });

    it("flags overdue cells and marks the run failed (stale rotation record)", async () => {
      setupFs({
        policy: "version: 1\nrotation:\n  max_age_days: 30\n",
        cells: {
          "api/dev.enc.yaml": encFile("2026-04-10T00:00:00Z"),
          // Rotation record 103d old → past the 30d window → overdue.
          "api/dev.clef-meta.yaml": metaFile([
            { key: "data", rotatedAtISO: "2026-01-01T00:00:00Z" },
          ]),
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.summary.rotation_overdue).toBe(1);
      expect(result.document.files[0].compliant).toBe(false);
      expect(result.document.files[0].keys[0].rotation_overdue).toBe(true);
      expect(result.passed).toBe(false);
    });

    it("threads ageKey through to the sops subprocess env when provided", async () => {
      setupFs({
        cells: {
          "api/dev.enc.yaml": encFile("2026-04-10T00:00:00Z"),
        },
      });
      const runner = makeRunner();
      await runCompliance({
        runner,
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        ageKey: "AGE-SECRET-KEY-TEST",
        // Lint hits sops decrypt via source.readCell; rotation now reads
        // metadata from blob bytes (no subprocess), so we exercise lint to
        // observe the env wiring.
        include: { scan: false },
      });

      const sopsCallWithEnv = (runner.run as jest.Mock).mock.calls.find(
        ([cmd, _args, opts]: [string, string[], { env?: Record<string, string> }]) =>
          cmd === "sops" && opts?.env?.SOPS_AGE_KEY === "AGE-SECRET-KEY-TEST",
      );
      expect(sopsCallWithEnv).toBeDefined();
    });

    it("threads ageKeyFile through to the sops subprocess env when provided", async () => {
      setupFs({
        cells: {
          "api/dev.enc.yaml": encFile("2026-04-10T00:00:00Z"),
        },
      });
      const runner = makeRunner();
      await runCompliance({
        runner,
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        ageKeyFile: "/tmp/age-key.txt",
        include: { scan: false },
      });

      const sopsCallWithEnv = (runner.run as jest.Mock).mock.calls.find(
        ([cmd, _args, opts]: [string, string[], { env?: Record<string, string> }]) =>
          cmd === "sops" && opts?.env?.SOPS_AGE_KEY_FILE === "/tmp/age-key.txt",
      );
      expect(sopsCallWithEnv).toBeDefined();
    });

    it("treats a cell with a key but no rotation record as a violation (unknown)", async () => {
      // The central design rule: unknown rotation state = violation.
      setupFs({
        policy: "version: 1\nrotation:\n  max_age_days: 90\n",
        cells: {
          "api/dev.enc.yaml": encFile("2026-04-10T00:00:00Z"),
          // No .clef-meta.yaml — the `data` key has no rotation record.
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.summary.rotation_overdue).toBe(1);
      expect(result.document.files[0].compliant).toBe(false);
      expect(result.document.files[0].keys[0].last_rotated_known).toBe(false);
      expect(result.document.files[0].keys[0].compliant).toBe(false);
      expect(result.passed).toBe(false);
    });
  });

  describe("policy resolution", () => {
    it("uses DEFAULT_POLICY when .clef/policy.yaml is missing", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.policy_snapshot).toBe(DEFAULT_POLICY);
    });

    it("loads .clef/policy.yaml when it exists", async () => {
      setupFs({
        policy: "version: 1\nrotation:\n  max_age_days: 45\n",
        cells: {},
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.policy_snapshot).toEqual({
        version: 1,
        rotation: { max_age_days: 45 },
      });
    });

    it("a pre-resolved policy wins over policyPath", async () => {
      setupFs({
        policy: "version: 1\nrotation:\n  max_age_days: 9999\n",
        cells: {},
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        policy: { version: 1, rotation: { max_age_days: 7 } },
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.policy_snapshot.rotation?.max_age_days).toBe(7);
    });

    it("respects a custom policyPath override", async () => {
      mockExistsSync.mockImplementation(
        (p) => String(p) === `${REPO_ROOT}/clef.yaml` || String(p) === "/etc/policy.yaml",
      );
      mockReadFileSync.mockImplementation((p) => {
        if (String(p) === `${REPO_ROOT}/clef.yaml`) return MANIFEST_YAML;
        if (String(p) === "/etc/policy.yaml") return "version: 1\nrotation:\n  max_age_days: 1\n";
        throw new Error(`ENOENT: ${String(p)}`);
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        policyPath: "/etc/policy.yaml",
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.policy_snapshot.rotation?.max_age_days).toBe(1);
    });
  });

  describe("filtering", () => {
    it("includes only the requested namespaces", async () => {
      setupFs({
        manifest: MANIFEST_YAML.replace(
          "namespaces:\n  - name: api\n    description: API",
          "namespaces:\n  - name: api\n    description: API\n  - name: billing\n    description: Billing",
        ),
        cells: {
          "api/dev.enc.yaml": encFile("2026-03-15T00:00:00Z"),
          "billing/dev.enc.yaml": encFile("2026-03-15T00:00:00Z"),
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        filter: { namespaces: ["billing"] },
        include: { lint: false, scan: false },
      });
      expect(result.document.files.map((f) => f.path)).toEqual(["billing/dev.enc.yaml"]);
    });

    it("includes only the requested environments", async () => {
      setupFs({
        cells: {
          "api/dev.enc.yaml": encFile("2026-03-15T00:00:00Z"),
          "api/production.enc.yaml": encFile("2026-03-15T00:00:00Z"),
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        filter: { environments: ["production"] },
        include: { lint: false, scan: false },
      });
      expect(result.document.files.map((f) => f.environment)).toEqual(["production"]);
    });

    it("treats empty filter arrays as 'no filter'", async () => {
      setupFs({
        cells: {
          "api/dev.enc.yaml": encFile("2026-03-15T00:00:00Z"),
          "api/production.enc.yaml": encFile("2026-03-15T00:00:00Z"),
        },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        filter: { namespaces: [], environments: [] },
        include: { lint: false, scan: false },
      });
      expect(result.document.files).toHaveLength(2);
    });
  });

  describe("include toggles", () => {
    it("skips rotation evaluation when include.rotation is false", async () => {
      setupFs({
        cells: { "api/dev.enc.yaml": encFile("2020-01-01T00:00:00Z") }, // ancient
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { rotation: false, scan: false, lint: false },
      });
      expect(result.document.files).toEqual([]);
      expect(result.document.summary.rotation_overdue).toBe(0);
      expect(result.passed).toBe(true);
    });

    it("skips scan when include.scan is false", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { scan: false, lint: false },
      });
      expect(result.document.scan.matches).toEqual([]);
      expect(result.document.scan.filesScanned).toBe(0);
    });

    it("skips lint when include.lint is false", async () => {
      setupFs({ cells: {} }); // matrix is missing — would normally produce lint errors
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.lint.issues).toEqual([]);
      expect(result.passed).toBe(true);
    });

    it("counts lint errors toward `passed`", async () => {
      setupFs({ cells: {} }); // missing matrix → lint errors
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
      });
      expect(result.document.summary.lint_errors).toBeGreaterThan(0);
      expect(result.passed).toBe(false);
    });

    it("downgrades 'Failed to decrypt' lint errors to info (compliance runs without keys)", async () => {
      // Cells exist with valid SOPS metadata, but the mock sops binary can't
      // decrypt — mirrors CI compliance runs that don't have age keys.
      setupFs({
        cells: {
          "api/dev.enc.yaml": encFile("2026-04-10T00:00:00Z"),
          "api/production.enc.yaml": encFile("2026-04-10T00:00:00Z"),
        },
      });

      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { rotation: false, scan: false, lint: true },
      });

      const sopsIssues = result.document.lint.issues.filter((i) => i.category === "sops");
      expect(sopsIssues.length).toBeGreaterThan(0);
      expect(sopsIssues.every((i) => i.severity === "info")).toBe(true);
      expect(
        sopsIssues.every((i) => i.message.includes("not decryptable in this environment")),
      ).toBe(true);
      expect(result.document.summary.lint_errors).toBe(0);
      expect(result.passed).toBe(true);
    });
  });

  describe("git context detection", () => {
    it("uses GITHUB_SHA / GITHUB_REPOSITORY when set", async () => {
      setupFs({ cells: {} });
      process.env.GITHUB_SHA = "ghshasha";
      process.env.GITHUB_REPOSITORY = "owner/gh-repo";
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("ghshasha");
      expect(result.document.repo).toBe("owner/gh-repo");
    });

    it("uses CI_COMMIT_SHA / CI_PROJECT_PATH (GitLab) when set", async () => {
      setupFs({ cells: {} });
      process.env.CI_COMMIT_SHA = "glsha";
      process.env.CI_PROJECT_PATH = "group/glrepo";
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("glsha");
      expect(result.document.repo).toBe("group/glrepo");
    });

    it("uses BITBUCKET / CircleCI env when set", async () => {
      setupFs({ cells: {} });
      process.env.BITBUCKET_COMMIT = "bbsha";
      process.env.BITBUCKET_REPO_FULL_NAME = "team/bbrepo";
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("bbsha");
      expect(result.document.repo).toBe("team/bbrepo");

      delete process.env.BITBUCKET_COMMIT;
      delete process.env.BITBUCKET_REPO_FULL_NAME;
      process.env.CIRCLE_SHA1 = "circlesha";
      process.env.CIRCLE_PROJECT_USERNAME = "circleorg";
      process.env.CIRCLE_PROJECT_REPONAME = "circlerepo";
      const result2 = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result2.document.sha).toBe("circlesha");
      expect(result2.document.repo).toBe("circleorg/circlerepo");
    });

    it("uses BUILD_VCS_NUMBER as a final SHA fallback (TeamCity et al.)", async () => {
      setupFs({ cells: {} });
      process.env.BUILD_VCS_NUMBER = "tcsha";
      const result = await runCompliance({
        runner: makeRunner({ gitFails: true }),
        repoRoot: REPO_ROOT,
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("tcsha");
    });

    it("falls back to git rev-parse / git remote when no env is set", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({
          gitSha: "localhead",
          gitRemoteUrl: "git@github.com:owner/repo.git",
        }),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("localhead");
      expect(result.document.repo).toBe("owner/repo");
    });

    it("parses HTTPS git remotes too", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({
          gitSha: "x",
          gitRemoteUrl: "https://github.com/owner/repo.git",
        }),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.repo).toBe("owner/repo");
    });

    it("parses HTTPS git remotes without .git suffix", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({
          gitSha: "x",
          gitRemoteUrl: "https://github.com/owner/repo",
        }),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.repo).toBe("owner/repo");
    });

    it("returns 'unknown' when both env and git fail", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({ gitFails: true }),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("unknown");
      expect(result.document.repo).toBe("unknown");
    });

    it("returns 'unknown' for a git remote that does not match any pattern", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({ gitSha: "x", gitRemoteUrl: "weirdscheme://no-slashes" }),
        repoRoot: REPO_ROOT,
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.repo).toBe("unknown");
    });

    it("returns 'unknown' SHA when git rev-parse stdout is empty", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner({ gitSha: "" }),
        repoRoot: REPO_ROOT,
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.sha).toBe("unknown");
    });
  });

  describe("defaults", () => {
    it("defaults manifestPath to <repoRoot>/clef.yaml", async () => {
      setupFs({ cells: {} });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      // Just confirms no throw — the manifest was found at the default path.
      expect(result.document.schema_version).toBe("1");
    });

    it("defaults `now` to current time when omitted", async () => {
      setupFs({ cells: {} });
      const before = Date.now();
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        include: { lint: false, scan: false },
      });
      const stamped = new Date(result.document.generated_at).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });

    it("defaults repoRoot to process.cwd() when omitted", async () => {
      // Real cwd happens to not have a clef.yaml — surface the throw, then
      // patch fs to make it appear there.
      const cwd = process.cwd();
      mockExistsSync.mockImplementation((p) => String(p) === `${cwd}/clef.yaml`);
      mockReadFileSync.mockImplementation((p) => {
        if (String(p) === `${cwd}/clef.yaml`) return MANIFEST_YAML;
        throw new Error(`ENOENT: ${String(p)}`);
      });
      const result = await runCompliance({
        runner: makeRunner(),
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false, rotation: false },
      });
      expect(result.document.schema_version).toBe("1");
    });
  });

  describe("path stability", () => {
    it("emits repo-relative file paths in FileRotationStatus", async () => {
      setupFs({
        cells: { "api/dev.enc.yaml": encFile("2026-03-15T00:00:00Z") },
      });
      const result = await runCompliance({
        runner: makeRunner(),
        repoRoot: REPO_ROOT,
        sha: "abc",
        repo: "o/r",
        now: NOW,
        include: { lint: false, scan: false },
      });
      expect(result.document.files[0].path).toBe("api/dev.enc.yaml");
      expect(result.document.files[0].path).not.toContain("/repo/"); // no absolute leak
    });
  });
});
