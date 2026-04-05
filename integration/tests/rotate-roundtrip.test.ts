import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let newKeys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  keys = await generateAgeKey();
  newKeys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
});

afterAll(() => {
  repo?.cleanup();
  if (keys?.tmpDir) fs.rmSync(keys.tmpDir, { recursive: true, force: true });
  if (newKeys?.tmpDir) fs.rmSync(newKeys.tmpDir, { recursive: true, force: true });
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

function clef(args: string[], opts?: { confirm?: boolean; env?: Record<string, string> }): string {
  return execFileSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    input: opts?.confirm ? "y\n" : "",
    env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath, ...opts?.env },
  }).toString();
}

describe("rotate roundtrip", () => {
  it("should add a new recipient and re-encrypt files for that environment", () => {
    clef(["recipients", "add", newKeys.publicKey, "-e", "dev", "--label", "second-dev"], { confirm: true });

    // Original key can still decrypt
    const val = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    expect(val.trim()).toBe("sk_test_abc123");
  });

  it("should be decryptable with the new key after rotation", () => {
    const val = execFileSync(
      "node",
      [clefBin, "get", "payments/dev", "STRIPE_KEY", "--raw"],
      {
        cwd: repo.dir,
        input: "",
        env: { ...process.env, SOPS_AGE_KEY_FILE: newKeys.keyFilePath },
      },
    ).toString();
    expect(val.trim()).toBe("sk_test_abc123");
  });

  it("should preserve all values after re-encryption", () => {
    const webhook = clef(["get", "payments/dev", "STRIPE_WEBHOOK_SECRET", "--raw"]);
    expect(webhook.trim()).toBe("whsec_xyz789");
  });

  it("should have at least 2 age keys in SOPS metadata after rotation", () => {
    const encPath = path.join(repo.dir, "payments", "dev.enc.yaml");
    const raw = YAML.parse(fs.readFileSync(encPath, "utf-8"));

    const ageKeys = raw.sops.age as Array<{ enc: string }>;
    expect(ageKeys.length).toBeGreaterThanOrEqual(2);

    for (const key of ageKeys) {
      expect(key.enc).toBeTruthy();
      expect(key.enc.length).toBeGreaterThan(10);
    }
  });
});
