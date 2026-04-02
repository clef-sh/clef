/**
 * Manages the clef-keyservice sidecar lifecycle: spawn, port discovery, graceful shutdown.
 *
 * The keyservice binary is a localhost gRPC server that proxies KMS encrypt/decrypt
 * operations to the Cloud API. The CLI spawns it per command and kills it when done.
 */
import { spawn, type ChildProcess } from "child_process";
import * as readline from "readline";

export interface KeyserviceHandle {
  /** Address for SOPS --keyservice flag, e.g. "tcp://127.0.0.1:12345". */
  addr: string;
  /** Gracefully stop the keyservice process. */
  kill(): Promise<void>;
}

const PORT_REGEX = /^PORT=(\d+)$/;
const STARTUP_TIMEOUT_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * Spawn a clef-keyservice sidecar process and wait for it to report its port.
 *
 * @param options.binaryPath - Absolute path to the clef-keyservice binary.
 * @param options.token - Cloud bearer token for API authentication.
 * @param options.endpoint - Optional Cloud API endpoint override.
 * @returns A handle with the keyservice address and a kill function.
 */
export async function spawnKeyservice(options: {
  binaryPath: string;
  token: string;
  endpoint?: string;
}): Promise<KeyserviceHandle> {
  const args = ["--addr", "127.0.0.1:0"];
  if (options.endpoint) {
    args.push("--endpoint", options.endpoint);
  }

  // Token passed via env var, not CLI arg — CLI args are visible in /proc/<pid>/cmdline
  const child = spawn(options.binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLEF_CLOUD_TOKEN: options.token },
  });

  const port = await readPort(child);
  const addr = `tcp://127.0.0.1:${port}`;

  return {
    addr,
    kill: () => killGracefully(child),
  };
}

function readPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const rl = readline.createInterface({ input: child.stdout! });

    function settle() {
      clearTimeout(timer);
      rl.close();
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        settle();
        child.kill("SIGKILL");
        reject(new Error("Keyservice did not start within 5 seconds."));
      }
    }, STARTUP_TIMEOUT_MS);

    rl.on("line", (line) => {
      const match = PORT_REGEX.exec(line);
      if (match && !settled) {
        settled = true;
        settle();
        resolve(parseInt(match[1], 10));
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        settle();
        reject(new Error(`Failed to start keyservice: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        settle();
        reject(new Error(`Keyservice exited unexpectedly with code ${code}.`));
      }
    });
  });
}

function killGracefully(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, SHUTDOWN_TIMEOUT_MS);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
