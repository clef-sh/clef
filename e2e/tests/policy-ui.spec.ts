/**
 * Playwright E2E tests: clef policy → PolicyView
 *
 * Exercises the three states a user actually sees on the Policy screen:
 *
 *   1. Clean    — default policy (90d), all files fresh → all-compliant card.
 *   2. Unknown  — one file missing `sops.lastmodified` → appears in the
 *                 Unknown bucket; allCompliant state is suppressed.
 *   3. Overdue  — `.clef/policy.yaml` with a near-zero max_age_days so every
 *                 file is overdue → appears in the Overdue bucket; overdue
 *                 badge appears in the sidebar.
 *
 * Runs serially with a single shared server.  State mutations (policy file
 * write, lastmodified strip) are applied before each test and reverted after,
 * so ordering doesn't leak.  The policy endpoints recompute on each request —
 * no cache to invalidate on the server side, and the UI re-fetches on mount.
 */
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import {
  scaffoldTestRepo,
  writePolicyFile,
  removePolicyFile,
  removeRotationRecord,
  type TestRepo,
} from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

let keys: AgeKeyPair;
let repo: TestRepo;
let server: ServerInfo;

// Snapshot cell + metadata files after scaffold so we can restore them
// between tests.  Each scenario mutates its own state (remove a rotation
// record, tighten the policy) and the beforeEach hook reverts.
let devSnapshot: string;
let productionSnapshot: string;
let devMetaSnapshot: string;
let productionMetaSnapshot: string;
const devFile = () => path.join(repo.dir, "payments", "dev.enc.yaml");
const productionFile = () => path.join(repo.dir, "payments", "production.enc.yaml");
const devMetaFile = () => path.join(repo.dir, "payments", "dev.clef-meta.yaml");
const productionMetaFile = () => path.join(repo.dir, "payments", "production.clef-meta.yaml");

test.beforeAll(async () => {
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
  devSnapshot = fs.readFileSync(devFile(), "utf-8");
  productionSnapshot = fs.readFileSync(productionFile(), "utf-8");
  devMetaSnapshot = fs.readFileSync(devMetaFile(), "utf-8");
  productionMetaSnapshot = fs.readFileSync(productionMetaFile(), "utf-8");
  server = await startClefUI(repo.dir, keys.keyFilePath);
});

test.afterAll(async () => {
  if (server) await server.stop();
  if (repo) repo.cleanup();
  if (keys?.tmpDir) {
    try {
      fs.rmSync(keys.tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
});

test.beforeEach(() => {
  // Reset to the fresh scaffold state before every test.  Each scenario
  // applies its own mutations after this reset.
  removePolicyFile(repo.dir);
  fs.writeFileSync(devFile(), devSnapshot);
  fs.writeFileSync(productionFile(), productionSnapshot);
  fs.writeFileSync(devMetaFile(), devMetaSnapshot);
  fs.writeFileSync(productionMetaFile(), productionMetaSnapshot);
});

test.describe.serial("clef policy → PolicyView: rotation verdicts", () => {
  test("[clean] default policy + fresh files → all-compliant card", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByText("clef policy check")).toBeVisible();
    await expect(page.getByTestId("all-compliant")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("policy-source")).toHaveText("Built-in default");
  });

  test("[warnings] removing a key's rotation record surfaces it in Unknown", async ({ page }) => {
    // Per-key semantics: unknown rotation state = violation.  Removing
    // the record for STRIPE_KEY in dev simulates a pre-feature state for
    // that one key; the other three keys in the scaffold stay compliant.
    removeRotationRecord(devMetaFile(), "STRIPE_KEY");

    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByTestId("filter-unknown")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("filter-unknown")).toContainText("1");
    // The affected key row shows the key name and the file path as secondary.
    await expect(page.getByTestId("key-ref-STRIPE_KEY")).toBeVisible();
    // allCompliant is suppressed when any key is non-compliant.
    await expect(page.getByTestId("all-compliant")).toHaveCount(0);
  });

  test("[errors] policy max_age_days: 0.000001 puts every key in Overdue", async ({ page }) => {
    writePolicyFile(repo.dir, {
      version: 1,
      rotation: { max_age_days: 0.000001 }, // ~86ms window — anything older is overdue
    });

    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByTestId("filter-overdue")).toBeVisible({ timeout: 15_000 });
    // All 4 keys (2 files × 2 keys) past their rotation window.
    await expect(page.getByTestId("filter-overdue")).toContainText("4");
    // Every key row is shown — verify at least one from each file.
    await expect(page.getByTestId("file-ref-payments/dev.enc.yaml").first()).toBeVisible();
    await expect(page.getByTestId("file-ref-payments/production.enc.yaml").first()).toBeVisible();
    // Source badge now says policy file, not built-in default.
    await expect(page.getByTestId("policy-source")).toHaveText(".clef/policy.yaml");
  });

  test("[errors] overdue count appears as a red badge on the Policy nav item", async ({ page }) => {
    writePolicyFile(repo.dir, {
      version: 1,
      rotation: { max_age_days: 0.000001 },
    });

    await page.goto(server.url);

    // The overdue badge is computed by App.tsx's loadPolicyCount on mount.
    // App.tsx's loader reads summary.rotation_overdue (count of non-compliant
    // CELLS, not keys).  Both cells have all their keys overdue → 2 cells.
    const policyNav = page.getByTestId("nav-policy");
    await expect(policyNav).toContainText("2", { timeout: 15_000 });
  });
});

