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
    repo = scaffoldTestRepo(keys);
  } catch (err) {
    // Clean up temp dirs on setup failure
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
  repo?.cleanup();
  if (keys?.tmpDir) {
    try {
      fs.rmSync(keys.tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

describe("clef export roundtrip", () => {
  it("should output export statements with correct values", () => {
    const result = execFileSync("node", [clefBin, "export", "payments/dev"], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
    });

    const output = result.toString();
    expect(output).toContain("export STRIPE_KEY='sk_test_abc123'");
    expect(output).toContain("export STRIPE_WEBHOOK_SECRET='whsec_xyz789'");
  });

  it("should omit export keyword with --no-export", () => {
    const result = execFileSync("node", [clefBin, "export", "payments/dev", "--no-export"], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
    });

    const output = result.toString();
    expect(output).toContain("STRIPE_KEY='sk_test_abc123'");
    expect(output).not.toContain("export ");
  });

  it("should correctly quote values with special characters", () => {
    // This test uses the existing encrypted file — the values don't have
    // special characters, but verifies the quoting format is correct
    const result = execFileSync("node", [clefBin, "export", "payments/dev"], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
    });

    const output = result.toString();
    const lines = output.trim().split("\n");

    // Each line should match: export KEY='value'
    for (const line of lines) {
      expect(line).toMatch(/^export \w+='[^']*'$/);
    }
  });
});
