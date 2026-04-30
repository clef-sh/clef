import { SubprocessRunner, SubprocessResult } from "@clef-sh/core";
import { generateReportAtCommit, listCommitRange, getHeadSha } from "./historical";

jest.mock("fs");
jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    SopsClient: jest.fn().mockImplementation(() => ({})),
    ReportGenerator: jest.fn().mockImplementation(() => ({
      generate: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        repoIdentity: {
          repoOrigin: "",
          commitSha: "abc123",
          branch: "main",
          commitTimestamp: "2024-01-01T00:00:00Z",
          reportGeneratedAt: "2024-01-01T00:01:00Z",
          clefVersion: "1.0.0",
          sopsVersion: "3.12.2",
        },
        manifest: {
          manifestVersion: 1,
          filePattern: "",
          environments: [],
          namespaces: [],
          defaultBackend: "age",
        },
        matrix: [],
        policy: { issueCount: { error: 0, warning: 0, info: 0 }, issues: [] },
        recipients: {},
      }),
    })),
  };
});

function makeMockRunner(
  overrides: Partial<Record<string, SubprocessResult>> = {},
): SubprocessRunner {
  const run = jest.fn().mockImplementation((_cmd: string, args: string[]) => {
    const key = args[0];
    if (key === "worktree" && args[1] === "add") {
      return Promise.resolve(overrides["worktree-add"] ?? { stdout: "", stderr: "", exitCode: 0 });
    }
    if (key === "worktree" && args[1] === "remove") {
      return Promise.resolve(
        overrides["worktree-remove"] ?? { stdout: "", stderr: "", exitCode: 0 },
      );
    }
    if (key === "worktree" && args[1] === "prune") {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }
    if (key === "log") {
      return Promise.resolve(
        overrides["log"] ?? { stdout: "aaa111\nbbb222\nccc333\n", stderr: "", exitCode: 0 },
      );
    }
    if (key === "rev-parse") {
      return Promise.resolve(
        overrides["rev-parse"] ?? { stdout: "head123\n", stderr: "", exitCode: 0 },
      );
    }
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  });
  return { run };
}

describe("historical", () => {
  describe("generateReportAtCommit", () => {
    it("creates worktree, generates report, and cleans up", async () => {
      const runner = makeMockRunner();
      const report = await generateReportAtCommit("/repo", "abc123", "1.0.0", runner);

      expect(report.schemaVersion).toBe(1);
      // Verify worktree add was called
      expect(runner.run).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add"]),
        expect.any(Object),
      );
      // Verify worktree remove was called
      expect(runner.run).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove"]),
        expect.any(Object),
      );
    });

    it("throws when worktree add fails", async () => {
      const runner = makeMockRunner({
        "worktree-add": { stdout: "", stderr: "fatal: bad ref", exitCode: 128 },
      });

      await expect(generateReportAtCommit("/repo", "badref", "1.0.0", runner)).rejects.toThrow(
        "Failed to create worktree",
      );
    });

    it("cleans up worktree even on generation failure", async () => {
      const { ReportGenerator } = jest.requireMock("@clef-sh/core") as {
        ReportGenerator: jest.Mock;
      };
      ReportGenerator.mockImplementationOnce(() => ({
        generate: jest.fn().mockRejectedValue(new Error("generation failed")),
      }));

      const runner = makeMockRunner();

      await expect(generateReportAtCommit("/repo", "abc123", "1.0.0", runner)).rejects.toThrow(
        "generation failed",
      );

      expect(runner.run).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove"]),
        expect.any(Object),
      );
    });
  });

  describe("listCommitRange", () => {
    it("returns commit SHAs oldest-first", async () => {
      const runner = makeMockRunner();
      const commits = await listCommitRange("/repo", "old123", runner);

      expect(commits).toEqual(["aaa111", "bbb222", "ccc333"]);
      expect(runner.run).toHaveBeenCalledWith(
        "git",
        ["log", "--format=%H", "--reverse", "old123..HEAD"],
        { cwd: "/repo" },
      );
    });

    it("returns empty array for empty output", async () => {
      const runner = makeMockRunner({ log: { stdout: "\n", stderr: "", exitCode: 0 } });
      const commits = await listCommitRange("/repo", "head", runner);
      expect(commits).toEqual([]);
    });

    it("throws on git error", async () => {
      const runner = makeMockRunner({
        log: { stdout: "", stderr: "fatal: bad ref", exitCode: 128 },
      });
      await expect(listCommitRange("/repo", "bad", runner)).rejects.toThrow("Failed to list");
    });
  });

  describe("getHeadSha", () => {
    it("returns HEAD SHA", async () => {
      const runner = makeMockRunner();
      const sha = await getHeadSha("/repo", runner);
      expect(sha).toBe("head123");
    });

    it("throws on git error", async () => {
      const runner = makeMockRunner({
        "rev-parse": { stdout: "", stderr: "fatal", exitCode: 128 },
      });
      await expect(getHeadSha("/repo", runner)).rejects.toThrow("Failed to get HEAD");
    });
  });
});
