import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys);
  } catch (err) {
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

const gitEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
};

describe("clef report", () => {
  it("should generate a valid JSON report at HEAD", () => {
    const result = spawnSync("node", [clefBin, "report", "--json"], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.repoIdentity).toBeDefined();
    expect(report.repoIdentity.commitSha).toBeTruthy();
    expect(report.matrix).toBeInstanceOf(Array);
    expect(report.matrix.length).toBeGreaterThan(0);
    expect(report.policy).toBeDefined();
    expect(report.recipients).toBeDefined();
  });

  it("should include matrix cells for all namespace × environment pairs", () => {
    const result = spawnSync("node", [clefBin, "report", "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    const report = JSON.parse(result.stdout);
    const cells = report.matrix as { namespace: string; environment: string; exists: boolean }[];
    expect(cells.some((c) => c.namespace === "payments" && c.environment === "dev")).toBe(true);
    expect(cells.some((c) => c.namespace === "payments" && c.environment === "production")).toBe(
      true,
    );
  });

  it("should exit 0 when no policy errors", () => {
    const result = spawnSync("node", [clefBin, "report", "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  it("should filter by --namespace", () => {
    const result = spawnSync("node", [clefBin, "report", "--json", "--namespace", "payments"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.matrix.every((c: { namespace: string }) => c.namespace === "payments")).toBe(
      true,
    );
  });
});

describe("clef report --at", () => {
  it("should generate a report at a specific commit SHA", () => {
    // Get HEAD SHA
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();

    const result = spawnSync("node", [clefBin, "report", "--at", headSha, "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.matrix).toBeInstanceOf(Array);
  });

  it("should generate a report at HEAD~0 (same as HEAD)", () => {
    const result = spawnSync("node", [clefBin, "report", "--at", "HEAD", "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
  });
});

describe("clef report --since", () => {
  let firstCommitSha: string;

  beforeAll(() => {
    // Get the initial commit SHA before creating additional commits
    firstCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();

    // Create a second commit by modifying the manifest (touch a file, re-commit)
    const readmePath = path.join(repo.dir, "README.md");
    fs.writeFileSync(readmePath, "# Test repo\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "docs: add readme"], {
      cwd: repo.dir,
      stdio: "pipe",
      env: { ...process.env, ...gitEnv },
    });

    // Create a third commit
    fs.writeFileSync(readmePath, "# Test repo\nUpdated.\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "docs: update readme"], {
      cwd: repo.dir,
      stdio: "pipe",
      env: { ...process.env, ...gitEnv },
    });
  });

  it("should generate reports for all commits since a given SHA", () => {
    const result = spawnSync("node", [clefBin, "report", "--since", firstCommitSha, "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.status).toBe(0);
    const reports = JSON.parse(result.stdout);
    expect(Array.isArray(reports)).toBe(true);
    // Should have 2 reports (the 2 commits after firstCommitSha)
    expect(reports.length).toBe(2);
    // Each should be a valid ClefReport
    for (const report of reports) {
      expect(report.schemaVersion).toBe(1);
      expect(report.repoIdentity).toBeDefined();
      expect(report.matrix).toBeInstanceOf(Array);
    }
  });

  it("should produce reports with distinct commit SHAs", () => {
    const result = spawnSync("node", [clefBin, "report", "--since", firstCommitSha, "--json"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
      timeout: 60_000,
    });

    const reports = JSON.parse(result.stdout);
    const shas = reports.map(
      (r: { repoIdentity: { commitSha: string } }) => r.repoIdentity.commitSha,
    );
    const uniqueShas = new Set(shas);
    expect(uniqueShas.size).toBe(shas.length);
  });
});

describe("clef report --push", () => {
  it("should error when no API token is provided", () => {
    const result = spawnSync("node", [clefBin, "report", "--push"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("API token");
  });

  it("should error when cloud.integrationId is missing from manifest", () => {
    const result = spawnSync("node", [clefBin, "report", "--push", "--api-token", "tok_test"], {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("integrationId");
  });
});
