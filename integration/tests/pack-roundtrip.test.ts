/**
 * Integration test for `clef pack`.
 *
 * Exercises the full flow end-to-end with a real SOPS binary, real age
 * encryption, and the CLI invoked as a subprocess (no in-process mocks).
 *
 * Covers the pack backend seam introduced in the 0.2 series:
 *   - Default `json-envelope` backend produces a valid PackedArtifact JSON
 *   - `--backend <id>` flag accepts the explicit default
 *   - `--backend unknown-x` errors cleanly
 *   - `--backend-opt key=value` is parsed, passed through, and does not
 *     break the default backend (which ignores unknown keys)
 *   - `--backend-opt` with multiple keys, values containing `=`, and
 *     malformed input
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
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

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runClef(args: string[], opts: { expectFailure?: boolean } = {}): SpawnResult {
  try {
    const stdout = execFileSync("node", [clefBin, ...args], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
      encoding: "utf-8",
    });
    if (opts.expectFailure) {
      throw new Error(`Expected command to fail but it succeeded. stdout:\n${stdout}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    if (!opts.expectFailure) {
      throw err;
    }
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      exitCode: e.status ?? 1,
    };
  }
}

describe("clef pack roundtrip", () => {
  it("produces a valid PackedArtifact JSON for an age service identity", () => {
    const artifactPath = path.join(repo.dir, "artifact.json");
    runClef(["pack", "web-app", "dev", "--output", artifactPath]);

    expect(fs.existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("web-app");
    expect(artifact.environment).toBe("dev");
    expect(artifact.revision).toMatch(/^\d+-[0-9a-f]{8}$/);
    expect(typeof artifact.ciphertext).toBe("string");
    expect(artifact.ciphertext.length).toBeGreaterThan(0);

    // Plaintext secrets must not appear anywhere in the written file.
    const rawContent = fs.readFileSync(artifactPath, "utf-8");
    expect(rawContent).not.toContain("sk_test_abc123");
    expect(rawContent).not.toContain("whsec_xyz789");
  });

  it("accepts explicit --backend json-envelope", () => {
    const artifactPath = path.join(repo.dir, "artifact-explicit.json");
    runClef(["pack", "web-app", "dev", "--backend", "json-envelope", "--output", artifactPath]);

    expect(fs.existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    expect(artifact.identity).toBe("web-app");
  });

  it("errors cleanly when --backend is unknown", () => {
    const result = runClef(
      ["pack", "web-app", "dev", "--backend", "not-real", "--output", "/tmp/ignored.json"],
      { expectFailure: true },
    );

    expect(result.exitCode).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Unknown pack backend "not-real"/);
    expect(combined).toMatch(/Available backends: json-envelope/);
  });

  it("accepts --backend-opt key=value without breaking the default backend", () => {
    const artifactPath = path.join(repo.dir, "artifact-with-opts.json");
    runClef([
      "pack",
      "web-app",
      "dev",
      "--output",
      artifactPath,
      "--backend-opt",
      "path=secret/data/myapp/dev",
      "--backend-opt",
      "namespace=team-a",
    ]);

    expect(fs.existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    // The json-envelope backend ignores unknown keys. The artifact shape is
    // unchanged from the no-opts case.
    expect(artifact.version).toBe(1);
    expect(artifact.identity).toBe("web-app");
  });

  it("preserves '=' inside --backend-opt values", () => {
    const artifactPath = path.join(repo.dir, "artifact-eq.json");
    runClef(["pack", "web-app", "dev", "--output", artifactPath, "--backend-opt", "query=a=1&b=2"]);

    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it("errors cleanly when --backend-opt is malformed", () => {
    const result = runClef(
      [
        "pack",
        "web-app",
        "dev",
        "--output",
        "/tmp/ignored.json",
        "--backend-opt",
        "missing-equals-sign",
      ],
      { expectFailure: true },
    );

    expect(result.exitCode).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Invalid --backend-opt format/);
  });
});
