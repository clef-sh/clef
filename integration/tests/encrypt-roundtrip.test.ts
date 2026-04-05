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
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys);
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

function clef(args: string[]): string {
  return execFileSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    env: {
      ...process.env,
      SOPS_AGE_KEY_FILE: keys.keyFilePath,
    },
  }).toString();
}

describe("encrypt roundtrip", () => {
  it("should encrypt a value and store a non-empty data key", () => {
    // Set a new secret (key and value are separate args)
    clef(["set", "payments/dev", "ROUNDTRIP_KEY", "roundtrip_value_123"]);

    // Read the raw encrypted file and verify SOPS metadata
    const encPath = path.join(repo.dir, "payments", "dev.enc.yaml");
    const raw = YAML.parse(fs.readFileSync(encPath, "utf-8"));

    // The value should be encrypted (ENC[...])
    expect(raw.ROUNDTRIP_KEY).toMatch(/^ENC\[/);

    // SOPS metadata must have a non-empty enc field on at least one key
    const sops = raw.sops;
    expect(sops).toBeDefined();

    const ageKeys = sops.age as Array<{ enc: string }>;
    expect(ageKeys).toBeDefined();
    expect(ageKeys.length).toBeGreaterThan(0);
    expect(ageKeys[0].enc).toBeTruthy();
    expect(ageKeys[0].enc.length).toBeGreaterThan(10);
  });

  it("should decrypt back to the original value", () => {
    // clef get returns the single value with --raw
    const output = clef(["get", "payments/dev", "ROUNDTRIP_KEY", "--raw"]);
    expect(output.trim()).toBe("roundtrip_value_123");
  });

  it("should preserve existing values after adding a new key", () => {
    const stripe = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    expect(stripe.trim()).toBe("sk_test_abc123");

    const webhook = clef(["get", "payments/dev", "STRIPE_WEBHOOK_SECRET", "--raw"]);
    expect(webhook.trim()).toBe("whsec_xyz789");
  });
});
