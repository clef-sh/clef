import * as os from "os";
import * as path from "path";
import { execFileSync, spawn } from "child_process";
import type { SubprocessRunner } from "../types";

/**
 * On Linux, libuv creates pipes for child stdio. SOPS (Go) translates
 * `/dev/stdin` through `/proc/self/fd/0` and tries to re-open it by path,
 * which fails with ENXIO ("no such device or address") because pipes
 * cannot be re-opened by path.
 *
 * Workaround: when SopsClient asks the runner to spawn `sops` with
 * `/dev/stdin` in the args AND content piped via the runner's stdin,
 * substitute a Linux FIFO (named pipe). FIFOs are openable by path —
 * the bytes still live in an in-memory kernel buffer (not on disk), so
 * the no-plaintext-to-disk invariant is preserved.
 *
 * Gated on `process.platform === "linux"` and the absence of
 * `JEST_WORKER_ID` — unit tests mock `SubprocessRunner` and never
 * spawn a real SOPS binary, so the FIFO machinery would only add
 * subprocess overhead with no benefit. Callers that genuinely need the
 * workaround inside a Jest-spawned child (e.g. the CDK pack-helper
 * subprocess) must scrub `JEST_WORKER_ID` from the child's env so this
 * gate fires correctly.
 */
export function shouldUseLinuxStdinFifo(): boolean {
  return process.platform === "linux" && !process.env.JEST_WORKER_ID;
}

/**
 * Wrap a `SubprocessRunner` so that any call carrying both `/dev/stdin`
 * in `args` and a non-empty `opts.stdin` payload is rewritten to use a
 * Linux FIFO. On platforms where the workaround isn't needed (or in
 * unit tests), returns the input runner unchanged so the wrapper costs
 * nothing.
 */
export function wrapWithLinuxStdinFifo(runner: SubprocessRunner): SubprocessRunner {
  if (!shouldUseLinuxStdinFifo()) return runner;

  return {
    run: (cmd, args, opts) => {
      const stdinIdx = args.indexOf("/dev/stdin");
      if (stdinIdx < 0 || opts?.stdin === undefined) {
        return runner.run(cmd, args, opts);
      }

      const fifoDir = execFileSync("mktemp", ["-d", path.join(os.tmpdir(), "clef-fifo-XXXXXX")])
        .toString()
        .trim();
      const fifoPath = path.join(fifoDir, "input");
      execFileSync("mkfifo", [fifoPath]);

      // Background writer — blocks at the OS level until SOPS opens the
      // read end. `dd` is preferred over a Node writer because it
      // detaches cleanly and doesn't tie up the event loop.
      const writer = spawn("dd", [`of=${fifoPath}`, "status=none"], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      writer.stdin.write(opts.stdin);
      writer.stdin.end();

      const patchedArgs = [...args];
      patchedArgs[stdinIdx] = fifoPath;

      const { stdin: _stdin, ...restOpts } = opts;

      return runner.run(cmd, patchedArgs, restOpts).finally(() => {
        try {
          writer.kill();
        } catch {
          /* already exited */
        }
        try {
          execFileSync("rm", ["-rf", fifoDir]);
        } catch {
          /* best effort */
        }
      });
    },
  };
}
