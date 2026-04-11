/**
 * Phase 0.6e: end-to-end verification that mutation commands run inside a
 * TransactionManager — every command produces exactly one git commit on the
 * happy path, the lock refuses concurrent writers, and preflight refuses
 * dirty trees / mid-rebase repos cleanly without leaving any trace.
 *
 * These tests run the BUILT clef binary as a subprocess against a real
 * temp git repo with a real sops binary. They are intentionally tight —
 * one or two cases per concern, not exhaustive coverage. Per-method
 * behavior is already covered by the unit tests in packages/core; this
 * file proves the whole stack survives contact with real git.
 */
import { execFileSync, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

let keys: AgeKeyPair;

beforeAll(async () => {
  checkSopsAvailable();
  keys = await generateAgeKey();
});

afterAll(() => {
  if (keys?.tmpDir) fs.rmSync(keys.tmpDir, { recursive: true, force: true });
});

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

/**
 * Run the built clef binary against `repo` with deterministic git author
 * identity and the test age key on PATH. Returns combined stdout/stderr
 * and exit code so callers can assert against failures without try/catch.
 */
function clef(
  repo: TestRepo,
  args: string[],
  opts: { input?: string; extraEnv?: Record<string, string> } = {},
): CommandResult {
  const result = spawnSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    input: opts.input ?? "",
    env: {
      ...process.env,
      SOPS_AGE_KEY_FILE: keys.keyFilePath,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
      ...(opts.extraEnv ?? {}),
    },
    encoding: "utf-8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

/** Read the current HEAD SHA. */
function head(repo: TestRepo): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo.dir,
    encoding: "utf-8",
  }).trim();
}

/** Read the most recent commit's subject line. */
function lastCommitSubject(repo: TestRepo): string {
  return execFileSync("git", ["log", "-1", "--pretty=%s"], {
    cwd: repo.dir,
    encoding: "utf-8",
  }).trim();
}

/** Read `git status --porcelain` to assert a clean working tree. */
function gitStatus(repo: TestRepo): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: repo.dir,
    encoding: "utf-8",
  });
}

