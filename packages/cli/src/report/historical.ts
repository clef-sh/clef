import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  ClefReport,
  MatrixManager,
  ReportGenerator,
  SchemaValidator,
  SopsClient,
  SubprocessRunner,
} from "@clef-sh/core";

/**
 * Generate a {@link ClefReport} at a specific commit by creating a temporary
 * git worktree, running the report generator, and cleaning up.
 */
export async function generateReportAtCommit(
  repoRoot: string,
  commitSha: string,
  clefVersion: string,
  runner: SubprocessRunner,
): Promise<ClefReport> {
  const tmpDir = path.join(os.tmpdir(), `clef-report-${commitSha.slice(0, 8)}-${Date.now()}`);

  try {
    // Create detached worktree at the target commit
    const addResult = await runner.run("git", ["worktree", "add", tmpDir, commitSha, "--detach"], {
      cwd: repoRoot,
    });
    if (addResult.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${addResult.stderr}`);
    }

    // Create sops client — resolveSopsPath is called internally by SopsClient
    const sopsClient = new SopsClient(runner);
    const matrixManager = new MatrixManager();
    const schemaValidator = new SchemaValidator();
    const generator = new ReportGenerator(runner, sopsClient, matrixManager, schemaValidator);

    return await generator.generate(tmpDir, clefVersion);
  } finally {
    // Always clean up the worktree
    try {
      await runner.run("git", ["worktree", "remove", tmpDir, "--force"], { cwd: repoRoot });
    } catch {
      // Best-effort cleanup — if remove fails, try manual deletion
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        await runner.run("git", ["worktree", "prune"], { cwd: repoRoot });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * List commit SHAs in the range `(fromSha, HEAD]`, oldest first.
 */
export async function listCommitRange(
  repoRoot: string,
  fromSha: string,
  runner: SubprocessRunner,
): Promise<string[]> {
  const result = await runner.run("git", ["log", "--format=%H", "--reverse", `${fromSha}..HEAD`], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list commit range: ${result.stderr}`);
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * Get the SHA of the current HEAD commit.
 */
export async function getHeadSha(repoRoot: string, runner: SubprocessRunner): Promise<string> {
  const result = await runner.run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get HEAD sha: ${result.stderr}`);
  }
  return result.stdout.trim();
}
