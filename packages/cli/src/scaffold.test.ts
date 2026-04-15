import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  POLICY_PATH,
  ScaffoldError,
  currentVariant,
  detectProvider,
  loadTemplate,
  scaffoldPolicy,
} from "./scaffold";

// Use the REAL filesystem in these tests — the scaffold engine does
// straightforward directory creation + file writes + existsSync checks, and
// asserting against a real temp tree is far clearer than mocking fs node by
// node.  Template content is loaded from the real templates/ directory that
// ships in the package.
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clef-scaffold-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("detectProvider", () => {
  it("returns github when .github/ exists", () => {
    fs.mkdirSync(path.join(tmp, ".github"));
    expect(detectProvider(tmp)).toBe("github");
  });

  it("returns gitlab when .gitlab-ci.yml exists", () => {
    fs.writeFileSync(path.join(tmp, ".gitlab-ci.yml"), "");
    expect(detectProvider(tmp)).toBe("gitlab");
  });

  it("returns bitbucket when bitbucket-pipelines.yml exists", () => {
    fs.writeFileSync(path.join(tmp, "bitbucket-pipelines.yml"), "");
    expect(detectProvider(tmp)).toBe("bitbucket");
  });

  it("returns circleci when .circleci/config.yml exists", () => {
    fs.mkdirSync(path.join(tmp, ".circleci"));
    fs.writeFileSync(path.join(tmp, ".circleci/config.yml"), "");
    expect(detectProvider(tmp)).toBe("circleci");
  });

  it("prefers .github/ over git remote when both present", () => {
    fs.mkdirSync(path.join(tmp, ".github"));
    fs.mkdirSync(path.join(tmp, ".git"));
    fs.writeFileSync(
      path.join(tmp, ".git/config"),
      '[remote "origin"]\n\turl = git@gitlab.com:x/y.git',
    );
    expect(detectProvider(tmp)).toBe("github");
  });

  it("falls back to git remote URL when no config dir matches", () => {
    fs.mkdirSync(path.join(tmp, ".git"));
    fs.writeFileSync(
      path.join(tmp, ".git/config"),
      '[remote "origin"]\n\turl = git@gitlab.com:x/y.git',
    );
    expect(detectProvider(tmp)).toBe("gitlab");
  });

  it("detects bitbucket.org in git remote", () => {
    fs.mkdirSync(path.join(tmp, ".git"));
    fs.writeFileSync(
      path.join(tmp, ".git/config"),
      '[remote "origin"]\n\turl = https://bitbucket.org/x/y',
    );
    expect(detectProvider(tmp)).toBe("bitbucket");
  });

  it("defaults to github when nothing is detected", () => {
    expect(detectProvider(tmp)).toBe("github");
  });

  it("tolerates an unreadable git config", () => {
    fs.mkdirSync(path.join(tmp, ".git"));
    // Make the config look unreadable by writing a directory where a file
    // should be.  readFileSync will throw; detectProvider must fall through.
    fs.mkdirSync(path.join(tmp, ".git/config"));
    expect(detectProvider(tmp)).toBe("github");
  });
});

