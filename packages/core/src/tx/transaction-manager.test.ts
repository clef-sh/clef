import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import { TransactionManager } from "./transaction-manager";
import {
  TransactionLockError,
  TransactionPreflightError,
  TransactionRollbackError,
} from "./errors";
import { GitIntegration } from "../git/integration";

// Use real fs (we need real lock files in temp dirs) but mock the GitIntegration
// so we control all git outcomes deterministically without spawning real git.

function makeMockGit(): jest.Mocked<GitIntegration> {
  return {
    isRepo: jest.fn().mockResolvedValue(true),
    isMidOperation: jest.fn().mockResolvedValue({ midOp: false }),
    isDirty: jest.fn().mockResolvedValue(false),
    getHead: jest.fn().mockResolvedValue("0000000000000000000000000000000000000000"),
    getAuthorIdentity: jest.fn().mockResolvedValue({ name: "Test", email: "test@test.com" }),
    stageFiles: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    resetHard: jest.fn().mockResolvedValue(undefined),
    cleanFiles: jest.fn().mockResolvedValue(undefined),
    getLog: jest.fn(),
    getDiff: jest.fn(),
    getStatus: jest.fn(),
    installMergeDriver: jest.fn(),
    checkMergeDriver: jest.fn(),
    installPreCommitHook: jest.fn(),
  } as unknown as jest.Mocked<GitIntegration>;
}

