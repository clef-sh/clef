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
  stripSopsLastmodified,
  type TestRepo,
} from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

let keys: AgeKeyPair;
let repo: TestRepo;
let server: ServerInfo;

// Snapshot the two matrix files after scaffold so we can restore them between
// tests.  Strip/restore-by-rewrite is the simplest path — the SOPS envelope
// itself is unchanged, we only touch the plaintext `sops.lastmodified` field.
let devSnapshot: string;
let productionSnapshot: string;
const devFile = () => path.join(repo.dir, "payments", "dev.enc.yaml");
const productionFile = () => path.join(repo.dir, "payments", "production.enc.yaml");

test.beforeAll(async () => {
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
  devSnapshot = fs.readFileSync(devFile(), "utf-8");
  productionSnapshot = fs.readFileSync(productionFile(), "utf-8");
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
});

test.describe.serial("clef policy → PolicyView: rotation verdicts", () => {
  test("[clean] default policy + fresh files → all-compliant card", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByText("clef policy check")).toBeVisible();
    await expect(page.getByTestId("all-compliant")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("policy-source")).toHaveText("Built-in default");
  });

  test("[warnings] stripping sops.lastmodified surfaces the file in Unknown", async ({ page }) => {
    stripSopsLastmodified(devFile());

    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByTestId("filter-unknown")).toBeVisible({ timeout: 15_000 });
    // The Unknown filter chip reports at least one file.
    await expect(page.getByTestId("filter-unknown")).toContainText("1");
    // The affected file is linked from the Unknown group.
    await expect(page.getByTestId("file-ref-payments/dev.enc.yaml")).toBeVisible();
    // allCompliant is suppressed when unknown_metadata > 0.
    await expect(page.getByTestId("all-compliant")).toHaveCount(0);
  });

  test("[errors] policy max_age_days: 0.000001 puts both files in Overdue", async ({ page }) => {
    writePolicyFile(repo.dir, {
      version: 1,
      rotation: { max_age_days: 0.000001 }, // ~86ms window — anything older is overdue
    });

    await page.goto(server.url);
    await page.getByTestId("nav-policy").click();

    await expect(page.getByTestId("filter-overdue")).toBeVisible({ timeout: 15_000 });
    // Both dev + production are past their rotation window.
    await expect(page.getByTestId("filter-overdue")).toContainText("2");
    await expect(page.getByTestId("file-ref-payments/dev.enc.yaml")).toBeVisible();
    await expect(page.getByTestId("file-ref-payments/production.enc.yaml")).toBeVisible();
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
    // Scope the match to the Policy nav item so the sidebar's other badges
    // (lint errors, scan issues) don't collide.
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
});
