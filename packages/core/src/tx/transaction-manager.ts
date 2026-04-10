import * as fs from "fs";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import { GitIntegration } from "../git/integration";
import {
  TransactionLockError,
  TransactionPreflightError,
  TransactionRollbackError,
} from "./errors";

/**
 * Options for a single transactional mutation.
 */
export interface TransactionOptions {
  /** Human-readable commit message. Required. */
  description: string;
  /**
   * Paths the mutation will touch (relative to repoRoot).
   * Used for `git add` and to scope rollback's `git clean`.
   * Be precise — anything outside this list is not protected by the transaction.
   */
  paths: string[];
  /**
   * The work itself. Write files via `write-file-atomic` and update the
   * manifest via the existing helpers. May throw — that triggers rollback.
   */
  mutate: () => Promise<void>;
  /** Auto-commit on success. Default: true */
  commit?: boolean;
  /** Allow running with a dirty working tree. Default: false */
  allowDirty?: boolean;
  /** Skip the pre-commit hook (`git commit --no-verify`). Default: false */
  noVerify?: boolean;
}

/**
 * Result of a successful transaction.
 */
export interface TransactionResult {
  /** SHA of the commit created, or null if `commit: false` was passed */
  sha: string | null;
  /** Paths included in the commit */
  paths: string[];
  /** True if the working tree was already dirty when the transaction started */
  startedDirty: boolean;
}

/**
 * Default lock acquisition tuning. Balanced for an interactive CLI:
 * fast retries to feel responsive, low total latency on contention.
 */
const LOCK_OPTIONS: lockfile.LockOptions = {
  stale: 10_000,
  retries: { retries: 5, minTimeout: 100, maxTimeout: 1_000, randomize: true },
};

const CLEF_DIR = ".clef";
const LOCK_FILE = ".lock";
const TRANSACTION_ENV_VAR = "CLEF_IN_TRANSACTION";

/**
 * Wraps mutations to the matrix in a transactional commit:
 *   1. Acquire a single-writer lock on .clef/.lock
 *   2. Validate the working tree (clean, in a git repo, not mid-rebase, etc.)
 *   3. Run the mutation
 *   4. git add the declared paths and git commit
 *   5. On any failure between steps 3 and 4: git reset --hard to the
 *      pre-mutation HEAD, git clean -fd the declared paths, rethrow.
 *
 * Each transaction creates exactly one git commit. Each commit can be
 * reverted with `git revert <sha>`.
 */
export class TransactionManager {
  constructor(private readonly git: GitIntegration) {}

  async run(repoRoot: string, opts: TransactionOptions): Promise<TransactionResult> {
    const shouldCommit = opts.commit !== false;
    const allowDirty = opts.allowDirty === true;

    // ── Phase 0: ensure the .clef directory exists for the lock file ──────
    const clefDir = path.join(repoRoot, CLEF_DIR);
    if (!fs.existsSync(clefDir)) {
      fs.mkdirSync(clefDir, { recursive: true });
    }
    const lockPath = path.join(clefDir, LOCK_FILE);
    // proper-lockfile requires the file to exist before it can lock it.
    if (!fs.existsSync(lockPath)) {
      fs.writeFileSync(lockPath, "");
    }

    // ── Phase 1: acquire lock ────────────────────────────────────────────
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(lockPath, LOCK_OPTIONS);
    } catch (err) {
      throw new TransactionLockError(
        null,
        `Could not acquire transaction lock at ${lockPath}: ${(err as Error).message}. ` +
          `Another clef process may be running against this repository.`,
      );
    }

