/**
 * Blackbox E2E smoke tests for `clef ui`.
 *
 * The suite builds on the SEA binary at packages/cli/dist/clef and drives it
 * with a real sops-encrypted test repository. Playwright talks to the Express
 * server that the binary starts, exactly as an end-user browser would.
 *
 * Prerequisites (handled by CI, or run manually before testing locally):
 *   npm run build:sea -w packages/cli
 */
import * as fs from "fs";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, type TestRepo } from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

// Shared fixtures for all tests in this file. The server is expensive to
// start (sops + node sea init), so we start it once and share across tests.
let keys: AgeKeyPair;
let repo: TestRepo;
let server: ServerInfo;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
  server = await startClefUI(repo.dir, keys.keyFilePath);
});

test.afterAll(async () => {
  if (server) {
    await server.stop();
  }
  if (repo) {
    repo.cleanup();
  }
  if (keys?.tmpDir) {
    try {
      fs.rmSync(keys.tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
});

test("matrix view renders the Secret Matrix heading", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByText("Secret Matrix")).toBeVisible();
});

test("matrix table is visible", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("matrix-table")).toBeVisible();
});

test("payments namespace row appears in the matrix", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("matrix-row-payments")).toBeVisible();
});

test("environment columns are labelled dev and production", async ({ page }) => {
  await page.goto(server.url);
  // Both environment names must appear in the matrix header area.
  // Use exact:true to avoid matching the uppercase badge variants (DEV, PROD…).
  await expect(page.getByTestId("matrix-table").getByText("dev", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("matrix-table").getByText("production", { exact: true }),
  ).toBeVisible();
});

test("clicking the payments row opens the namespace editor showing STRIPE_KEY", async ({
  page,
}) => {
  await page.goto(server.url);
  await page.getByTestId("matrix-row-payments").click();
  // The namespace editor decrypts and lists secret key names.
  await expect(page.getByText("STRIPE_KEY")).toBeVisible();
});
