import { execFile } from "child_process";
import { SubprocessOptions, SubprocessResult, SubprocessRunner } from "@clef-sh/core";

export class NodeSubprocessRunner implements SubprocessRunner {
  async run(
    command: string,
    args: string[],
    options?: SubprocessOptions,
  ): Promise<SubprocessResult> {
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
}
