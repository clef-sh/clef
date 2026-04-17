/**
 * Integration tests for per-key rotation records.  These exercise the
 * real CLI (node + built dist) against a real git repo with real sops
 * binaries, so they validate the full flow that unit tests can't:
 * transaction commits, atomic rollback, file writes, and the end-to-end
 * metadata file shape.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
});

afterAll(() => {
  repo?.cleanup();
  if (keys?.tmpDir) fs.rmSync(keys.tmpDir, { recursive: true, force: true });
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

interface ClefResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function clef(
  args: string[],
  opts: { allowFailure?: boolean; confirm?: boolean } = {},
): ClefResult {
  try {
    const stdout = execFileSync("node", [clefBin, ...args], {
      cwd: repo.dir,
      input: opts.confirm ? "y\n" : "",
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    if (!opts.allowFailure) throw err;
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

/**
 * Commit any pending working-tree changes.  Tests that hand-edit metadata
 * files to simulate pre-feature state must call this before running
 * another `clef` mutation — TransactionManager refuses dirty trees.
 */
function commitPending(msg: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo.dir, stdio: "pipe" });
  try {
    execFileSync("git", ["commit", "-m", msg], { cwd: repo.dir, stdio: "pipe" });
  } catch {
    // nothing to commit — fine
  }
}

/** Read and parse the `.clef-meta.yaml` sidecar for a cell.  Returns null if absent. */
function readMeta(
  cellRelPath: string,
): { version: number; pending: unknown[]; rotations: Rotation[] } | null {
  const metaPath = path.join(
    repo.dir,
    cellRelPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml"),
  );
  if (!fs.existsSync(metaPath)) return null;
  return YAML.parse(fs.readFileSync(metaPath, "utf-8"));
}

interface Rotation {
  key: string;
  last_rotated_at: string;
  rotated_by: string;
  rotation_count: number;
}

describe("rotation records (clef set / delete)", () => {
  it("clef set writes a rotation record with rotation_count: 1 on first set", () => {
    clef(["set", "payments/dev", "ROT_A", "value_1"]);

    const meta = readMeta("payments/dev.enc.yaml");
    expect(meta).not.toBeNull();
    const record = meta!.rotations.find((r) => r.key === "ROT_A");
    expect(record).toBeDefined();
    expect(record!.rotation_count).toBe(1);
    expect(record!.rotated_by).toBeTruthy();
    expect(() => new Date(record!.last_rotated_at).toISOString()).not.toThrow();
  });

  it("clef set on an existing key bumps rotation_count and updates timestamp", () => {
    clef(["set", "payments/dev", "ROT_B", "v1"]);
    const beforeMeta = readMeta("payments/dev.enc.yaml");
    const before = beforeMeta!.rotations.find((r) => r.key === "ROT_B")!;

    // Small delay so timestamps diverge deterministically.
    const waitMs = 1100;
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      // busy-wait; Jest's fake timers are off for integration tests
    }

    clef(["set", "payments/dev", "ROT_B", "v2"]);
    const afterMeta = readMeta("payments/dev.enc.yaml");
    const after = afterMeta!.rotations.find((r) => r.key === "ROT_B")!;

    expect(after.rotation_count).toBe(before.rotation_count + 1);
    expect(new Date(after.last_rotated_at).getTime()).toBeGreaterThan(
      new Date(before.last_rotated_at).getTime(),
    );
  });

  it("clef delete removes the rotation record for the deleted key", () => {
    clef(["set", "payments/dev", "ROT_DEL", "gone"]);
    const before = readMeta("payments/dev.enc.yaml")!;
    expect(before.rotations.find((r) => r.key === "ROT_DEL")).toBeDefined();

    clef(["delete", "payments/dev", "ROT_DEL"], { confirm: true });

    const after = readMeta("payments/dev.enc.yaml")!;
    expect(after.rotations.find((r) => r.key === "ROT_DEL")).toBeUndefined();
  });

  it("clef set --random marks the key pending, NOT rotated", () => {
    clef(["set", "--random", "payments/dev", "ROT_RAND"]);

    const meta = readMeta("payments/dev.enc.yaml")!;
    expect(meta.rotations.find((r) => r.key === "ROT_RAND")).toBeUndefined();
    expect(
      (meta.pending as Array<{ key: string }>).find((p) => p.key === "ROT_RAND"),
    ).toBeDefined();
  });

  it("clef set with a real value resolves pending state AND records a rotation", () => {
    clef(["set", "--random", "payments/dev", "ROT_RESOLVE"]);
    // Sanity: pending only, no rotation yet.
    const pendingState = readMeta("payments/dev.enc.yaml")!;
    expect(
      (pendingState.pending as Array<{ key: string }>).find((p) => p.key === "ROT_RESOLVE"),
    ).toBeDefined();

    clef(["set", "payments/dev", "ROT_RESOLVE", "real_value"]);

    const resolvedState = readMeta("payments/dev.enc.yaml")!;
    expect(
      (resolvedState.pending as Array<{ key: string }>).find((p) => p.key === "ROT_RESOLVE"),
    ).toBeUndefined();
    const rot = resolvedState.rotations.find((r) => r.key === "ROT_RESOLVE");
    expect(rot).toBeDefined();
    expect(rot!.rotation_count).toBe(1);
  });
});