    try {
      // ── Phase 2: preflight ─────────────────────────────────────────────
      if (!(await this.git.isRepo(repoRoot))) {
        throw new TransactionPreflightError(
          "not-a-repo",
          `${repoRoot} is not a git repository.`,
          "Run 'git init' (or 'clef init') first. Clef requires a git repository for safe mutations.",
        );
      }

      const midOp = await this.git.isMidOperation(repoRoot);
      if (midOp.midOp) {
        throw new TransactionPreflightError(
          "mid-operation",
          `Repository is mid-${midOp.kind}. Refusing to mutate.`,
          `Finish the in-progress ${midOp.kind} first ('git ${midOp.kind} --continue' or '--abort'), then retry.`,
        );
      }

      // Author identity must be set or commit will fail. Detect early so the
      // user gets a useful error instead of a cryptic "Please tell me who you are".
      if (shouldCommit) {
        const identity = await this.git.getAuthorIdentity(repoRoot);
        if (!identity) {
          throw new TransactionPreflightError(
            "no-author-identity",
            "git author identity is not configured.",
            `Configure it with: git config user.name "Your Name" && git config user.email "you@example.com"`,
          );
        }
      }

      // HEAD must exist (the repo must have at least one commit) so we have
      // a target to reset to. Empty repos cannot be transacted against.
      let preMutationSha: string;
      try {
        preMutationSha = await this.git.getHead(repoRoot);
      } catch {
        throw new TransactionPreflightError(
          "no-commits",
          "Repository has no commits yet — cannot transact safely.",
          "Make an initial commit first ('git commit --allow-empty -m initial'), then retry.",
        );
      }

      const startedDirty = await this.git.isDirty(repoRoot);
      if (startedDirty && !allowDirty) {
        throw new TransactionPreflightError(
          "dirty-tree",
          "Working tree has uncommitted changes. Refusing to mutate.",
          "Commit or stash your changes first, or pass --allow-dirty to proceed (rollback will be best-effort).",
        );
      }

      // ── Phase 3: mutate ────────────────────────────────────────────────
      try {
        await opts.mutate();
      } catch (mutateErr) {
        await this.rollback(repoRoot, preMutationSha, opts.paths, startedDirty, mutateErr as Error);
        // rollback() always throws — this is unreachable
        throw mutateErr;
      }

      // ── Phase 4: commit ────────────────────────────────────────────────
      let sha: string | null = null;
      if (shouldCommit) {
        try {
          await this.git.stageFiles(opts.paths, repoRoot);
          sha = await this.git.commit(opts.description, repoRoot, {
            env: { [TRANSACTION_ENV_VAR]: "1" },
            noVerify: opts.noVerify === true,
          });
        } catch (commitErr) {
          await this.rollback(
            repoRoot,
            preMutationSha,
            opts.paths,
            startedDirty,
            commitErr as Error,
          );
          throw commitErr;
        }
      }

      return { sha, paths: opts.paths, startedDirty };
    } finally {
      try {
        await release!();
      } catch {
        // Best-effort lock release. proper-lockfile cleans stale locks
        // automatically on next acquisition.
      }
    }
  }

  /**
   * Restore the working tree to the pre-mutation state.
   *
   * If the transaction started with a clean tree, we can `git reset --hard`
   * to the pre-mutation SHA without losing any work.
   *
   * If the transaction started dirty (allowDirty was set), we cannot safely
   * reset because that would discard the user's pre-existing uncommitted
   * changes. In that case, we throw a rollback error and tell the user to
   * inspect manually.
   */
  private async rollback(
    repoRoot: string,
    preMutationSha: string,
    paths: string[],
    startedDirty: boolean,
    originalError: Error,
  ): Promise<never> {
    if (startedDirty) {
      throw new TransactionRollbackError(
        originalError,
        false,
        `Mutation failed and rollback was refused because the working tree was already dirty. ` +
          `Inspect manually with 'git status'. Original error: ${originalError.message}`,
      );
    }

    try {
      await this.git.resetHard(repoRoot, preMutationSha);
      await this.git.cleanFiles(repoRoot, paths);
    } catch (rollbackErr) {
      throw new TransactionRollbackError(
        originalError,
        false,
        `Mutation failed AND rollback failed. The working tree may be in an inconsistent state. ` +
          `Inspect manually with 'git status'. ` +
          `Original error: ${originalError.message}. ` +
          `Rollback error: ${(rollbackErr as Error).message}`,
      );
    }

    throw new TransactionRollbackError(
      originalError,
      true,
      `Mutation failed; working tree restored to pre-mutation state. ` +
        `Original error: ${originalError.message}`,
    );
  }
}
