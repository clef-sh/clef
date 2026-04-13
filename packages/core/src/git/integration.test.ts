import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GitIntegration } from "./integration";
import { GitOperationError, SubprocessRunner } from "../types";

function mockRunner(
  impl?: (
    command: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): SubprocessRunner {
  return {
    run: jest.fn(
      impl ??
        (async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
        })),
    ),
  };
}

describe("GitIntegration", () => {
  describe("stageFiles", () => {
    it("should call git add with the provided file paths", async () => {
      const runner = mockRunner();
      const git = new GitIntegration(runner);

      await git.stageFiles(["file1.yaml", "file2.yaml"], "/repo");

      expect(runner.run).toHaveBeenCalledWith("git", ["add", "file1.yaml", "file2.yaml"], {
        cwd: "/repo",
      });
    });

    it("should do nothing for empty file list", async () => {
      const runner = mockRunner();
      const git = new GitIntegration(runner);

      await git.stageFiles([], "/repo");

      expect(runner.run).not.toHaveBeenCalled();
    });

    it("should throw GitOperationError on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.stageFiles(["file.yaml"], "/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("commit", () => {
    it("should call git commit and return the full SHA via rev-parse HEAD", async () => {
      // commit() now calls git commit then git rev-parse HEAD to get the full SHA
      const runner = mockRunner(async (command, args) => {
        if (args[0] === "commit") {
          return {
            stdout: "[main abc1234] feat: add secrets\n 1 file changed, 1 insertion(+)",
            stderr: "",
            exitCode: 0,
          };
        }
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return {
            stdout: "abc1234567890abcdef1234567890abcdef123456\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      const hash = await git.commit("feat: add secrets", "/repo");

      expect(hash).toBe("abc1234567890abcdef1234567890abcdef123456");
      expect(runner.run).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "feat: add secrets"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("should pass --no-verify when noVerify is true", async () => {
      const runner = mockRunner(async (command, args) => {
        if (args[0] === "commit") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "abc1234567890abcdef\n", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      await git.commit("test", "/repo", { noVerify: true });

      expect(runner.run).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "test", "--no-verify"],
        expect.any(Object),
      );
    });

    it("should pass env vars to the commit subprocess", async () => {
      const runner = mockRunner(async (command, args) => {
        if (args[0] === "commit") return { stdout: "", stderr: "", exitCode: 0 };
        return { stdout: "abc1234\n", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      await git.commit("test", "/repo", { env: { CLEF_IN_TRANSACTION: "1" } });

      expect(runner.run).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "test"],
        expect.objectContaining({
          cwd: "/repo",
          env: { CLEF_IN_TRANSACTION: "1" },
        }),
      );
    });

    it("should throw GitOperationError on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "nothing to commit",
        exitCode: 1,
      }));
      const git = new GitIntegration(runner);

      await expect(git.commit("test", "/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("getLog", () => {
    it("should parse git log output into GitCommit array", async () => {
      const runner = mockRunner(async () => ({
        stdout:
          "abc123|John Doe|2024-01-15T10:30:00+00:00|feat: add database secrets\ndef456|Jane Smith|2024-01-14T09:00:00+00:00|fix: update pool size",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const log = await git.getLog("database/dev.enc.yaml", "/repo");

      expect(log).toHaveLength(2);
      expect(log[0].hash).toBe("abc123");
      expect(log[0].author).toBe("John Doe");
      expect(log[0].message).toBe("feat: add database secrets");
      expect(log[1].hash).toBe("def456");
    });

    it("should return empty array for empty output", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const log = await git.getLog("new-file.yaml", "/repo");
      expect(log).toHaveLength(0);
    });

    it("should respect the limit parameter", async () => {
      const runner = mockRunner(async () => ({
        stdout: "abc|Author|2024-01-15T10:00:00Z|msg",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      await git.getLog("file.yaml", "/repo", 5);

      expect(runner.run).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["--max-count=5"]),
        expect.any(Object),
      );
    });

    it("should throw GitOperationError on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal error",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.getLog("file.yaml", "/repo")).rejects.toThrow(GitOperationError);
    });

    it("should handle commit messages containing pipe characters", async () => {
      const runner = mockRunner(async () => ({
        stdout: "abc|Author|2024-01-15T10:00:00Z|feat: add key|value support",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const log = await git.getLog("file.yaml", "/repo");
      expect(log[0].message).toBe("feat: add key|value support");
    });
  });

  describe("getDiff", () => {
    it("should return cached diff output", async () => {
      const runner = mockRunner(async () => ({
        stdout: "diff --git a/file.yaml b/file.yaml\n+new line",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const diff = await git.getDiff("/repo");
      expect(diff).toContain("diff --git");
    });

    it("should throw GitOperationError on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      }));
      const git = new GitIntegration(runner);

      await expect(git.getDiff("/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("getStatus", () => {
    it("should parse staged, unstaged, and untracked files", async () => {
      const runner = mockRunner(async () => ({
        stdout: "M  staged.yaml\n M unstaged.yaml\n?? untracked.yaml\nAM both.yaml",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const status = await git.getStatus("/repo");

      expect(status.staged).toContain("staged.yaml");
      expect(status.unstaged).toContain("unstaged.yaml");
      expect(status.untracked).toContain("untracked.yaml");
      expect(status.staged).toContain("both.yaml");
      expect(status.unstaged).toContain("both.yaml");
    });

    it("preserves the leading space when X is empty (worktree-only changes)", async () => {
      // Regression test: a previous version of the parser called
      // .trim() on the whole stdout, which stripped the leading space
      // from the first line when the first file was worktree-only
      // (X=" ", Y="M"). That shifted the columns by one and the
      // first file was misclassified as staged AND its filename was
      // missing the leading char.
      const runner = mockRunner(async () => ({
        stdout: " M payments/dev.enc.yaml\n?? payments/dev.clef-meta.yaml\n",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const status = await git.getStatus("/repo");

      // The cell file is unstaged (worktree-only), with filename intact
      expect(status.unstaged).toEqual(["payments/dev.enc.yaml"]);
      expect(status.staged).toEqual([]);
      expect(status.untracked).toEqual(["payments/dev.clef-meta.yaml"]);
    });

    it("should return empty arrays for clean repo", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const status = await git.getStatus("/repo");
      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
    });

    it("should throw GitOperationError on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: not a git repo",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.getStatus("/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("installPreCommitHook", () => {
    let tmpRepo: string;

    beforeEach(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "git-hook-test-"));
      fs.mkdirSync(path.join(tmpRepo, ".git", "hooks"), { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("should write hook file with shebang and correct mode", async () => {
      const git = new GitIntegration(mockRunner());

      await git.installPreCommitHook(tmpRepo);

      const hookPath = path.join(tmpRepo, ".git", "hooks", "pre-commit");
      const content = fs.readFileSync(hookPath, "utf-8");
      expect(content).toContain("#!/bin/sh");
      expect(content).toContain("CLEF_IN_TRANSACTION");

      const stat = fs.statSync(hookPath);
      // Owner-execute bit should be set (mode & 0o100)
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it("should create hooks directory if missing", async () => {
      const noHooksDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-hook-test-"));
      fs.mkdirSync(path.join(noHooksDir, ".git"));
      const git = new GitIntegration(mockRunner());

      await git.installPreCommitHook(noHooksDir);

      const hookPath = path.join(noHooksDir, ".git", "hooks", "pre-commit");
      expect(fs.existsSync(hookPath)).toBe(true);

      fs.rmSync(noHooksDir, { recursive: true, force: true });
    });

    it("should throw GitOperationError when write fails", async () => {
      const git = new GitIntegration(mockRunner());

      // Point at a path that can't be written to
      await expect(git.installPreCommitHook("/nonexistent/repo")).rejects.toThrow(
        GitOperationError,
      );
    });
  });

  describe("getHead", () => {
    it("should return the trimmed HEAD SHA", async () => {
      const runner = mockRunner(async () => ({
        stdout: "abc1234567890abcdef1234567890abcdef123456\n",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const sha = await git.getHead("/repo");

      expect(sha).toBe("abc1234567890abcdef1234567890abcdef123456");
      expect(runner.run).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], { cwd: "/repo" });
    });

    it("should throw on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: ambiguous argument 'HEAD'",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.getHead("/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("resetHard", () => {
    it("should call git reset --hard with the SHA", async () => {
      const runner = mockRunner();
      const git = new GitIntegration(runner);

      await git.resetHard("/repo", "abc1234");

      expect(runner.run).toHaveBeenCalledWith("git", ["reset", "--hard", "abc1234"], {
        cwd: "/repo",
      });
    });

    it("should throw on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.resetHard("/repo", "abc1234")).rejects.toThrow(GitOperationError);
    });
  });

  describe("cleanFiles", () => {
    it("should call git clean -fd with the paths", async () => {
      const runner = mockRunner();
      const git = new GitIntegration(runner);

      await git.cleanFiles("/repo", ["a.enc.yaml", "b.enc.yaml"]);

      expect(runner.run).toHaveBeenCalledWith(
        "git",
        ["clean", "-fd", "--", "a.enc.yaml", "b.enc.yaml"],
        { cwd: "/repo" },
      );
    });

    it("should do nothing for empty path list", async () => {
      const runner = mockRunner();
      const git = new GitIntegration(runner);

      await git.cleanFiles("/repo", []);

      expect(runner.run).not.toHaveBeenCalled();
    });

    it("should throw on failure", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: error",
        exitCode: 1,
      }));
      const git = new GitIntegration(runner);

      await expect(git.cleanFiles("/repo", ["a.yaml"])).rejects.toThrow(GitOperationError);
    });
  });

  describe("isDirty", () => {
    it("should return false when diff-index exits 0 (clean)", async () => {
      const runner = mockRunner(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
      const git = new GitIntegration(runner);

      expect(await git.isDirty("/repo")).toBe(false);
    });

    it("should return true when diff-index exits 1 (dirty)", async () => {
      const runner = mockRunner(async () => ({ stdout: "", stderr: "", exitCode: 1 }));
      const git = new GitIntegration(runner);

      expect(await git.isDirty("/repo")).toBe(true);
    });

    it("should throw on other exit codes", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: not a repo",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      await expect(git.isDirty("/repo")).rejects.toThrow(GitOperationError);
    });
  });

  describe("isRepo", () => {
    it("should return true when rev-parse --git-dir succeeds", async () => {
      const runner = mockRunner(async () => ({ stdout: ".git\n", stderr: "", exitCode: 0 }));
      const git = new GitIntegration(runner);

      expect(await git.isRepo("/repo")).toBe(true);
    });

    it("should return false when rev-parse --git-dir fails", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      }));
      const git = new GitIntegration(runner);

      expect(await git.isRepo("/repo")).toBe(false);
    });
  });

  describe("isMidOperation", () => {
    // Real temp dirs with real .git/* files. No mocking — tests the real
    // fs.existsSync calls in isMidOperation against actual file presence.
    let tmpRepo: string;

    beforeEach(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "git-int-test-"));
      fs.mkdirSync(path.join(tmpRepo, ".git"), { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("should detect mid-merge", async () => {
      fs.writeFileSync(path.join(tmpRepo, ".git", "MERGE_HEAD"), "abc1234");
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: true, kind: "merge" });
    });

    it("should detect mid-rebase (rebase-merge)", async () => {
      fs.mkdirSync(path.join(tmpRepo, ".git", "rebase-merge"));
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: true, kind: "rebase" });
    });

    it("should detect mid-rebase (rebase-apply)", async () => {
      fs.mkdirSync(path.join(tmpRepo, ".git", "rebase-apply"));
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: true, kind: "rebase" });
    });

    it("should detect mid-cherry-pick", async () => {
      fs.writeFileSync(path.join(tmpRepo, ".git", "CHERRY_PICK_HEAD"), "abc1234");
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: true, kind: "cherry-pick" });
    });

    it("should detect mid-revert", async () => {
      fs.writeFileSync(path.join(tmpRepo, ".git", "REVERT_HEAD"), "abc1234");
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: true, kind: "revert" });
    });

    it("should return midOp: false when no operation files exist", async () => {
      const git = new GitIntegration(mockRunner());

      const result = await git.isMidOperation(tmpRepo);
      expect(result).toEqual({ midOp: false });
    });
  });

  describe("getAuthorIdentity", () => {
    it("should return the configured name and email", async () => {
      const runner = mockRunner(async (command, args) => {
        if (args[2] === "user.name") return { stdout: "Alice\n", stderr: "", exitCode: 0 };
        if (args[2] === "user.email")
          return { stdout: "alice@example.com\n", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 1 };
      });
      const git = new GitIntegration(runner);

      const identity = await git.getAuthorIdentity("/repo");

      expect(identity).toEqual({ name: "Alice", email: "alice@example.com" });
    });

    it("should return null when name is missing", async () => {
      const runner = mockRunner(async (command, args) => {
        if (args[2] === "user.name") return { stdout: "", stderr: "", exitCode: 1 };
        if (args[2] === "user.email")
          return { stdout: "alice@example.com\n", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      const identity = await git.getAuthorIdentity("/repo");
      expect(identity).toBeNull();
    });

    it("should return null when email is missing", async () => {
      const runner = mockRunner(async (command, args) => {
        if (args[2] === "user.name") return { stdout: "Alice\n", stderr: "", exitCode: 0 };
        if (args[2] === "user.email") return { stdout: "", stderr: "", exitCode: 1 };
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      const identity = await git.getAuthorIdentity("/repo");
      expect(identity).toBeNull();
    });
  });
});
