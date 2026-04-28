import * as fs from "fs";
import * as path from "path";
import { GitCommit, GitOperationError, GitStatus, SubprocessRunner } from "../types";

const PRE_COMMIT_HOOK = `#!/bin/sh
# Clef pre-commit hook — blocks commits of files missing SOPS encryption metadata
# and scans staged files for plaintext secrets.
# Installed by: clef hooks install

# Skip during TransactionManager commits (policy scaffolding, migrations, etc.)
if [ "$CLEF_IN_TRANSACTION" = "1" ]; then
  exit 0
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
EXIT_CODE=0

for FILE in $STAGED_FILES; do
  case "$FILE" in
    *.enc.yaml|*.enc.json)
      if ! grep -q '"sops":' "$FILE" && ! grep -q 'sops:' "$FILE"; then
        echo "ERROR: $FILE appears to be missing SOPS metadata."
        echo "       This file may contain unencrypted secrets."
        echo "       Encrypt it with 'sops encrypt -i $FILE' before committing."
        EXIT_CODE=1
      fi
      ;;
  esac
done

if [ $EXIT_CODE -eq 0 ]; then
  # Scan staged files for plaintext secrets
  if command -v clef >/dev/null 2>&1; then
    clef scan --staged
    SCAN_EXIT=$?
    if [ $SCAN_EXIT -ne 0 ]; then
      echo ""
      echo "clef scan found potential secrets in staged files."
      echo "Review the findings above before committing."
      echo "To bypass (use with caution): git commit --no-verify"
      EXIT_CODE=1
    fi
  fi
fi

exit $EXIT_CODE
`;

/**
 * Wraps git operations: staging, committing, log, diff, status, and hook installation.
 *
 * @example
 * ```ts
 * const git = new GitIntegration(runner);
 * await git.stageFiles(["secrets/app/production.enc.yaml"], repoRoot);
 * const hash = await git.commit("chore(secrets): rotate production keys", repoRoot);
 * ```
 */
export class GitIntegration {
  constructor(private readonly runner: SubprocessRunner) {}

  /**
   * Stage one or more file paths with `git add`.
   *
   * @param filePaths - Paths to stage (relative or absolute).
   * @param repoRoot - Working directory for the git command.
   * @throws {@link GitOperationError} On failure.
   */
  async stageFiles(filePaths: string[], repoRoot: string): Promise<void> {
    if (filePaths.length === 0) return;

    const result = await this.runner.run("git", ["add", ...filePaths], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to stage files: ${result.stderr.trim()}`,
        "Check that the files exist and you are inside a git repository.",
      );
    }
  }

  /**
   * Create a commit with the given message.
   *
   * @param message - Commit message.
   * @param repoRoot - Working directory for the git command.
   * @param options - Optional commit options (env vars, no-verify).
   * @returns The full commit hash.
   * @throws {@link GitOperationError} On failure.
   */
  async commit(
    message: string,
    repoRoot: string,
    options?: { env?: Record<string, string>; noVerify?: boolean },
  ): Promise<string> {
    const args = ["commit", "-m", message];
    if (options?.noVerify) {
      args.push("--no-verify");
    }
    const result = await this.runner.run("git", args, {
      cwd: repoRoot,
      env: options?.env,
    });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to commit: ${result.stderr.trim()}`,
        "Ensure there are staged changes and your git user is configured.",
      );
    }