describe("TransactionManager", () => {
  let repoRoot: string;
  let git: jest.Mocked<GitIntegration>;
  let manager: TransactionManager;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-tx-test-"));
    git = makeMockGit();
    manager = new TransactionManager(git);
  });

  afterEach(() => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("happy path", () => {
    it("runs the mutate callback, stages, and commits", async () => {
      const mutate = jest.fn().mockResolvedValue(undefined);

      const result = await manager.run(repoRoot, {
        description: "test commit",
        paths: ["secrets/payments/dev.enc.yaml"],
        mutate,
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(git.stageFiles).toHaveBeenCalledWith(["secrets/payments/dev.enc.yaml"], repoRoot);
      expect(git.commit).toHaveBeenCalledWith("test commit", repoRoot, expect.any(Object));
      expect(result.sha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(result.paths).toEqual(["secrets/payments/dev.enc.yaml"]);
      expect(result.startedDirty).toBe(false);
    });

    it("returns sha: null when commit is false", async () => {
      const result = await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
        commit: false,
      });

      expect(result.sha).toBe(null);
      expect(git.stageFiles).not.toHaveBeenCalled();
      expect(git.commit).not.toHaveBeenCalled();
    });

    it("sets CLEF_IN_TRANSACTION=1 in the commit env", async () => {
      await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
      });

      expect(git.commit).toHaveBeenCalledWith(
        "test",
        repoRoot,
        expect.objectContaining({
          env: { CLEF_IN_TRANSACTION: "1" },
        }),
      );
    });

    it("passes noVerify: false by default", async () => {
      await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
      });

      expect(git.commit).toHaveBeenCalledWith(
        "test",
        repoRoot,
        expect.objectContaining({ noVerify: false }),
      );
    });

    it("passes noVerify: true when requested", async () => {
      await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
        noVerify: true,
      });

      expect(git.commit).toHaveBeenCalledWith(
        "test",
        repoRoot,
        expect.objectContaining({ noVerify: true }),
      );
    });
  });

  describe("preflight", () => {
    it("refuses if not in a git repo", async () => {
      git.isRepo.mockResolvedValue(false);

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow(TransactionPreflightError);
    });

    it("refuses if working tree is dirty", async () => {
      git.isDirty.mockResolvedValue(true);

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("Working tree has uncommitted changes");
    });

    it("allows dirty tree when allowDirty is true", async () => {
      git.isDirty.mockResolvedValue(true);
      const mutate = jest.fn().mockResolvedValue(undefined);

      const result = await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate,
        allowDirty: true,
      });

      expect(result.startedDirty).toBe(true);
      expect(mutate).toHaveBeenCalled();
    });

    it("refuses if mid-merge", async () => {
      git.isMidOperation.mockResolvedValue({ midOp: true, kind: "merge" });

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("mid-merge");
    });

    it("refuses if mid-rebase", async () => {
      git.isMidOperation.mockResolvedValue({ midOp: true, kind: "rebase" });

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("mid-rebase");
    });

    it("refuses if mid-cherry-pick", async () => {
      git.isMidOperation.mockResolvedValue({ midOp: true, kind: "cherry-pick" });

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("mid-cherry-pick");
    });

    it("refuses if author identity is missing", async () => {
      git.getAuthorIdentity.mockResolvedValue(null);

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("git author identity is not configured");
    });

    it("does not require author identity when commit is false", async () => {
      git.getAuthorIdentity.mockResolvedValue(null);
      const mutate = jest.fn().mockResolvedValue(undefined);

      await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate,
        commit: false,
      });

      expect(mutate).toHaveBeenCalled();
    });

    it("refuses if HEAD does not exist (empty repo)", async () => {
      git.getHead.mockRejectedValue(new Error("ambiguous argument 'HEAD'"));

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate: jest.fn(),
        }),
      ).rejects.toThrow("no commits");
    });

    it("does not call the mutate callback when preflight fails", async () => {
      git.isRepo.mockResolvedValue(false);
      const mutate = jest.fn();

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        }),
      ).rejects.toThrow();

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe("rollback on mutate failure", () => {
    it("calls git reset --hard to the pre-mutation SHA", async () => {
      const mutate = jest.fn().mockRejectedValue(new Error("encryption failed"));

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        }),
      ).rejects.toThrow();

      expect(git.resetHard).toHaveBeenCalledWith(
        repoRoot,
        "0000000000000000000000000000000000000000",
      );
    });

    it("cleans the declared paths after reset", async () => {
      const mutate = jest.fn().mockRejectedValue(new Error("oops"));

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml", "secrets/bar.enc.yaml"],
          mutate,
        }),
      ).rejects.toThrow();

      expect(git.cleanFiles).toHaveBeenCalledWith(repoRoot, [
        "secrets/foo.enc.yaml",
        "secrets/bar.enc.yaml",
      ]);
    });

    it("throws TransactionRollbackError with the original error attached", async () => {
      const original = new Error("encryption failed");
      const mutate = jest.fn().mockRejectedValue(original);

      let caught: unknown;
      try {
        await manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(TransactionRollbackError);
      const txErr = caught as TransactionRollbackError;
      expect(txErr.rollbackOk).toBe(true);
      expect(txErr.originalError).toBe(original);
    });

    it("throws rollbackOk: false when reset itself fails", async () => {
      const mutate = jest.fn().mockRejectedValue(new Error("oops"));
      git.resetHard.mockRejectedValue(new Error("git reset failed"));

      let caught: unknown;
      try {
        await manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(TransactionRollbackError);
      const txErr = caught as TransactionRollbackError;
      expect(txErr.rollbackOk).toBe(false);
    });

    it("refuses rollback when working tree was already dirty", async () => {
      git.isDirty.mockResolvedValue(true);
      const mutate = jest.fn().mockRejectedValue(new Error("oops"));

      let caught: unknown;
      try {
        await manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
          allowDirty: true,
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(TransactionRollbackError);
      const txErr = caught as TransactionRollbackError;
      expect(txErr.rollbackOk).toBe(false);
      // Reset should NOT have been called — we refused to roll back
      expect(git.resetHard).not.toHaveBeenCalled();
    });
  });

  describe("rollback on commit failure", () => {
    it("rolls back if commit fails", async () => {
      git.commit.mockRejectedValue(new Error("commit failed"));
      const mutate = jest.fn().mockResolvedValue(undefined);

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        }),
      ).rejects.toThrow();

      expect(git.resetHard).toHaveBeenCalled();
      expect(git.cleanFiles).toHaveBeenCalled();
    });

    it("rolls back if staging fails", async () => {
      git.stageFiles.mockRejectedValue(new Error("git add failed"));
      const mutate = jest.fn().mockResolvedValue(undefined);

      await expect(
        manager.run(repoRoot, {
          description: "test",
          paths: ["secrets/foo.enc.yaml"],
          mutate,
        }),
      ).rejects.toThrow();

      expect(git.resetHard).toHaveBeenCalled();
    });
  });

  describe("locking", () => {
    it("creates the .clef directory and lock file", async () => {
      await manager.run(repoRoot, {
        description: "test",
        paths: ["secrets/foo.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
      });

      expect(fs.existsSync(path.join(repoRoot, ".clef", ".lock"))).toBe(true);
    });

    it("releases the lock on success", async () => {
      // Two sequential transactions should both succeed (lock released between them)
      await manager.run(repoRoot, {
        description: "first",
        paths: ["a.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
      });

      await manager.run(repoRoot, {
        description: "second",
        paths: ["b.enc.yaml"],
        mutate: jest.fn().mockResolvedValue(undefined),
      });

      expect(git.commit).toHaveBeenCalledTimes(2);
    });

    it("releases the lock on failure", async () => {
      const mutate1 = jest.fn().mockRejectedValue(new Error("first failed"));
      await expect(
        manager.run(repoRoot, {
          description: "first",
          paths: ["a.enc.yaml"],
          mutate: mutate1,
        }),
      ).rejects.toThrow();

      // Second transaction must be able to acquire the lock
      const mutate2 = jest.fn().mockResolvedValue(undefined);
      await manager.run(repoRoot, {
        description: "second",
        paths: ["b.enc.yaml"],
        mutate: mutate2,
      });

      expect(mutate2).toHaveBeenCalled();
    });

    it("refuses with TransactionLockError when lock is held", async () => {
      // Hold the lock manually with proper-lockfile
      const clefDir = path.join(repoRoot, ".clef");
      fs.mkdirSync(clefDir, { recursive: true });
      const lockPath = path.join(clefDir, ".lock");
      fs.writeFileSync(lockPath, "");

      const release = await lockfile.lock(lockPath, { stale: 60_000 });

      try {
        await expect(
          manager.run(repoRoot, {
            description: "test",
            paths: ["foo.enc.yaml"],
            mutate: jest.fn().mockResolvedValue(undefined),
          }),
        ).rejects.toThrow(TransactionLockError);
      } finally {
        await release();
      }
    });
  });
});
