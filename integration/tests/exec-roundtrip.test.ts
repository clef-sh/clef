import { execFileSync, spawnSync } from "child_process";
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

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.js");

describe("clef exec roundtrip", () => {
  it("should inject decrypted values into child process environment", () => {
    const result = spawnSync("node", [clefBin, "exec", "payments/dev", "--", "env"], {
      cwd: repo.dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("STRIPE_KEY=sk_test_abc123");
    expect(result.stdout).toContain("STRIPE_WEBHOOK_SECRET=whsec_xyz789");
  });

  it("should forward child process exit code", () => {
    try {
      execFileSync(
        "node",
        [clefBin, "exec", "payments/dev", "--", "node", "-e", "process.exit(42)"],
        {
          cwd: repo.dir,
          env: {
            ...process.env,
            SOPS_AGE_KEY_FILE: keys.keyFilePath,
          },
        },
      );
      // Should not reach here
      fail("Expected process to exit with code 42");
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((err as any).status).toBe(42);
    }
  });

  it("should filter keys with --only", () => {
    const result = execFileSync(
      "node",
      [clefBin, "exec", "payments/dev", "--only", "STRIPE_KEY", "--", "env"],
      {
        cwd: repo.dir,
        env: {
          ...process.env,
          SOPS_AGE_KEY_FILE: keys.keyFilePath,
        },
      },
    );

    const output = result.toString();
    expect(output).toContain("STRIPE_KEY=sk_test_abc123");
    expect(output).not.toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("should prefix keys with --prefix", () => {
    const result = execFileSync(
      "node",
      [clefBin, "exec", "payments/dev", "--prefix", "APP_", "--", "env"],
      {
        cwd: repo.dir,
        env: {
          ...process.env,
          SOPS_AGE_KEY_FILE: keys.keyFilePath,
        },
      },
    );

    const output = result.toString();
    expect(output).toContain("APP_STRIPE_KEY=sk_test_abc123");
    expect(output).toContain("APP_STRIPE_WEBHOOK_SECRET=whsec_xyz789");
  });
});
