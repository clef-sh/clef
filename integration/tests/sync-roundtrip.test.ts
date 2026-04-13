import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
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

function clef(args: string[]): string {
  return execFileSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    input: "",
    env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
  }).toString();
}

function clefMayFail(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = clef(args);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("sync roundtrip", () => {
  it("should be a no-op when all environments are already in sync", () => {
    // The test repo starts with both dev and production having STRIPE_KEY + STRIPE_WEBHOOK_SECRET
    const output = clef(["sync", "payments"]);
    expect(output).toContain("fully in sync");
  });

  it("should scaffold missing keys after creating drift", () => {
    // Add a key only to dev — this creates drift
    clef(["--yes", "set", "payments/dev", "SYNC_TEST_KEY", "only_in_dev"]);

    // Dry run shows what would be scaffolded
    const dryRun = clef(["sync", "payments", "--dry-run"]);
    expect(dryRun).toContain("SYNC_TEST_KEY");
    expect(dryRun).toContain("production");

    // Verify production doesn't have the key yet
    const beforeGet = clefMayFail(["get", "payments/production", "SYNC_TEST_KEY"]);
    expect(beforeGet.exitCode).not.toBe(0);

    // Run actual sync (--yes to skip protected env confirmation)
    const output = clef(["--yes", "sync", "payments"]);
    expect(output).toContain("Synced");
    expect(output).toContain("SYNC_TEST_KEY");

    // Verify the key now exists in production
    const afterGet = clef(["get", "payments/production", "SYNC_TEST_KEY"]);
    expect(afterGet).toContain("SYNC_TEST_KEY");
  });

  it("should be a no-op on second sync after filling gaps", () => {
    const output = clef(["sync", "payments"]);
    expect(output).toContain("fully in sync");
  });

  it("should output JSON with --json flag", () => {
    // Add another key to create fresh drift
    clef(["--yes", "set", "payments/dev", "JSON_TEST_KEY", "value"]);

    const output = clef(["--yes", "--json", "sync", "payments"]);
    const parsed = JSON.parse(output);
    expect(parsed.totalKeysScaffolded).toBeGreaterThan(0);
    expect(parsed.modifiedCells).toContain("payments/production");
  });
});