    // Get the full commit SHA via rev-parse for stable identification
    return this.getHead(repoRoot);
  }

  /**
   * Get the current HEAD commit SHA.
   *
   * @param repoRoot - Working directory for the git command.
   * @returns The full commit hash.
   * @throws {@link GitOperationError} On failure.
   */
  async getHead(repoRoot: string): Promise<string> {
    const result = await this.runner.run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to read HEAD: ${result.stderr.trim()}`,
        "Ensure there is at least one commit in the repository.",
      );
    }

    return result.stdout.trim();
  }

  /**
   * Reset HEAD and the working tree to a specific commit (`git reset --hard`).
   * Used by the transaction manager to roll back failed mutations.
   *
   * WARNING: this discards uncommitted changes in the working tree. Callers
   * must verify the working tree state before calling.
   *
   * @param repoRoot - Working directory for the git command.
   * @param sha - Commit SHA to reset to.
   * @throws {@link GitOperationError} On failure.
   */
  async resetHard(repoRoot: string, sha: string): Promise<void> {
    const result = await this.runner.run("git", ["reset", "--hard", sha], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to reset to ${sha}: ${result.stderr.trim()}`,
        "The repository may be in an inconsistent state. Inspect with 'git status'.",
      );
    }
  }

  /**
   * Remove untracked files matching the given paths (`git clean -fd <paths>`).
   * Scoped to the declared paths so unrelated untracked files are preserved.
   *
   * @param repoRoot - Working directory for the git command.
   * @param paths - Paths to clean (relative to repoRoot).
   * @throws {@link GitOperationError} On failure.
   */
  async cleanFiles(repoRoot: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const result = await this.runner.run("git", ["clean", "-fd", "--", ...paths], {
      cwd: repoRoot,
    });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to clean files: ${result.stderr.trim()}`,
        "Inspect with 'git status' and clean up manually.",
      );
    }
  }

  /**
   * Check whether the working tree has uncommitted changes (staged or unstaged).
   *
   * @param repoRoot - Working directory for the git command.
   * @returns True if there are uncommitted changes.
   * @throws {@link GitOperationError} On failure.
   */
  async isDirty(repoRoot: string): Promise<boolean> {
    // git diff-index --quiet HEAD checks both staged and unstaged changes
    // against HEAD. Exit 0 = clean, exit 1 = dirty, anything else = error.
    const result = await this.runner.run("git", ["diff-index", "--quiet", "HEAD", "--"], {
      cwd: repoRoot,
    });

    if (result.exitCode === 0) return false;
    if (result.exitCode === 1) return true;

    throw new GitOperationError(
      `Failed to check working tree status: ${result.stderr.trim()}`,
      "Ensure you are inside a git repository with at least one commit.",
    );
  }

  /**
   * Check whether the repository is in the middle of a multi-step git operation
   * (merge, rebase, cherry-pick, revert). Mutating during these operations is
   * dangerous because rollback via `git reset --hard` would corrupt them.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @returns The kind of operation in progress, or null if none.
   */
  async isMidOperation(
    repoRoot: string,
  ): Promise<{ midOp: boolean; kind?: "merge" | "rebase" | "cherry-pick" | "revert" }> {
    const gitDir = path.join(repoRoot, ".git");

    if (fs.existsSync(path.join(gitDir, "MERGE_HEAD"))) {
      return { midOp: true, kind: "merge" };
    }
    if (
      fs.existsSync(path.join(gitDir, "rebase-merge")) ||
      fs.existsSync(path.join(gitDir, "rebase-apply"))
    ) {
      return { midOp: true, kind: "rebase" };
    }
    if (fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      return { midOp: true, kind: "cherry-pick" };
    }
    if (fs.existsSync(path.join(gitDir, "REVERT_HEAD"))) {
      return { midOp: true, kind: "revert" };
    }

    return { midOp: false };
  }

  /**
   * Check whether the directory is inside a git repository.
   *
   * @param repoRoot - Working directory for the git command.
   * @returns True if `git rev-parse --git-dir` succeeds.
   */
  async isRepo(repoRoot: string): Promise<boolean> {
    const result = await this.runner.run("git", ["rev-parse", "--git-dir"], { cwd: repoRoot });
    return result.exitCode === 0;
  }

  /**
   * Check whether the user has configured a git author identity.
   * `git commit` will fail if either `user.name` or `user.email` is unset.
   *
   * @param repoRoot - Working directory for the git command.
   * @returns The configured name and email, or null if unset.
   */
  async getAuthorIdentity(repoRoot: string): Promise<{ name: string; email: string } | null> {
    const nameResult = await this.runner.run("git", ["config", "--get", "user.name"], {
      cwd: repoRoot,
    });
    const emailResult = await this.runner.run("git", ["config", "--get", "user.email"], {
      cwd: repoRoot,
    });

    const name = nameResult.exitCode === 0 ? nameResult.stdout.trim() : "";
    const email = emailResult.exitCode === 0 ? emailResult.stdout.trim() : "";

    if (!name || !email) return null;
    return { name, email };
  }

  /**
   * Retrieve recent commits for a specific file.
   *
   * @param filePath - Path to the file (relative to `repoRoot`).
   * @param repoRoot - Working directory for the git command.
   * @param limit - Maximum number of commits to return (default: 20).
   * @throws {@link GitOperationError} On failure.
   */
  async getLog(filePath: string, repoRoot: string, limit: number = 20): Promise<GitCommit[]> {
    const result = await this.runner.run(
      "git",
      ["log", `--max-count=${limit}`, "--format=%H|%an|%aI|%s", "--", filePath],
      { cwd: repoRoot },
    );

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to get git log for '${filePath}': ${result.stderr.trim()}`,
      );
    }

    if (!result.stdout.trim()) return [];

    return result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, author, dateStr, ...messageParts] = line.split("|");
        return {
          hash,
          author,
          date: new Date(dateStr),
          message: messageParts.join("|"),
        };
      });
  }

  /**
   * Get the staged diff (`git diff --cached`).
   *
   * @param repoRoot - Working directory for the git command.
   * @returns Raw diff output as a string.
   * @throws {@link GitOperationError} On failure.
   */
  async getDiff(repoRoot: string): Promise<string> {
    const result = await this.runner.run("git", ["diff", "--cached"], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(`Failed to get git diff: ${result.stderr.trim()}`);
    }

    return result.stdout;
  }

  /**
   * Of the given paths, return those that exist on disk but are untracked by git.
   *
   * Used by {@link TransactionManager} to refuse mutations whose declared paths
   * include untracked-but-existing files. Rollback uses `git reset --hard` to
   * restore content, which can only restore files that exist in a commit. An
   * untracked file in the declared paths would be silently destroyed by the
   * rollback's `git clean` — so we refuse upfront.
   *
   * @param repoRoot - Working directory for the git command.
   * @param paths - Paths to check (relative to repoRoot).
   * @returns Subset of `paths` that are untracked. Non-existent paths are
   *          excluded; tracked paths are excluded; directories are reported by
   *          their porcelain entry (with trailing slash if untracked-as-dir).
   * @throws {@link GitOperationError} On failure.
   */
  async getUntrackedAmongPaths(repoRoot: string, paths: string[]): Promise<string[]> {
    if (paths.length === 0) return [];

    const result = await this.runner.run("git", ["status", "--porcelain", "--", ...paths], {
      cwd: repoRoot,
    });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to check tracked status: ${result.stderr.trim()}`,
        "Inspect with 'git status' and resolve any repository errors.",
      );
    }

    const untracked: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line === "") continue;
      if (line[0] === "?") {
        untracked.push(line.substring(3));
      }
    }
    return untracked;
  }

  /**
   * Parse `git status --porcelain` into staged, unstaged, and untracked lists.
   *
   * @param repoRoot - Working directory for the git command.
   * @throws {@link GitOperationError} On failure.
   */
  async getStatus(repoRoot: string): Promise<GitStatus> {
    const result = await this.runner.run("git", ["status", "--porcelain"], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(`Failed to get git status: ${result.stderr.trim()}`);
    }

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    if (!result.stdout) {
      return { staged, unstaged, untracked };
    }

    // Porcelain v1 format: `XY filename`. The status code XY is exactly
    // 2 chars (X=index, Y=worktree); either may be a space when no change
    // applies on that side. The filename starts at column 3 (after XY +
    // separator space).
    //
    // Critical: do NOT call .trim() on the whole stdout — that strips the
    // leading space when X is empty, shifting the line by one and corrupting
    // both the status read and the filename parse. Split first, drop empty
    // lines (including the trailing one from the final newline), leave each
    // line's columns intact.
    for (const line of result.stdout.split("\n")) {
      if (line === "") continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.substring(3);

      if (indexStatus === "?") {
        untracked.push(filePath);
      } else {
        if (indexStatus !== " " && indexStatus !== "?") {
          staged.push(filePath);
        }
        if (workTreeStatus !== " " && workTreeStatus !== "?") {
          unstaged.push(filePath);
        }
      }
    }

    return { staged, unstaged, untracked };
  }

  /**
   * Configure the SOPS-aware git merge driver so that encrypted files
   * are merged at the plaintext level instead of producing ciphertext conflicts.
   *
   * Sets two things:
   * 1. `.gitattributes` — tells git which files use the custom driver.
   * 2. `.git/config [merge "sops"]` — tells git what command to run.
   *
   * Both operations are idempotent — safe to call repeatedly.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @throws {@link GitOperationError} On failure.
   */
  async installMergeDriver(repoRoot: string): Promise<void> {
    // Register two separately-named drivers that both dispatch to the same
    // CLI entry point (`clef merge-driver`).  The CLI branches by file
    // extension: `.enc.*` → SOPS decrypt/merge/re-encrypt; `.clef-meta.yaml`
    // → plaintext three-way merge.  Two driver names rather than one
    // reused name keeps `.gitattributes` honest (no file claiming to use
    // a "sops" driver when it's really metadata merging).
    const drivers: Array<{ config: string; friendly: string }> = [
      { config: "merge.sops", friendly: "SOPS-aware merge driver" },
      { config: "merge.clef-metadata", friendly: "Clef metadata merge driver" },
    ];

    for (const driver of drivers) {
      const nameResult = await this.runner.run(
        "git",
        ["config", `${driver.config}.name`, driver.friendly],
        { cwd: repoRoot },
      );
      if (nameResult.exitCode !== 0) {
        throw new GitOperationError(
          `Failed to configure merge driver name: ${nameResult.stderr.trim()}`,
          "Ensure you are inside a git repository.",
        );
      }

      const driverResult = await this.runner.run(
        "git",
        ["config", `${driver.config}.driver`, "clef merge-driver %O %A %B"],
        { cwd: repoRoot },
      );
      if (driverResult.exitCode !== 0) {
        throw new GitOperationError(
          `Failed to configure merge driver command: ${driverResult.stderr.trim()}`,
          "Ensure you are inside a git repository.",
        );
      }
    }

    await this.ensureGitattributes(repoRoot);
  }

  /**
   * Check whether both Clef merge drivers are configured in `.git/config`
   * and `.gitattributes`.  Reports separately on the SOPS driver
   * (`merge=sops` for `.enc.*`) and the metadata driver
   * (`merge=clef-metadata` for `.clef-meta.yaml`) so `clef doctor` can
   * prompt the user to run `clef hooks` when only the SOPS driver is
   * installed (older install, pre-metadata-merge).
   */
  async checkMergeDriver(repoRoot: string): Promise<{
    gitConfig: boolean;
    gitattributes: boolean;
    metadataGitConfig: boolean;
    metadataGitattributes: boolean;
  }> {
    const sopsConfig = await this.runner.run("git", ["config", "--get", "merge.sops.driver"], {
      cwd: repoRoot,
    });
    const gitConfig = sopsConfig.exitCode === 0 && sopsConfig.stdout.trim().length > 0;

    const metaConfig = await this.runner.run(
      "git",
      ["config", "--get", "merge.clef-metadata.driver"],
      { cwd: repoRoot },
    );
    const metadataGitConfig = metaConfig.exitCode === 0 && metaConfig.stdout.trim().length > 0;

    const attrFilePath = path.join(repoRoot, ".gitattributes");
    const attrContent = fs.existsSync(attrFilePath) ? fs.readFileSync(attrFilePath, "utf-8") : "";
    const gitattributes = attrContent.includes("merge=sops");
    const metadataGitattributes = attrContent.includes("merge=clef-metadata");

    return { gitConfig, gitattributes, metadataGitConfig, metadataGitattributes };
  }

  private async ensureGitattributes(repoRoot: string): Promise<void> {
    const attrPath = path.join(repoRoot, ".gitattributes");
    const existing = fs.existsSync(attrPath) ? fs.readFileSync(attrPath, "utf-8") : "";

    // Append whichever rule blocks are missing; idempotent across runs
    // and survives users adding their own entries between our blocks.
    let newContent = existing;
    if (!existing.includes("merge=sops")) {
      const block = `# Clef: SOPS-aware merge driver for encrypted files\n*.enc.yaml merge=sops\n*.enc.json merge=sops\n`;
      newContent = newContent.trimEnd() ? `${newContent.trimEnd()}\n\n${block}` : block;
    }
    if (!newContent.includes("merge=clef-metadata")) {
      const block = `# Clef: rotation-aware merge driver for metadata sidecars\n*.clef-meta.yaml merge=clef-metadata\n`;
      newContent = newContent.trimEnd() ? `${newContent.trimEnd()}\n\n${block}` : block;
    }

    if (newContent === existing) return; // already fully configured

    try {
      fs.writeFileSync(attrPath, newContent, "utf-8");
    } catch (err) {
      throw new GitOperationError(`Failed to write .gitattributes: ${(err as Error).message}`);
    }
  }

  /**
   * Write and chmod the Clef pre-commit hook into `.git/hooks/pre-commit`.
   * The hook blocks commits of unencrypted matrix files and scans staged files for secrets.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @throws {@link GitOperationError} On failure.
   */
  async installPreCommitHook(repoRoot: string): Promise<void> {
    const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");

    try {
      const hooksDir = path.dirname(hookPath);
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }
      fs.writeFileSync(hookPath, PRE_COMMIT_HOOK, { mode: 0o755 });
    } catch (err) {
      throw new GitOperationError(
        `Failed to install pre-commit hook: ${(err as Error).message}`,
        "Ensure .git/hooks/ directory exists.",
      );
    }
  }
}
