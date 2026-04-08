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

describe("diff roundtrip", () => {
  it("should show differences between environments", () => {
    // Set different values in dev vs production for a new key
    clef(["set", "payments/dev", "DIFF_KEY", "dev_value"]);
    clef(["set", "payments/production", "DIFF_KEY", "prod_value"]);

    // clef diff <namespace> <env-a> <env-b>
    let output: string;
    try {
      output = clef(["diff", "payments", "dev", "production"]);
    } catch (err) {
      // diff exits non-zero when differences exist
      output = (err as { stdout?: Buffer }).stdout?.toString() ?? (err as Error).message;
    }
    expect(output).toContain("DIFF_KEY");
  });

  it("should show missing keys across environments", () => {
    // Add a key only in dev
    clef(["set", "payments/dev", "ONLY_IN_DEV", "orphan"]);

    let output: string;
    try {
      output = clef(["diff", "payments", "dev", "production"]);
    } catch (err) {
      output = (err as { stdout?: Buffer }).stdout?.toString() ?? (err as Error).message;
    }
    expect(output).toContain("ONLY_IN_DEV");
  });
});
