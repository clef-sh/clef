/**
 * Integration test for `clef serve` — exercises the full real flow:
 * spawn the CLI binary, pack with real SOPS + age, decrypt with the
 * synthesized ephemeral key, start the HTTP server, fetch /v1/secrets
 * with the bearer token, and verify the secret values.
 *
 * This test catches the bug where `clef serve` packed an artifact
 * encrypted to the production service identity's public key, then tried
 * to decrypt with the user's personal age key. The unit tests mocked
 * ArtifactDecryptor to always succeed and never noticed.
 */
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys, { includeServiceIdentity: true });
  } catch (err) {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
    repo?.cleanup();
    throw err;
  }
});

afterAll(() => {
  try {
    repo?.cleanup();
  } finally {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

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

interface ServeHandle {
  port: number;
  token: string;
  proc: ChildProcessWithoutNullStreams;
}

/**
 * Spawn `clef serve` and wait for it to print its bearer token.
 */
async function startServe(): Promise<ServeHandle> {
  const port = await findFreePort();

  const proc = spawn(
    process.execPath,
    [
      clefBin,
      "--dir",
      repo.dir,
      "serve",
      "--identity",
      "web-app",
      "--env",
      "dev",
      "--port",
      String(port),
    ],
    {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return new Promise<ServeHandle>((resolve, reject) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const tryResolve = (): void => {
      if (settled) return;
      // serve.ts prints "Token:    <hex>" — capture the hex token.
      const match = stdoutBuf.match(/Token:\s+([0-9a-f]{64})/);
      if (match) {
        settled = true;
        resolve({ port, token: match[1], proc });
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      tryResolve();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
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
            `clef serve exited prematurely with code ${code ?? "?"}\n` +
              `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
          ),
        );
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(
          new Error(
            `clef serve did not print its token within 20s\n` +
              `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
          ),
        );
      }
    }, 20_000).unref();
  });
}

async function stopServe(handle: ServeHandle): Promise<void> {
  return new Promise((resolve) => {
    handle.proc.once("exit", () => resolve());
    handle.proc.kill("SIGTERM");
    // Belt-and-suspenders: hard kill after 5s
    setTimeout(() => handle.proc.kill("SIGKILL"), 5_000).unref();
  });
}

describe("clef serve roundtrip", () => {
  let handle: ServeHandle;

  beforeAll(async () => {
    handle = await startServe();
  }, 30_000);

  afterAll(async () => {
    if (handle) await stopServe(handle);
  });

  it("returns decrypted secrets via /v1/secrets with the bearer token", async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/secrets`, {
      headers: { Authorization: `Bearer ${handle.token}` },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, Record<string, string>>;
    expect(body).toEqual({
      payments: {
        STRIPE_KEY: "sk_test_abc123",
        STRIPE_WEBHOOK_SECRET: "whsec_xyz789",
      },
    });
  });

  it("rejects requests without a bearer token", async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/secrets`);
    expect(response.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/secrets`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(response.status).toBe(401);
  });

  it("serves the same value via /v1/keys", async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/keys`, {
      headers: { Authorization: `Bearer ${handle.token}` },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as string[];
    expect(body.sort()).toEqual(["payments__STRIPE_KEY", "payments__STRIPE_WEBHOOK_SECRET"]);
  });
});
