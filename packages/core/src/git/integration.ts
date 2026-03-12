import * as path from "path";
import { GitCommit, GitOperationError, GitStatus, SubprocessRunner } from "../types";

const PRE_COMMIT_HOOK = `#!/bin/sh
# Clef pre-commit hook — blocks commits of files missing SOPS encryption metadata
# and scans staged files for plaintext secrets.
# Installed by: clef hooks install

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
   * @returns The short commit hash, or an empty string if parsing fails.
   * @throws {@link GitOperationError} On failure.
   */
  async commit(message: string, repoRoot: string): Promise<string> {
    const result = await this.runner.run("git", ["commit", "-m", message], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to commit: ${result.stderr.trim()}`,
        "Ensure there are staged changes and your git user is configured.",
      );
    }

    // Extract commit hash from output
    const hashMatch = result.stdout.match(/\[[\w/-]+ ([a-f0-9]+)\]/);
    return hashMatch ? hashMatch[1] : "";
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

    if (!result.stdout.trim()) {
      return { staged, unstaged, untracked };
    }

    for (const line of result.stdout.trim().split("\n")) {
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
    // 1. Configure git merge driver in local config
    const configResult = await this.runner.run(
      "git",
      ["config", "merge.sops.name", "SOPS-aware merge driver"],
      { cwd: repoRoot },
    );
    if (configResult.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to configure merge driver name: ${configResult.stderr.trim()}`,
        "Ensure you are inside a git repository.",
      );
    }

    const driverResult = await this.runner.run(
      "git",
      ["config", "merge.sops.driver", "clef merge-driver %O %A %B"],
      { cwd: repoRoot },
    );
    if (driverResult.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to configure merge driver command: ${driverResult.stderr.trim()}`,
        "Ensure you are inside a git repository.",
      );
    }

    // 2. Ensure .gitattributes contains the rule
    await this.ensureGitattributes(repoRoot);
  }

  /**
   * Check whether the SOPS merge driver is configured in both
   * `.git/config` and `.gitattributes`.
   *
   * @param repoRoot - Absolute path to the repository root.
   * @returns An object indicating which parts are configured.
   */
  async checkMergeDriver(
    repoRoot: string,
  ): Promise<{ gitConfig: boolean; gitattributes: boolean }> {
    // Check git config
    const configResult = await this.runner.run("git", ["config", "--get", "merge.sops.driver"], {
      cwd: repoRoot,
    });
    const gitConfig = configResult.exitCode === 0 && configResult.stdout.trim().length > 0;

    // Check .gitattributes
    const catResult = await this.runner.run("cat", [path.join(repoRoot, ".gitattributes")]);
    const gitattributes = catResult.exitCode === 0 && catResult.stdout.includes("merge=sops");

    return { gitConfig, gitattributes };
  }

  private async ensureGitattributes(repoRoot: string): Promise<void> {
    const attrPath = path.join(repoRoot, ".gitattributes");
    const mergeRule = "*.enc.yaml merge=sops\n*.enc.json merge=sops";

    // Read existing content
    const catResult = await this.runner.run("cat", [attrPath]);
    const existing = catResult.exitCode === 0 ? catResult.stdout : "";

    if (existing.includes("merge=sops")) {
      return; // Already configured
    }

    const newContent = existing.trimEnd()
      ? `${existing.trimEnd()}\n\n# Clef: SOPS-aware merge driver for encrypted files\n${mergeRule}\n`
      : `# Clef: SOPS-aware merge driver for encrypted files\n${mergeRule}\n`;

    const writeResult = await this.runner.run("tee", [attrPath], {
      stdin: newContent,
      cwd: repoRoot,
    });

    if (writeResult.exitCode !== 0) {
      throw new GitOperationError(`Failed to write .gitattributes: ${writeResult.stderr.trim()}`);
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

    // Write the hook using the subprocess runner to avoid direct fs writes in the integration
    const result = await this.runner.run("tee", [hookPath], {
      stdin: PRE_COMMIT_HOOK,
      cwd: repoRoot,
    });

    if (result.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to install pre-commit hook: ${result.stderr.trim()}`,
        "Ensure .git/hooks/ directory exists.",
      );
    }

    // Make it executable
    const chmodResult = await this.runner.run("chmod", ["+x", hookPath], { cwd: repoRoot });

    if (chmodResult.exitCode !== 0) {
      throw new GitOperationError(
        `Failed to make pre-commit hook executable: ${chmodResult.stderr.trim()}`,
      );
    }
  }
}
