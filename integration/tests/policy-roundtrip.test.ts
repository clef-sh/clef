import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { AgeKeyPair, checkSopsAvailable, generateAgeKey } from "../setup/keys";
import { TestRepo, scaffoldTestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys);
  } catch (err) {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
    repo?.cleanup();
    throw err;
  }
});

afterAll(() => {
  try {
    repo?.cleanup();
  } finally {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

interface ClefResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function clef(args: string[], opts: { allowFailure?: boolean } = {}): ClefResult {
  try {
    const stdout = execFileSync("node", [clefBin, ...args], {
      cwd: repo.dir,
      input: "",
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    if (!opts.allowFailure) throw err;
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

/**
 * Reset scaffold artifacts before each test so order doesn't matter.  The
 * underlying matrix (`payments/dev.enc.yaml`, `payments/production.enc.yaml`)
 * is left intact — those are the inputs every test reads against.
 */
function resetScaffoldState(): void {
  for (const dir of [".clef", ".github", ".gitlab", ".circleci"]) {
    fs.rmSync(path.join(repo.dir, dir), { recursive: true, force: true });
  }
  fs.rmSync(path.join(repo.dir, "compliance.json"), { force: true });
}

beforeEach(() => {
  resetScaffoldState();
});

describe("clef policy init (real filesystem)", () => {
  it("scaffolds .clef/policy.yaml and the github workflow", () => {
    clef(["policy", "init"]);
    expect(fs.existsSync(path.join(repo.dir, ".clef/policy.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(repo.dir, ".github/workflows/clef-compliance.yml"))).toBe(true);
  });

  it("scaffolded policy parses as the bundled template", () => {
    clef(["policy", "init"]);
    const parsed = YAML.parse(fs.readFileSync(path.join(repo.dir, ".clef/policy.yaml"), "utf-8"));
    expect(parsed).toEqual({
      version: 1,
      rotation: { max_age_days: 90 },
    });
  });

  it("scaffolded github workflow has valid YAML and the right shape", () => {
    clef(["policy", "init"]);
    const parsed = YAML.parse(
      fs.readFileSync(path.join(repo.dir, ".github/workflows/clef-compliance.yml"), "utf-8"),
    );
    expect(parsed.name).toBe("Clef Compliance");
    expect(parsed.on.pull_request).toBeDefined();
    expect(parsed.on.push.branches).toEqual(["main"]);
    const stepCommands = (parsed.jobs.compliance.steps as Array<{ run?: string }>)
      .map((s) => s.run ?? "")
      .join("\n");
    expect(stepCommands).toMatch(/npm install -g @clef-sh\/cli/);
    expect(stepCommands).toMatch(/clef policy check/);
    expect(stepCommands).toMatch(/clef policy report --output compliance\.json/);
  });

  it("--ci gitlab writes the gitlab template and prints the include hint", () => {
    const result = clef(["policy", "init", "--ci", "gitlab"]);
    expect(fs.existsSync(path.join(repo.dir, ".gitlab/clef-compliance.yml"))).toBe(true);
    expect(result.stdout).toMatch(/include:.*gitlab-ci\.yml/);
  });

  it("--ci circleci writes to .clef/workflows/circleci-config.yml", () => {
    clef(["policy", "init", "--ci", "circleci"]);
    expect(fs.existsSync(path.join(repo.dir, ".clef/workflows/circleci-config.yml"))).toBe(true);
  });

  it("--ci bitbucket writes to .clef/workflows/bitbucket-pipelines.yml", () => {
    clef(["policy", "init", "--ci", "bitbucket"]);
    expect(fs.existsSync(path.join(repo.dir, ".clef/workflows/bitbucket-pipelines.yml"))).toBe(
      true,
    );
  });

  it("idempotent — second run does not clobber existing files", () => {
    clef(["policy", "init"]);
    fs.writeFileSync(path.join(repo.dir, ".clef/policy.yaml"), "# user-edited\nversion: 1\n");
    clef(["policy", "init"]);
    const content = fs.readFileSync(path.join(repo.dir, ".clef/policy.yaml"), "utf-8");
    expect(content).toMatch(/user-edited/);
  });

  it("--force overwrites an existing policy file", () => {
    clef(["policy", "init"]);
    fs.writeFileSync(path.join(repo.dir, ".clef/policy.yaml"), "# stale\nversion: 1\n");
    clef(["policy", "init", "--force"]);
    const content = fs.readFileSync(path.join(repo.dir, ".clef/policy.yaml"), "utf-8");
    expect(content).not.toMatch(/stale/);
    expect(content).toMatch(/max_age_days: 90/);
  });

  it("--policy-only skips the workflow file", () => {
    clef(["policy", "init", "--policy-only"]);
    expect(fs.existsSync(path.join(repo.dir, ".clef/policy.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(repo.dir, ".github/workflows/clef-compliance.yml"))).toBe(false);
  });

  it("--workflow-only skips the policy file", () => {
    clef(["policy", "init", "--workflow-only"]);
    expect(fs.existsSync(path.join(repo.dir, ".clef/policy.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(repo.dir, ".github/workflows/clef-compliance.yml"))).toBe(true);
  });

  it("--ci with an unknown provider exits 2", () => {
    const result = clef(["policy", "init", "--ci", "jenkins"], { allowFailure: true });
    expect(result.exitCode).toBe(2);
    expect(fs.existsSync(path.join(repo.dir, ".clef/policy.yaml"))).toBe(false);
  });
});

describe("clef policy show (real filesystem)", () => {
  it("prints the resolved policy as YAML", () => {
    clef(["policy", "init"]);
    const result = clef(["policy", "show"]);
    expect(result.stdout).toMatch(/version: 1/);
    expect(result.stdout).toMatch(/max_age_days: 90/);
  });

  it("prints DEFAULT_POLICY when no .clef/policy.yaml exists", () => {
    const result = clef(["policy", "show"]);
    expect(result.stdout).toMatch(/Using built-in default/);
    expect(result.stdout).toMatch(/version: 1/);
  });

  it("--json emits a parseable JSON document", () => {
    clef(["policy", "init"]);
    const result = clef(["--json", "policy", "show"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({ version: 1, rotation: { max_age_days: 90 } });
  });
});

describe("clef policy check (real SOPS metadata)", () => {
  it("exits 0 when files are within max_age_days", () => {
    clef(["policy", "init"]); // 90-day default; freshly-created files compliant
    const result = clef(["policy", "check"], { allowFailure: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/compliant/);
  });

  it("exits 1 when files are past max_age_days", () => {
    fs.mkdirSync(path.join(repo.dir, ".clef"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, ".clef/policy.yaml"),
      // 0.000001 days ≈ 86µs.  Any real SOPS file is older than that, so
      // every cell in the matrix lands as overdue.  Parser accepts any
      // positive finite number; rejecting `0` exactly is intentional.
      "version: 1\nrotation:\n  max_age_days: 0.000001\n",
    );
    const result = clef(["policy", "check"], { allowFailure: true });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/overdue/);
  });

  it("--json emits structured per-file verdicts", () => {
    clef(["policy", "init"]);
    const result = clef(["--json", "policy", "check"], { allowFailure: true });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.summary).toMatchObject({
      total_files: 2,
      compliant: 2,
      rotation_overdue: 0,
    });
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0]).toMatchObject({
      backend: "age",
      compliant: true,
      last_modified_known: true,
    });
  });

  it("respects --namespace and --environment filters", () => {
    clef(["policy", "init"]);
    const result = clef(
      ["--json", "policy", "check", "--namespace", "payments", "--environment", "production"],
      { allowFailure: true },
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.files.map((f: { environment: string }) => f.environment)).toEqual(["production"]);
  });

  it("exits with a non-zero code when policy YAML is invalid", () => {
    fs.mkdirSync(path.join(repo.dir, ".clef"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, ".clef/policy.yaml"),
      "version: 99\nrotation:\n  max_age_days: 30\n",
    );
    const result = clef(["policy", "check"], { allowFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/version: 1|version 1/i);
  });

  it("exits non-zero on negative max_age_days", () => {
    fs.mkdirSync(path.join(repo.dir, ".clef"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, ".clef/policy.yaml"),
      "version: 1\nrotation:\n  max_age_days: -1\n",
    );
    const result = clef(["policy", "check"], { allowFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/positive number/i);
  });
});

describe("clef policy report (full ComplianceDocument)", () => {
  it("writes a parseable compliance.json with the locked schema", () => {
    clef(["policy", "init"]);
    const outPath = path.join(repo.dir, "compliance.json");
    clef([
      "policy",
      "report",
      "--output",
      outPath,
      "--sha",
      "abcdef123",
      "--repo",
      "owner/test-repo",
    ]);
    const doc = JSON.parse(fs.readFileSync(outPath, "utf-8"));

    // Locked top-level fields — bot, dashboard, and audit tooling depend
    // on these names.  Renaming any breaks downstream consumers.
    expect(doc.schema_version).toBe("1");
    expect(doc.sha).toBe("abcdef123");
    expect(doc.repo).toBe("owner/test-repo");
    expect(doc.policy_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(doc.policy_snapshot).toEqual({ version: 1, rotation: { max_age_days: 90 } });
    expect(doc.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Summary counts must reflect the scaffolded matrix (2 compliant files,
    // 0 overdue, 0 scan/lint violations).
    expect(doc.summary).toMatchObject({
      total_files: 2,
      compliant: 2,
      rotation_overdue: 0,
      scan_violations: 0,
      lint_errors: 0,
    });

    // Each file entry must carry the queryable fields the bot indexes.
    expect(doc.files).toHaveLength(2);
    for (const f of doc.files) {
      expect(f).toMatchObject({
        backend: "age",
        recipients: expect.any(Array),
        last_modified_known: true,
        compliant: true,
        rotation_overdue: false,
      });
      expect(f.path).toMatch(/^payments\/(dev|production)\.enc\.yaml$/);
      expect(f.last_modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(f.rotation_due).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    // Document must round-trip through JSON unchanged (no Date / undefined
    // ghosts that would corrupt artifact storage).
    const reserialized = JSON.parse(JSON.stringify(doc));
    expect(reserialized).toEqual(doc);
  });

  it("policy_hash is reproducible across separate runs", () => {
    clef(["policy", "init"]);
    const outA = path.join(repo.dir, "out-a.json");
    const outB = path.join(repo.dir, "out-b.json");
    clef(["policy", "report", "--output", outA, "--sha", "x", "--repo", "o/r"]);
    clef(["policy", "report", "--output", outB, "--sha", "x", "--repo", "o/r"]);
    const a = JSON.parse(fs.readFileSync(outA, "utf-8"));
    const b = JSON.parse(fs.readFileSync(outB, "utf-8"));
    expect(a.policy_hash).toBe(b.policy_hash);
  });

  it("flags overdue rotation in the summary when policy is tightened", () => {
    fs.mkdirSync(path.join(repo.dir, ".clef"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, ".clef/policy.yaml"),
      // 0.000001 days ≈ 86µs.  Any real SOPS file is older than that, so
      // every cell in the matrix lands as overdue.  Parser accepts any
      // positive finite number; rejecting `0` exactly is intentional.
      "version: 1\nrotation:\n  max_age_days: 0.000001\n",
    );
    const outPath = path.join(repo.dir, "compliance.json");
    clef(["policy", "report", "--output", outPath, "--sha", "x", "--repo", "o/r"]);
    const doc = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    expect(doc.summary.rotation_overdue).toBe(2);
    expect(doc.summary.compliant).toBe(0);
  });

  it("--no-scan / --no-lint produce a smaller artifact without those checks", () => {
    clef(["policy", "init"]);
    const outPath = path.join(repo.dir, "compliance.json");
    clef([
      "policy",
      "report",
      "--output",
      outPath,
      "--sha",
      "x",
      "--repo",
      "o/r",
      "--no-scan",
      "--no-lint",
    ]);
    const doc = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    expect(doc.scan.matches).toEqual([]);
    expect(doc.lint.issues).toEqual([]);
    expect(doc.summary.scan_violations).toBe(0);
    expect(doc.summary.lint_errors).toBe(0);
  });

  it("emits JSON to stdout when --output is omitted", () => {
    clef(["policy", "init"]);
    const result = clef(["policy", "report", "--sha", "x", "--repo", "o/r"]);
    const doc = JSON.parse(result.stdout);
    expect(doc.schema_version).toBe("1");
    expect(doc.summary.total_files).toBe(2);
  });
});