describe("rotation records (clef policy check end-to-end)", () => {
  it("reports a key without a rotation record as a violation (exit 1)", () => {
    // Fresh sidecar-less key: write a new cell via raw sops so there's no
    // .clef-meta.yaml record for its keys.  Easier repro: start with an
    // empty cell and skip recording.  We do this by scaffolding a fresh
    // key through `clef set` then manually removing the rotation record.
    clef(["set", "payments/dev", "POLICY_TARGET", "value"]);
    // Manually strip the record to simulate a pre-feature repo.
    const metaPath = path.join(repo.dir, "payments/dev.clef-meta.yaml");
    const meta = YAML.parse(fs.readFileSync(metaPath, "utf-8")) as {
      version: number;
      pending: unknown[];
      rotations: Rotation[];
    };
    meta.rotations = meta.rotations.filter((r) => r.key !== "POLICY_TARGET");
    fs.writeFileSync(metaPath, YAML.stringify(meta));
    // Commit the manual strip so the next `clef set` (cleanup) doesn't hit
    // the dirty-tree preflight guard in TransactionManager.
    commitPending("test: simulate pre-feature state");

    const result = clef(["policy", "check"], { allowFailure: true });
    expect(result.exitCode).toBe(1);

    // And the JSON output should mark that key as unknown.
    const jsonResult = clef(["--json", "policy", "check"], { allowFailure: true });
    const parsed = JSON.parse(jsonResult.stdout) as {
      files: Array<{ path: string; keys: Array<{ key: string; last_rotated_known: boolean }> }>;
    };
    const targetFile = parsed.files.find((f) => f.path.includes("payments/dev"));
    const targetKey = targetFile?.keys.find((k) => k.key === "POLICY_TARGET");
    expect(targetKey?.last_rotated_known).toBe(false);

    // Cleanup: re-run clef set to restore a rotation record for the next test.
    clef(["set", "payments/dev", "POLICY_TARGET", "value"]);
  });

  it("--per-key output includes KEY, FILE, ENV columns", () => {
    const result = clef(["policy", "check", "--per-key"], { allowFailure: true });
    expect(result.stdout).toMatch(/KEY/);
    expect(result.stdout).toMatch(/FILE/);
    expect(result.stdout).toMatch(/ENV/);
  });
});

describe("rotation records preserved across non-rotation operations", () => {
  it("clef recipients add does NOT change rotation records", async () => {
    clef(["set", "payments/dev", "RECIPIENT_TEST", "value"]);
    const before = readMeta("payments/dev.enc.yaml")!;
    const beforeRot = before.rotations.find((r) => r.key === "RECIPIENT_TEST")!;

    // Generate a second age key to add as a recipient.
    const secondKeys = await generateAgeKey();
    try {
      clef(["recipients", "add", secondKeys.publicKey, "--yes"], {
        allowFailure: true,
      });

      const after = readMeta("payments/dev.enc.yaml")!;
      const afterRot = after.rotations.find((r) => r.key === "RECIPIENT_TEST")!;

      // Re-encryption with a new recipient is NOT a value rotation.
      expect(afterRot.rotation_count).toBe(beforeRot.rotation_count);
      expect(afterRot.last_rotated_at).toBe(beforeRot.last_rotated_at);
    } finally {
      fs.rmSync(secondKeys.tmpDir, { recursive: true, force: true });
    }
  });
});
