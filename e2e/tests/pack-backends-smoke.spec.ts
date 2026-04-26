/**
 * Blackbox E2E test for `clef pack --backend <id>` covering the bundled
 * plugin set.
 *
 * Why this exists: the official AWS pack plugins (@clef-sh/pack-aws-parameter-store,
 * @clef-sh/pack-aws-secrets-manager) are aliased and inlined by esbuild
 * at SEA build time so that SEA users get `--backend aws-parameter-store`
 * /  `--backend aws-secrets-manager` without an extra install. Unit tests
 * cover the registry wiring; this file is the only thing that confirms
 * the alias actually resolved at build time and the plugin code is
 * loadable from inside the SEA binary at runtime.
 *
 * The check is deterministic and credential-free: invoke each backend
 * with intentionally missing required options and assert that the
 * plugin's own validateOptions() rejected it (proving the plugin code
 * ran). A "Unknown pack backend" error in the output would mean the
 * resolver couldn't find the backend — a clear bundling regression.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";
import { type AgeKeyPair, generateAgeKey } from "../setup/keys";
import { type TestRepo, scaffoldTestRepo } from "../setup/repo";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SEA_BINARY = path.join(REPO_ROOT, "packages/cli/dist/clef");
const NODE_ENTRY = path.join(REPO_ROOT, "packages/cli/bin/clef.js");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function resolveClefBin(): { command: string; prefixArgs: string[] } {
  const mode = (process.env.CLEF_E2E_MODE ?? "sea") as "sea" | "node";
  if (mode === "node") {
    if (!fs.existsSync(NODE_ENTRY)) {
      throw new Error(
        `CLI entry not found at ${NODE_ENTRY}. Build first: npm run build -w packages/cli`,
      );
    }
    return { command: process.execPath, prefixArgs: [NODE_ENTRY] };
  }
  const bin = process.platform === "win32" ? SEA_BINARY + ".exe" : SEA_BINARY;
  if (!fs.existsSync(bin)) {
    throw new Error(
      `SEA binary not found at ${bin}. Build it first: npm run build:sea -w packages/cli`,
    );
  }
  return { command: bin, prefixArgs: [] };
}

function runClef(cwd: string, args: string[], extraEnv: Record<string, string> = {}): SpawnResult {
  const { command, prefixArgs } = resolveClefBin();
  try {
    const stdout = execFileSync(command, [...prefixArgs, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      exitCode: e.status ?? 1,
    };
  }
}

let keys: AgeKeyPair;
let siKeys: AgeKeyPair;
let repo: TestRepo;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  siKeys = await generateAgeKey();
  repo = scaffoldTestRepo(keys, siKeys);
});

test.afterAll(() => {
  if (repo) repo.cleanup();
  for (const k of [keys, siKeys]) {
    if (k?.tmpDir) {
      try {
        fs.rmSync(k.tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
});

test.describe("clef pack --backend (SEA): bundled plugins are loadable", () => {
  test("[positive] aws-parameter-store backend is resolved from the SEA registry", () => {
    // Intentionally omit `--backend-opt prefix=...` so the plugin's
    // validateOptions runs and rejects with its own specific message.
    // If the SEA bundling were broken, we'd see "Unknown pack backend"
    // or the npm install hint instead.
    const result = runClef(
      repo.dir,
      ["pack", "web-app", "dev", "--backend", "aws-parameter-store"],
      { SOPS_AGE_KEY_FILE: keys.keyFilePath },
    );

    expect(result.exitCode).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;

    // Plugin code reached and ran:
    expect(combined).toMatch(/aws-parameter-store/);
    expect(combined).toMatch(/requires 'prefix'/);

    // Resolver did NOT fall through to "not installed":
    expect(combined).not.toMatch(/Unknown pack backend/);
    expect(combined).not.toMatch(/npm install/);
  });

  test("[positive] aws-secrets-manager backend is resolved from the SEA registry", () => {
    const result = runClef(
      repo.dir,
      ["pack", "web-app", "dev", "--backend", "aws-secrets-manager"],
      { SOPS_AGE_KEY_FILE: keys.keyFilePath },
    );

    expect(result.exitCode).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;

    expect(combined).toMatch(/aws-secrets-manager/);
    expect(combined).toMatch(/requires 'prefix'/);

    expect(combined).not.toMatch(/Unknown pack backend/);
    expect(combined).not.toMatch(/npm install/);
  });

  test("[negative] unknown backend id surfaces the install hint (resolver fall-through still works)", () => {
    // Confirms the dynamic-resolver path still functions for non-bundled
    // ids — community plugins (clef-pack-<id>) need this to keep working.
    const result = runClef(
      repo.dir,
      ["pack", "web-app", "dev", "--backend", "definitely-not-a-real-backend"],
      { SOPS_AGE_KEY_FILE: keys.keyFilePath },
    );

    expect(result.exitCode).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/Unknown pack backend|Cannot find package|Cannot find module/);
  });
});
