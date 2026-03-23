/**
 * Spawns the agent as a real subprocess and waits for it to become ready.
 *
 * Two modes controlled by `CLEF_AGENT_E2E_MODE`:
 *   - `"sea"` (default): uses the SEA binary at packages/agent/dist/clef-agent
 *   - `"node"`:           uses `node packages/agent/dist/agent.cjs`
 *
 * Mirrors the pattern in e2e/setup/server.ts for the CLI UI tests.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const AGENT_PKG = path.join(REPO_ROOT, "packages/agent");
const SEA_BINARY = path.join(AGENT_PKG, "dist/clef-agent");
const NODE_ENTRY = path.join(AGENT_PKG, "dist/agent.cjs");

export interface AgentProcess {
  url: string;
  token: string;
  port: number;
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
 * Spawn the agent binary and wait for readiness.
 *
 * @param artifactPath  Path to the packed artifact JSON file.
 * @param agePrivateKey Inline age private key string.
 * @param options       Optional overrides (port, token, cacheTtl).
 */
export async function startAgent(
  artifactPath: string,
  agePrivateKey: string,
  options?: { port?: number; token?: string; cacheTtl?: number },
): Promise<AgentProcess> {
  const mode = (process.env.CLEF_AGENT_E2E_MODE ?? "node") as "sea" | "node";

  let command: string;
  let args: string[];

  if (mode === "sea") {
    const bin = process.platform === "win32" ? SEA_BINARY + ".exe" : SEA_BINARY;
    if (!fs.existsSync(bin)) {
      throw new Error(
        `SEA binary not found at ${bin}.\nBuild first: npm run build:sea -w packages/agent`,
      );
    }
    command = bin;
    args = [];
  } else {
    if (!fs.existsSync(NODE_ENTRY)) {
      throw new Error(
        `Agent entry not found at ${NODE_ENTRY}.\nBuild first: npm run build -w packages/agent`,
      );
    }
    command = process.execPath;
    args = [NODE_ENTRY];
  }

  const port = options?.port ?? (await findFreePort());
  const token = options?.token ?? "e2e-agent-token-" + Math.random().toString(36).slice(2);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CLEF_AGENT_SOURCE: artifactPath,
    CLEF_AGENT_AGE_KEY: agePrivateKey,
    CLEF_AGENT_PORT: String(port),
    CLEF_AGENT_TOKEN: token,
    NODE_NO_WARNINGS: "1",
  };
  if (options?.cacheTtl !== undefined) {
    env.CLEF_AGENT_CACHE_TTL = String(options.cacheTtl);
  }

  return new Promise<AgentProcess>((resolve, reject) => {
    const proc = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdoutBuf = "";
    let stderrBuf = "";

    // The agent prints "[clef-agent] token: <first8>..." when ready
    const tryResolve = (text: string): void => {
      if (text.includes("[clef-agent] token:") && !settled) {
        settled = true;

        // Swallow stdio errors after startup — on Windows, killing the
        // subprocess severs pipes immediately (TerminateProcess), causing
        // ECONNRESET / EPIPE on any buffered reads.
        proc.stdout!.on("error", () => {});
        proc.stderr!.on("error", () => {});
        proc.stdin!.on("error", () => {});

        resolve({
          url: `http://127.0.0.1:${port}`,
          token,
          port,
          stop: () =>
            new Promise<void>((res) => {
              proc.once("exit", () => res());
              proc.kill();
              // Force-resolve after 5s in case exit event never fires
              const timer = setTimeout(() => res(), 5000);
              timer.unref();
            }),
        });
      }
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      tryResolve(stdoutBuf);
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
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
        reject(
          new Error(
            `clef-agent exited prematurely with code ${code ?? "unknown"}.\nstderr: ${stderrBuf}\nstdout: ${stdoutBuf}`,
          ),
        );
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(
          new Error(
            `clef-agent did not become ready within 30s.\nstderr: ${stderrBuf}\nstdout: ${stdoutBuf}`,
          ),
        );
      }
    }, 30_000);
    timeout.unref();
  });
}
