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

describe("lint roundtrip", () => {
  it("should pass lint on a healthy repo", () => {
    // clef lint exits 0 on success, non-zero on issues
    const output = clef(["lint"]);
    expect(output).toBeDefined();
  });

  it("should detect drift when environments have different keys", () => {
    // Add a key only to dev, not production — creates drift
    clef(["set", "payments/dev", "DRIFT_TEST_KEY", "only_in_dev"]);

    // Lint should flag the key mismatch — exit code may be non-zero
    let output: string;
    try {
      output = clef(["lint"]);
    } catch (err) {
      output = (err as { stdout?: Buffer }).stdout?.toString() ?? (err as Error).message;
    }
    expect(output).toContain("DRIFT_TEST_KEY");
  });
});
