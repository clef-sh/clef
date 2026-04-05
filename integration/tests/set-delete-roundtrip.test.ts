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

function clef(args: string[], confirm = false): string {
  return execFileSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    input: confirm ? "y\n" : "",
    env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
  }).toString();
}

describe("set and delete roundtrip", () => {
  it("should add a key, read it back, delete it, and confirm it is gone", () => {
    // Add
    clef(["set", "payments/dev", "TEMP_SECRET", "delete_me_123"]);
    const afterSet = clef(["get", "payments/dev", "TEMP_SECRET", "--raw"]);
    expect(afterSet.trim()).toBe("delete_me_123");

    // Delete (confirm prompt)
    clef(["delete", "payments/dev", "TEMP_SECRET"], true);

    // Confirm gone — clef get on a missing key exits non-zero
    let getSucceeded = false;
    try {
      clef(["get", "payments/dev", "TEMP_SECRET", "--raw"]);
      getSucceeded = true;
    } catch {
      // Expected — key was deleted
    }
    expect(getSucceeded).toBe(false);
  });

  it("should not affect other keys when deleting one", () => {
    clef(["set", "payments/dev", "KEEP_ME", "persistent"]);
    clef(["set", "payments/dev", "DROP_ME", "ephemeral"]);

    clef(["delete", "payments/dev", "DROP_ME"], true);

    const kept = clef(["get", "payments/dev", "KEEP_ME", "--raw"]);
    expect(kept.trim()).toBe("persistent");

    const original = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    expect(original.trim()).toBe("sk_test_abc123");
  });
});
