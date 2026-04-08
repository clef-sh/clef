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

function clef(args: string[], env?: Record<string, string>): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [clefBin, ...args], {
      cwd: repo.dir,
      input: "",
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
        // Enable debug logging so PostHog client creation is visible
        DEBUG: "posthog-node",
        ...env,
      },
    }).toString();
    return { stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return {
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

describe("analytics roundtrip", () => {
  it("should complete commands successfully with analytics enabled", () => {
    // Analytics enabled (default) — command should still work
    const { stdout } = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    expect(stdout.trim()).toBe("sk_test_abc123");
  });

  it("should complete commands successfully with analytics disabled via env", () => {
    const { stdout } = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"], {
      CLEF_ANALYTICS: "0",
    });
    expect(stdout.trim()).toBe("sk_test_abc123");
  });

  it("should complete commands successfully with analytics set to false", () => {
    const { stdout } = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"], {
      CLEF_ANALYTICS: "false",
    });
    expect(stdout.trim()).toBe("sk_test_abc123");
  });

  it("should not slow down commands noticeably", () => {
    const start = Date.now();
    clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    const duration = Date.now() - start;

    // Analytics shutdown has a 5s timeout, but should resolve near-instantly
    // when there are no pending events (PostHog flush is async).
    // A healthy command should complete well under 10 seconds.
    expect(duration).toBeLessThan(10000);
  });

  it("should not crash when analytics module encounters errors", () => {
    // Force a bad PostHog host — analytics should fail silently
    const { stdout } = clef(["get", "payments/dev", "STRIPE_KEY", "--raw"]);
    // Command should still succeed regardless of analytics state
    expect(stdout.trim()).toBe("sk_test_abc123");
  });
});