// ── Endpoint smoke: direct HTTP calls ────────────────────────────────────────
// Exercises /api/policy and /api/policy/check from the test directly, not
// via the UI, to catch regressions where the screen is accidentally skipping
// an endpoint (e.g. removing the /api/policy call for rawYaml).

test.describe("policy HTTP endpoints", () => {
  function serverApi(tokenizedUrl: string): { base: string; headers: Record<string, string> } {
    const u = new URL(tokenizedUrl);
    const token = u.searchParams.get("token") ?? "";
    return { base: u.origin, headers: { Authorization: `Bearer ${token}` } };
  }

  test("[positive] GET /api/policy returns default policy + rawYaml when no file present", async ({
    request,
  }) => {
    removePolicyFile(repo.dir);
    const api = serverApi(server.url);
    const res = await request.get(`${api.base}/api/policy`, { headers: api.headers });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      policy: { version: number; rotation?: { max_age_days?: number } };
      source: "file" | "default";
      rawYaml: string;
    };
    expect(body.source).toBe("default");
    expect(body.policy.version).toBe(1);
    expect(body.rawYaml).toContain("rotation");
  });

  test("[positive] GET /api/policy/check returns summary + per-file verdicts", async ({
    request,
  }) => {
    removePolicyFile(repo.dir);
    const api = serverApi(server.url);
    const res = await request.get(`${api.base}/api/policy/check`, { headers: api.headers });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      files: Array<{ path: string; compliant: boolean }>;
      summary: {
        total_files: number;
        compliant: number;
        rotation_overdue: number;
        unknown_metadata: number;
      };
      policy: unknown;
      source: "file" | "default";
    };
    // Default scaffold → 2 files, both within the 90-day window.
    expect(body.summary.total_files).toBe(2);
    expect(body.summary.rotation_overdue).toBe(0);
    expect(body.files.every((f) => f.compliant)).toBe(true);
  });

  test("[positive] PUT /api/namespace/:ns/:env/:key records a rotation (fix regression)", async ({
    request,
  }) => {
    // Regression: the UI PUT path used to call markResolved only, never
    // recordRotation.  Policy stayed red even after the user re-saved a
    // value in the UI.  This test locks in the fix end-to-end: start with
    // an unknown state, hit the PUT endpoint, verify the key flips to
    // compliant in the next /api/policy/check.
    removeRotationRecord(devMetaFile(), "STRIPE_KEY");
    const api = serverApi(server.url);

    // Verify starting state: STRIPE_KEY unknown → not compliant.
    const before = await request.get(`${api.base}/api/policy/check`, { headers: api.headers });
    const beforeBody = (await before.json()) as {
      files: Array<{
        path: string;
        keys: Array<{ key: string; last_rotated_known: boolean; compliant: boolean }>;
      }>;
    };
    const devBefore = beforeBody.files.find((f) => f.path.includes("payments/dev"));
    const stripeBefore = devBefore?.keys.find((k) => k.key === "STRIPE_KEY");
    expect(stripeBefore?.last_rotated_known).toBe(false);
    expect(stripeBefore?.compliant).toBe(false);

    // Re-save the value through the same endpoint the UI namespace editor uses.
    const put = await request.put(`${api.base}/api/namespace/payments/dev/STRIPE_KEY`, {
      headers: { ...api.headers, "Content-Type": "application/json" },
      data: { value: "sk_test_regression_fix" },
    });
    expect(put.status()).toBe(200);

    // Now STRIPE_KEY should have a rotation record and be compliant.
    const after = await request.get(`${api.base}/api/policy/check`, { headers: api.headers });
    const afterBody = (await after.json()) as {
      files: Array<{
        path: string;
        keys: Array<{ key: string; last_rotated_known: boolean; compliant: boolean }>;
      }>;
    };
    const devAfter = afterBody.files.find((f) => f.path.includes("payments/dev"));
    const stripeAfter = devAfter?.keys.find((k) => k.key === "STRIPE_KEY");
    expect(stripeAfter?.last_rotated_known).toBe(true);
    expect(stripeAfter?.compliant).toBe(true);
  });
});
