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
    it("should call git commit and return hash", async () => {
      const runner = mockRunner(async () => ({
        stdout: "[main abc1234] feat: add secrets\n 1 file changed, 1 insertion(+)",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const hash = await git.commit("feat: add secrets", "/repo");

      expect(hash).toBe("abc1234");
      expect(runner.run).toHaveBeenCalledWith("git", ["commit", "-m", "feat: add secrets"], {
        cwd: "/repo",
      });
    });

    it("should return empty string when commit output has no hash", async () => {
      const runner = mockRunner(async () => ({
        stdout: "Some unusual commit output",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      const hash = await git.commit("test", "/repo");
      expect(hash).toBe("");
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
    it("should write hook file and make it executable", async () => {
      const runner = mockRunner(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }));
      const git = new GitIntegration(runner);

      await git.installPreCommitHook("/repo");

      // Should call tee to write the hook
      expect(runner.run).toHaveBeenCalledWith(
        "tee",
        ["/repo/.git/hooks/pre-commit"],
        expect.objectContaining({ stdin: expect.stringContaining("#!/bin/sh") }),
      );

      // Should call chmod
      expect(runner.run).toHaveBeenCalledWith("chmod", ["+x", "/repo/.git/hooks/pre-commit"], {
        cwd: "/repo",
      });
    });

    it("should throw GitOperationError when tee fails", async () => {
      const runner = mockRunner(async (command) => {
        if (command === "tee") {
          return { stdout: "", stderr: "Permission denied", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      await expect(git.installPreCommitHook("/repo")).rejects.toThrow(GitOperationError);
    });

    it("should throw GitOperationError when chmod fails", async () => {
      const runner = mockRunner(async (command) => {
        if (command === "chmod") {
          return { stdout: "", stderr: "Operation not permitted", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });
      const git = new GitIntegration(runner);

      await expect(git.installPreCommitHook("/repo")).rejects.toThrow(GitOperationError);
    });
  });
});
