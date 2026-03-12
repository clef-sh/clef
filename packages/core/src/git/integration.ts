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

export class GitIntegration {
  constructor(private readonly runner: SubprocessRunner) {}

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

  async getDiff(repoRoot: string): Promise<string> {
    const result = await this.runner.run("git", ["diff", "--cached"], { cwd: repoRoot });

    if (result.exitCode !== 0) {
      throw new GitOperationError(`Failed to get git diff: ${result.stderr.trim()}`);
    }

    return result.stdout;
  }

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
