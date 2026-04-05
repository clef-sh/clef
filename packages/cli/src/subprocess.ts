import { execFile, execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SubprocessOptions, SubprocessResult, SubprocessRunner } from "@clef-sh/core";

// On Linux, SOPS opens /dev/stdin as a file path (/proc/self/fd/0).
// When fd 0 is a socketpair (common in CI and process pipes), the open
// fails with ENXIO or "no such device or address". Use a FIFO workaround.
const _useStdinFifo = process.platform === "linux";

export class NodeSubprocessRunner implements SubprocessRunner {
  async run(
    command: string,
    args: string[],
    options?: SubprocessOptions,
  ): Promise<SubprocessResult> {
    const stdinIdx = args.indexOf("/dev/stdin");
    const needsFifo = _useStdinFifo && stdinIdx >= 0 && options?.stdin !== undefined;

    if (needsFifo) {
      return this.runWithFifo(command, args, stdinIdx, options!);
    }

    return new Promise((resolve) => {
      const child = execFile(
        command,
        args,
        {
          cwd: options?.cwd,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error ? (error.code ? Number(error.code) : 1) : 0,
          });
        },
      );

      if (options?.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }

  private async runWithFifo(
    command: string,
    args: string[],
    stdinIdx: number,
    options: SubprocessOptions,
  ): Promise<SubprocessResult> {
    const fifoDir = execFileSync("mktemp", ["-d", path.join(os.tmpdir(), "clef-fifo-XXXXXX")])
      .toString()
      .trim();
    const fifoPath = path.join(fifoDir, "input");
    execFileSync("mkfifo", [fifoPath]);

    // Background writer — blocks at OS level until the reader opens the FIFO
    const writer = spawn("dd", [`of=${fifoPath}`, "status=none"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    writer.stdin.write(options.stdin!);
    writer.stdin.end();

    const patchedArgs = [...args];
    patchedArgs[stdinIdx] = fifoPath;

    try {
      return await new Promise((resolve) => {
        execFile(
          command,
          patchedArgs,
          {
            cwd: options.cwd,
            env: options.env ? { ...process.env, ...options.env } : undefined,
            maxBuffer: 10 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            resolve({
              stdout: stdout ?? "",
              stderr: stderr ?? "",
              exitCode: error ? (error.code ? Number(error.code) : 1) : 0,
            });
          },
        );
      });
    } finally {
      try {
        writer.kill();
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(fifoPath);
        fs.rmdirSync(fifoDir);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
