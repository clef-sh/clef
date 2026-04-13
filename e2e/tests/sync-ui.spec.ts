/**
 * Playwright E2E tests for the sync feature.
 *
 * Creates key drift by adding a key to one environment via the API,
 * then tests the sync UI flow in the MatrixView.
 */
import * as fs from "fs";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, type TestRepo } from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

function serverApi(tokenizedUrl: string): { base: string; headers: Record<string, string> } {
  const u = new URL(tokenizedUrl);
  const token = u.searchParams.get("token") ?? "";
  return { base: u.origin, headers: { Authorization: `Bearer ${token}` } };
}

let keys: AgeKeyPair;
let repo: TestRepo;
let server: ServerInfo;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
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

test.describe("clef sync", () => {
  test("[positive] sync button appears when drift exists and resolves it", async ({ page }) => {
    const { base, headers } = serverApi(server.url);

    // Create drift: add a key only to dev via the API
    const putRes = await page.request.put(`${base}/api/namespace/payments/dev/E2E_SYNC_KEY`, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: { value: "only_in_dev" },
    });
    expect(putRes.ok()).toBe(true);

    // Navigate to matrix view and wait for it to load
    await page.goto(server.url);
    await expect(page.getByTestId("matrix-table")).toBeVisible();

    // The Sync button should appear on the payments row (drift exists)
    const syncBtn = page.getByTestId("sync-btn-payments");
    await expect(syncBtn).toBeVisible({ timeout: 15_000 });

    // Click Sync — the SyncPanel should expand with a preview
    await syncBtn.click();
    await expect(page.getByTestId("sync-panel")).toBeVisible();
    await expect(page.getByTestId("sync-preview-list")).toBeVisible({ timeout: 15_000 });

    // The preview should mention the missing key
    await expect(page.getByText("E2E_SYNC_KEY")).toBeVisible();

    // Click "Sync Now" to execute
    await page.getByTestId("sync-execute-btn").click();

    // Should show completion message
    await expect(page.getByTestId("sync-done")).toBeVisible({ timeout: 15_000 });

    // After auto-close, sync panel should disappear and the matrix should refresh
    await expect(page.getByTestId("sync-panel")).not.toBeVisible({ timeout: 5_000 });
  });
});
