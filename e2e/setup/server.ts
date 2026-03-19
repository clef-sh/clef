import { spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SEA_BINARY = path.join(REPO_ROOT, "packages/cli/dist/clef");
const NODE_ENTRY = path.join(REPO_ROOT, "packages/cli/bin/clef.js");

export interface ServerInfo {
  /** Full tokenized URL, e.g. http://127.0.0.1:49321?token=<hex> */
  url: string;
  stop: () => Promise<void>;
}

/** Find an available TCP port on the loopback interface. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Spawn `clef ui` and wait for the tokenized URL.
 *
 * Two modes controlled by `CLEF_E2E_MODE`:
 *   - `"sea"` (default): uses the SEA binary at packages/cli/dist/clef
 *   - `"node"`:           uses `node packages/cli/bin/clef.js`
 *
 * @param repoDir   Path to the scaffolded Clef test repository.
 * @param ageKeyFilePath  Path to the age key file for SOPS decryption.
 */
export async function startClefUI(repoDir: string, ageKeyFilePath: string): Promise<ServerInfo> {
  const mode = (process.env.CLEF_E2E_MODE ?? "sea") as "sea" | "node";

  let command: string;
  let args: string[];

  if (mode === "node") {
    if (!fs.existsSync(NODE_ENTRY)) {
      throw new Error(
        `CLI entry not found at ${NODE_ENTRY}.\n` +
          `Build first: npm run build -w packages/core && npm run build -w packages/ui && npm run build -w packages/cli`,
      );
    }
    command = process.execPath; // node
    args = [NODE_ENTRY, "--dir", repoDir, "ui", "--no-open", "--port"];
  } else {
    const bin = process.platform === "win32" ? SEA_BINARY + ".exe" : SEA_BINARY;
    if (!fs.existsSync(bin)) {
      throw new Error(
        `SEA binary not found at ${bin}.\n` + `Build it first: npm run build:sea -w packages/cli`,
      );
    }
    command = bin;
    args = ["--dir", repoDir, "ui", "--no-open", "--port"];
  }

  const port = await findFreePort();
  args.push(String(port));

  return new Promise<ServerInfo>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: repoDir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: ageKeyFilePath,
        // Suppress browser auto-open warning on headless environments.
        CI: "1",
      },
      // stdin must be "pipe" (not "ignore") so that /dev/stdin is valid inside
      // the process tree. On Linux /dev/stdin → /proc/self/fd/0; if fd 0 is
      // closed, sops encrypt fails with ENXIO when it opens /dev/stdin.
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBuf = "";

    const tryResolve = (text: string): void => {
      // The cli prints: "  🔒  URL   http://127.0.0.1:<port>?token=<64-hex-chars>"
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\?token=[0-9a-f]+/);
      if (match && !settled) {
        settled = true;
        resolve({
          url: match[0],
          stop: () =>
            new Promise<void>((res) => {
              proc.kill("SIGTERM");
              proc.once("exit", () => res());
            }),
        });
      }
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      tryResolve(stdoutBuf);
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`clef ui exited prematurely with code ${code ?? "unknown"}`));
      }
    });

    // Safety timeout: if the server doesn't print its URL within 30 s, fail.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error("clef ui did not print its URL within 30 seconds"));
      }
    }, 30_000);

    // Don't hold the event loop open just for the timeout.
    timeout.unref();
  });
}