describe("scaffoldPolicy", () => {
  describe("default (both files)", () => {
    it("writes policy.yaml and the GitHub workflow by default", () => {
      const result = scaffoldPolicy({ repoRoot: tmp });
      expect(result.policy.status).toBe("created");
      expect(result.workflow.status).toBe("created");
      expect(result.provider).toBe("github");
      expect(result.policy.path).toBe(POLICY_PATH);
      expect(result.workflow.path).toBe(".github/workflows/clef-compliance.yml");

      expect(fs.existsSync(path.join(tmp, POLICY_PATH))).toBe(true);
      expect(fs.existsSync(path.join(tmp, ".github/workflows/clef-compliance.yml"))).toBe(true);
    });

    it("scaffolded policy contains the rotation block", () => {
      scaffoldPolicy({ repoRoot: tmp });
      const content = fs.readFileSync(path.join(tmp, POLICY_PATH), "utf-8");
      expect(content).toMatch(/version: 1/);
      expect(content).toMatch(/max_age_days: 90/);
      expect(content).toMatch(/# environments:/);
    });

    it("scaffolded github workflow invokes @clef-sh/cli (cli variant)", () => {
      scaffoldPolicy({ repoRoot: tmp });
      const content = fs.readFileSync(
        path.join(tmp, ".github/workflows/clef-compliance.yml"),
        "utf-8",
      );
      expect(content).toMatch(/npm install -g @clef-sh\/cli/);
      expect(content).toMatch(/clef policy check/);
      expect(content).toMatch(/clef policy report --output compliance\.json/);
    });
  });

  describe("provider variants", () => {
    it.each([
      ["gitlab", ".gitlab/clef-compliance.yml"],
      ["bitbucket", ".clef/workflows/bitbucket-pipelines.yml"],
      ["circleci", ".clef/workflows/circleci-config.yml"],
    ] as const)("scaffolds %s workflow to %s", (ci, expectedPath) => {
      const result = scaffoldPolicy({ repoRoot: tmp, ci });
      expect(result.provider).toBe(ci);
      expect(result.workflow.path).toBe(expectedPath);
      expect(fs.existsSync(path.join(tmp, expectedPath))).toBe(true);
    });

    it.each([
      ["gitlab", /include:/],
      ["bitbucket", /bitbucket-pipelines\.yml/],
      ["circleci", /\.circleci\/config\.yml/],
    ] as const)("surfaces a merge instruction for %s", (ci, pattern) => {
      // Use a fresh tmp per provider so scaffold doesn't see a prior run's
      // file and short-circuit to skipped_exists (which suppresses the hint).
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `clef-scaffold-${ci}-`));
      try {
        const result = scaffoldPolicy({ repoRoot: root, ci });
        expect(result.mergeInstruction).toMatch(pattern);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("does not surface a merge instruction for github", () => {
      const result = scaffoldPolicy({ repoRoot: tmp, ci: "github" });
      expect(result.mergeInstruction).toBeUndefined();
    });
  });

  describe("idempotency", () => {
    it("skips the policy file if it already exists", () => {
      fs.mkdirSync(path.join(tmp, ".clef"));
      fs.writeFileSync(path.join(tmp, POLICY_PATH), "# existing content\n");

      const result = scaffoldPolicy({ repoRoot: tmp });
      expect(result.policy.status).toBe("skipped_exists");
      expect(fs.readFileSync(path.join(tmp, POLICY_PATH), "utf-8")).toBe("# existing content\n");
    });

    it("skips the workflow file if it already exists", () => {
      fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".github/workflows/clef-compliance.yml"),
        "existing: workflow\n",
      );

      const result = scaffoldPolicy({ repoRoot: tmp });
      expect(result.workflow.status).toBe("skipped_exists");
      expect(
        fs.readFileSync(path.join(tmp, ".github/workflows/clef-compliance.yml"), "utf-8"),
      ).toBe("existing: workflow\n");
    });

    it("running twice in a row is a no-op on the second run", () => {
      scaffoldPolicy({ repoRoot: tmp });
      const result2 = scaffoldPolicy({ repoRoot: tmp });
      expect(result2.policy.status).toBe("skipped_exists");
      expect(result2.workflow.status).toBe("skipped_exists");
    });

    it("--force overwrites both files", () => {
      fs.mkdirSync(path.join(tmp, ".clef"));
      fs.writeFileSync(path.join(tmp, POLICY_PATH), "# stale\n");
      fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".github/workflows/clef-compliance.yml"),
        "stale: workflow\n",
      );

      const result = scaffoldPolicy({ repoRoot: tmp, force: true });
      expect(result.policy.status).toBe("created");
      expect(result.workflow.status).toBe("created");
      expect(fs.readFileSync(path.join(tmp, POLICY_PATH), "utf-8")).toMatch(/max_age_days/);
      expect(
        fs.readFileSync(path.join(tmp, ".github/workflows/clef-compliance.yml"), "utf-8"),
      ).toMatch(/clef policy check/);
    });
  });

  describe("selective scaffolding", () => {
    it("--policy-only skips the workflow", () => {
      const result = scaffoldPolicy({ repoRoot: tmp, policyOnly: true });
      expect(result.policy.status).toBe("created");
      expect(result.workflow.status).toBe("skipped_by_flag");
      expect(fs.existsSync(path.join(tmp, POLICY_PATH))).toBe(true);
      expect(fs.existsSync(path.join(tmp, ".github/workflows/clef-compliance.yml"))).toBe(false);
    });

    it("--workflow-only skips the policy", () => {
      const result = scaffoldPolicy({ repoRoot: tmp, workflowOnly: true });
      expect(result.policy.status).toBe("skipped_by_flag");
      expect(result.workflow.status).toBe("created");
      expect(fs.existsSync(path.join(tmp, POLICY_PATH))).toBe(false);
      expect(fs.existsSync(path.join(tmp, ".github/workflows/clef-compliance.yml"))).toBe(true);
    });

    it("respects --ci override even when a different provider is detected", () => {
      fs.mkdirSync(path.join(tmp, ".github")); // detection would pick github
      const result = scaffoldPolicy({ repoRoot: tmp, ci: "gitlab" });
      expect(result.provider).toBe("gitlab");
      expect(result.workflow.path).toBe(".gitlab/clef-compliance.yml");
    });
  });
});

describe("loadTemplate", () => {
  it("loads the policy.yaml template from disk", () => {
    const content = loadTemplate("policy.yaml");
    expect(content).toMatch(/version: 1/);
    expect(content).toMatch(/max_age_days: 90/);
  });

  it("loads a workflow template from disk", () => {
    const content = loadTemplate("workflows/github/cli.yml");
    expect(content).toMatch(/name: Clef Compliance/);
    expect(content).toMatch(/clef policy check/);
  });

  it("throws ScaffoldError for an unknown template path", () => {
    expect(() => loadTemplate("does-not-exist.yml")).toThrow(ScaffoldError);
  });
});

describe("currentVariant", () => {
  it("reports the current shipping variant per provider", () => {
    expect(currentVariant("github")).toBe("cli");
    expect(currentVariant("gitlab")).toBe("cli");
    expect(currentVariant("bitbucket")).toBe("cli");
    expect(currentVariant("circleci")).toBe("cli");
  });
});