describe("transactional commits", () => {
  describe("happy path: every mutation produces exactly one commit", () => {
    // Table-driven: each row runs against a fresh repo and asserts the
    // command produced exactly one commit with a clef-prefixed subject and
    // left a clean working tree behind. Picking representative commands
    // (one per migrated manager + a couple of adjacent commands) rather
    // than exhausting every command — the unit tests cover the rest.
    interface Row {
      name: string;
      args: (repo: TestRepo) => string[];
      input?: string;
      expectedSubjectPrefix: string;
    }

    const rows: Row[] = [
      {
        name: "clef set",
        args: () => ["set", "payments/dev", "NEW_KEY", "value"],
        expectedSubjectPrefix: "clef set",
      },
      {
        name: "clef recipients add -e dev",
        args: () => [
          "recipients",
          "add",
          "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
          "-e",
          "dev",
        ],
        // recipients add prompts for confirmation
        input: "y\n",
        expectedSubjectPrefix: "clef recipients add",
      },
    ];

    let perTestRepo: TestRepo;
    afterEach(() => {
      perTestRepo?.cleanup();
    });

    for (const row of rows) {
      it(`${row.name} → exactly one commit`, () => {
        perTestRepo = scaffoldTestRepo(keys);
        const beforeSha = head(perTestRepo);

        const result = clef(perTestRepo, row.args(perTestRepo), { input: row.input });
        // If a row fails, the assertion message includes stderr/stdout so
        // the failing test is debuggable without re-running with --verbose.
        expect({
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }).toMatchObject({ status: 0 });

        // Exactly one new commit
        const afterSha = head(perTestRepo);
        expect(afterSha).not.toBe(beforeSha);
        const log = execFileSync("git", ["rev-list", `${beforeSha}..HEAD`], {
          cwd: perTestRepo.dir,
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter(Boolean);
        expect(log).toHaveLength(1);

        // Subject line came from the manager, not from a manual git commit
        expect(lastCommitSubject(perTestRepo)).toMatch(
          new RegExp(`^${row.expectedSubjectPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );

        // Working tree is clean — no orphan temp files, no half-written cells
        expect(gitStatus(perTestRepo)).toBe("");
      });
    }
  });

  describe("rollback", () => {
    let repo: TestRepo;
    afterEach(() => {
      repo?.cleanup();
    });

    it("invalid recipient leaves the repo byte-for-byte unchanged", () => {
      repo = scaffoldTestRepo(keys);
      const beforeSha = head(repo);
      const beforeCellBytes = fs.readFileSync(path.join(repo.dir, "payments/dev.enc.yaml"));
      const beforeManifestBytes = fs.readFileSync(path.join(repo.dir, "clef.yaml"));

      // age public keys must start with "age1" and decode to a valid bech32.
      // "age1notavalidkey" fails validation in RecipientManager.add before
      // any encrypt happens, so this also exercises the preflight branch.
      const result = clef(repo, ["recipients", "add", "age1notavalidkey"], {
        input: "y\n",
      });
      expect(result.status).not.toBe(0);

      // No new commits
      expect(head(repo)).toBe(beforeSha);

      // Files untouched, byte for byte
      expect(
        fs.readFileSync(path.join(repo.dir, "payments/dev.enc.yaml")).equals(beforeCellBytes),
      ).toBe(true);
      expect(fs.readFileSync(path.join(repo.dir, "clef.yaml")).equals(beforeManifestBytes)).toBe(
        true,
      );

      // Working tree clean
      expect(gitStatus(repo)).toBe("");
    });
  });

  describe("locking", () => {
    let repo: TestRepo;
    afterEach(() => {
      repo?.cleanup();
    });

    it("refuses a concurrent writer while the lock is held", async () => {
      repo = scaffoldTestRepo(keys);

      // Hold the first transaction inside its critical section for long
      // enough that the second command exhausts its lock-retry budget.
      // proper-lockfile retries 5x with 100-1000ms backoff (~2.5s total),
      // so 4s gives us comfortable headroom.
      const slow = spawn("node", [clefBin, "set", "payments/dev", "SLOW_KEY", "slow_value"], {
        cwd: repo.dir,
        env: {
          ...process.env,
          SOPS_AGE_KEY_FILE: keys.keyFilePath,
          CLEF_TX_TEST_DELAY_MS: "4000",
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@test.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@test.com",
        },
        stdio: "pipe",
      });

      // Give the slow command time to acquire the lock before the second
      // command races it.
      await new Promise((r) => setTimeout(r, 500));

      // Second command should fail with TransactionLockError after
      // exhausting its retry budget (~2.5s).
      const second = clef(repo, ["set", "payments/dev", "FAST_KEY", "fast_value"]);
      expect(second.status).not.toBe(0);
      expect(second.stderr + second.stdout).toMatch(/lock|another clef process/i);

      // Wait for the slow command to finish so we don't leak the subprocess
      const slowExit = await new Promise<number>((resolve) => {
        slow.on("exit", (code) => resolve(code ?? -1));
      });
      expect(slowExit).toBe(0);

      // After both are done the lock should be released — a third command
      // proves it by succeeding without retries.
      const third = clef(repo, ["set", "payments/dev", "THIRD_KEY", "third_value"]);
      expect(third.status).toBe(0);
    }, 20000);
  });

  describe("preflight", () => {
    let repo: TestRepo;
    afterEach(() => {
      repo?.cleanup();
    });

    it("refuses to mutate when a tracked file has uncommitted changes", () => {
      repo = scaffoldTestRepo(keys);
      const beforeSha = head(repo);

      // Modify a TRACKED file. The preflight uses `git diff-index HEAD`
      // which only flags tracked changes — untracked files don't count
      // because `git reset --hard` won't touch them on rollback anyway.
      fs.appendFileSync(path.join(repo.dir, "clef.yaml"), "# wip comment\n");

      const result = clef(repo, ["set", "payments/dev", "NEW_KEY", "value"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/uncommitted|dirty/i);

      // No new commits
      expect(head(repo)).toBe(beforeSha);
      // The user's wip change is still there
      expect(fs.readFileSync(path.join(repo.dir, "clef.yaml"), "utf-8")).toMatch(/# wip comment/);
    });

    it("refuses to mutate when the repo is mid-merge", () => {
      repo = scaffoldTestRepo(keys);

      // Fake a mid-merge state — TransactionManager.preflight only checks
      // for the existence of .git/MERGE_HEAD, not whether the merge is real
      fs.writeFileSync(path.join(repo.dir, ".git", "MERGE_HEAD"), "0000\n");
      const beforeSha = head(repo);

      const result = clef(repo, ["set", "payments/dev", "NEW_KEY", "value"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/mid-merge/i);
      expect(head(repo)).toBe(beforeSha);

      // Cleanup the fake state so the repo cleanup doesn't trip on it
      fs.unlinkSync(path.join(repo.dir, ".git", "MERGE_HEAD"));
    });
  });
});
