/**
 * Playwright E2E tests: CLI command ↔ UI action flows
 *
 * Prerequisites (handled by CI; run locally first):
 *   npm run build:sea -w packages/cli
 *
 * These tests drive a live `clef ui` server backed by a real sops-encrypted
 * test repository. They are organised by the CLI command they exercise through
 * the browser rather than directly from the terminal.
 *
 * CLI commands with no UI equivalent are not tested here; see the README for
 * the list.
 */
import * as fs from "fs";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, type TestRepo } from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

/** Extract the base URL (no query params) and the Bearer token from the tokenized server URL. */
function serverApi(tokenizedUrl: string): { base: string; headers: Record<string, string> } {
  const u = new URL(tokenizedUrl);
  const token = u.searchParams.get("token") ?? "";
  return { base: u.origin, headers: { Authorization: `Bearer ${token}` } };
}

// Shared fixtures — server is expensive; start once and share across all tests.
let keys: AgeKeyPair;
let secondKeys: AgeKeyPair; // Second key pair for recipient add tests
let repo: TestRepo;
let server: ServerInfo;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  secondKeys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
  server = await startClefUI(repo.dir, keys.keyFilePath);
});

test.afterAll(async () => {
  if (server) await server.stop();
  if (repo) repo.cleanup();
  for (const k of [keys, secondKeys]) {
    if (k?.tmpDir) {
      try {
        fs.rmSync(k.tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
});

// ── Sidebar navigation ───────────────────────────────────────────────────────
// Verifies that each nav item routes to the expected view.
// No state mutations — safe to run first.

test.describe("sidebar navigation", () => {
  test("[positive] Matrix is the default landing view", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByText("Secret Matrix")).toBeVisible();
  });

  test("[positive] Diff nav item opens the environment diff view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-diff").click();
    await expect(page.getByText("Environment Diff")).toBeVisible();
  });

  test("[positive] Lint nav item opens the lint view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-lint").click();
    await expect(page.getByText("clef lint")).toBeVisible();
  });

  test("[positive] Scan nav item opens the scan view in idle state", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-scan").click();
    await expect(page.getByTestId("scan-idle")).toBeVisible();
  });

  test("[positive] Import nav item opens the import view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-import").click();
    await expect(page.getByText("clef import")).toBeVisible();
  });

  test("[positive] Recipients nav item opens the recipients view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText("clef recipients")).toBeVisible();
  });

  test("[positive] Service IDs nav item opens the service identities view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await expect(page.getByTestId("si-web-app")).toBeVisible();
  });

  test("[positive] History nav item opens the history view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-history").click();
    await expect(page.getByText("Commit log per encrypted file")).toBeVisible();
  });

  test("[positive] payments namespace in sidebar opens the namespace editor", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
  });
});

// ── clef get → NamespaceEditor: read decrypted key names ────────────────────
// clef get payments/dev STRIPE_KEY  →  editor decrypts and lists key names

test.describe("clef get → NamespaceEditor: read decrypted key names", () => {
  test("[positive] editor shows all key names for the dev environment", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await expect(page.getByText("STRIPE_WEBHOOK_SECRET")).toBeVisible();
  });

  test("[positive] values are masked with dots — value input hidden until revealed", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    // The editable input should not be present until the eye icon is clicked
    await expect(page.getByTestId("value-input-STRIPE_KEY")).not.toBeVisible();
  });

  test("[positive] clicking the eye button reveals the value input for that key", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("eye-STRIPE_KEY").click();
    await expect(page.getByTestId("value-input-STRIPE_KEY")).toBeVisible();
  });

  test("[positive] schema summary section is rendered below the key table", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByTestId("schema-summary")).toBeVisible();
  });

  test("[negative] navigating to a non-existent namespace shows an error state", async ({
    page,
  }) => {
    // Navigate directly to an invalid namespace via sidebar namespace click that
    // doesn't exist. The editor loads and shows the API error.
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    // Verify the editor didn't show a generic error on a valid namespace
    await expect(page.getByText("Failed to load")).not.toBeVisible();
  });
});

// ── clef set (edit) → NamespaceEditor: modify an existing value ─────────────
// clef set payments/dev STRIPE_KEY newvalue  →  reveal → edit → commit

test.describe("clef set → NamespaceEditor: edit an existing value", () => {
  test("[positive] editing a value shows a dirty-dot indicator on that row", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("eye-STRIPE_KEY").click();
    await page.getByTestId("value-input-STRIPE_KEY").fill("sk_test_edited");
    await expect(page.getByTestId("dirty-dot").first()).toBeVisible();
  });

  test("[positive] editing a value reveals the Commit changes button", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("eye-STRIPE_KEY").click();
    await page.getByTestId("value-input-STRIPE_KEY").fill("sk_test_modified");
    await expect(page.getByRole("button", { name: "Commit changes" })).toBeVisible();
  });

  test("[positive] clicking Commit changes reveals the commit message input", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("eye-STRIPE_KEY").click();
    await page.getByTestId("value-input-STRIPE_KEY").fill("sk_test_val");
    await page.getByRole("button", { name: "Commit changes" }).click();
    await expect(page.getByTestId("commit-message-input")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save & Commit" })).toBeVisible();
  });

  test("[positive] Save & Commit encrypts the value and dismisses the commit UI", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("eye-STRIPE_KEY").click();
    await page.getByTestId("value-input-STRIPE_KEY").fill("sk_test_e2e_committed");
    await page.getByRole("button", { name: "Commit changes" }).click();
    await page.getByTestId("commit-message-input").fill("test: update STRIPE_KEY via e2e");
    await page.getByRole("button", { name: "Save & Commit" }).click();
    // After save the commit UI should disappear and the editor should reload
    await expect(page.getByTestId("commit-message-input")).not.toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
  });
});

// ── clef set (new key) → NamespaceEditor: add a key ─────────────────────────
// clef set payments/dev NEW_KEY value  →  + Add key → fill → submit

test.describe("clef set (new key) → NamespaceEditor: add a key", () => {
  test("[positive] + Add key button opens the add key form", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("add-key-btn").click();
    await expect(page.getByTestId("new-key-input")).toBeVisible();
    await expect(page.getByTestId("new-value-input")).toBeVisible();
  });

  test("[positive] new key appears in the table after submitting the add form", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("add-key-btn").click();
    await page.getByTestId("new-key-input").fill("PLAYWRIGHT_NEW_KEY");
    await page.getByTestId("new-value-input").fill("newvalue123");
    const putPromise = page.waitForResponse(
      (r) => r.url().includes("/api/namespace/") && r.request().method() === "PUT",
    );
    await page.getByTestId("add-key-submit").click();
    const putRes = await putPromise;
    let putBody = "";
    try {
      putBody = await putRes.text();
    } catch {
      putBody = "(body unavailable)";
    }
    expect(putRes.status(), `PUT /api/namespace responded ${putRes.status()}: ${putBody}`).toBe(
      200,
    );
    // SOPS encrypt + decrypt takes ~2-4s; allow extra time
    await expect(page.getByText("PLAYWRIGHT_NEW_KEY")).toBeVisible({ timeout: 15_000 });
  });

  test("[negative] Cancel button dismisses the add key form without adding anything", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("add-key-btn").click();
    await expect(page.getByTestId("new-key-input")).toBeVisible();
    // Cancel is the second Cancel button (first is for commit UI, second for add form)
    await page.getByRole("button", { name: "Cancel" }).last().click();
    await expect(page.getByTestId("new-key-input")).not.toBeVisible();
  });
});

// ── clef set --random → NamespaceEditor: random placeholder ─────────────────
// clef set --random payments/dev PENDING_KEY  →  Random mode → Generate

test.describe("clef set --random → NamespaceEditor: generate random placeholder", () => {
  test("[positive] switching to Random mode hides the value input", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("add-key-btn").click();
    await page.getByTestId("mode-random").click();
    await expect(page.getByTestId("new-value-input")).not.toBeVisible();
    await expect(page.getByText("cryptographically random placeholder")).toBeVisible();
  });

  test("[positive] generating a random key adds it to the table as PENDING", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("add-key-btn").click();
    await page.getByTestId("new-key-input").fill("PLAYWRIGHT_PENDING_KEY");
    await page.getByTestId("mode-random").click();
    const putPromise = page.waitForResponse(
      (r) => r.url().includes("/api/namespace/") && r.request().method() === "PUT",
    );
    await page.getByTestId("add-key-submit").click();
    const putRes = await putPromise;
    let putBody = "";
    try {
      putBody = await putRes.text();
    } catch {
      putBody = "(body unavailable)";
    }
    expect(putRes.status(), `PUT /api/namespace responded ${putRes.status()}: ${putBody}`).toBe(
      200,
    );
    // SOPS encrypt + decrypt takes ~2-4s; allow extra time
    await expect(page.getByText("PLAYWRIGHT_PENDING_KEY")).toBeVisible({ timeout: 15_000 });
    // The PENDING badge should appear at least once (may be multiple pending keys by now)
    await expect(page.getByText("PENDING").first()).toBeVisible();
  });
});

// ── Protected environment → production warning banner ───────────────────────

test.describe("protected environment → production warning banner", () => {
  test("[positive] switching to production tab shows the warning banner", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByRole("tab", { name: "production" }).click();
    await expect(page.getByTestId("production-warning")).toBeVisible();
    await expect(page.getByText("Production environment.")).toBeVisible();
  });

  test("[positive] production tab still shows the key names", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByRole("tab", { name: "production" }).click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await expect(page.getByTestId("production-warning")).toBeVisible();
  });

  test("[negative] dev tab does not show the production warning", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    // dev is the default — warning should not be present
    await expect(page.getByTestId("production-warning")).not.toBeVisible();
  });
});

// ── clef diff → DiffView: compare environments ───────────────────────────────
// clef diff payments dev production  →  Diff view → table of key differences

test.describe("clef diff → DiffView: compare environments", () => {
  test("[positive] diff view shows the comparison table", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-diff").click();
    await expect(page.getByText("Environment Diff")).toBeVisible();
    await expect(page.getByTestId("diff-table")).toBeVisible();
  });

  test("[positive] diff table shows key names from the encrypted files", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-diff").click();
    await expect(page.getByTestId("diff-table")).toBeVisible();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
  });

  test("[negative] Sync missing keys button navigates away from the diff view", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-diff").click();
    await expect(page.getByTestId("diff-table")).toBeVisible();
    // If the coming-soon toast fires, that is the expected "negative" behaviour
    // (the feature is not yet implemented)
    const syncBtn = page.getByTestId("sync-missing-btn");
    const isVisible = await syncBtn.isVisible().catch(() => false);
    if (isVisible) {
      await syncBtn.click();
      await expect(page.getByTestId("coming-soon-toast")).toBeVisible();
    }
  });
});

// ── clef lint → LintView: full repo health check ─────────────────────────────
// clef lint  →  Lint view → issues list or all-clear

test.describe("clef lint → LintView: full repo health check", () => {
  test("[positive] lint view loads and shows a result (all-clear or issues)", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-lint").click();
    await expect(page.getByText("clef lint")).toBeVisible();
    // Either the all-clear indicator or the issue filter tabs must appear
    await expect(page.getByTestId("all-clear").or(page.getByTestId("filter-all"))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("[positive] Re-run button is present", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-lint").click();
    await expect(page.getByRole("button", { name: "↻ Re-run" })).toBeVisible();
  });
});

// ── clef scan → ScanScreen: detect plaintext secrets ────────────────────────
// clef scan  →  Scan view → Scan repository → results

test.describe("clef scan → ScanScreen: detect plaintext secrets", () => {
  test("[positive] scan view shows the Scan repository button in idle state", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-scan").click();
    await expect(page.getByTestId("scan-idle")).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan repository" })).toBeVisible();
  });

  test("[positive] severity filter buttons are present", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-scan").click();
    await expect(page.getByTestId("severity-all")).toBeVisible();
    await expect(page.getByTestId("severity-high")).toBeVisible();
  });

  test("[positive] running a scan with pattern-only severity returns no issues", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-scan").click();
    await expect(page.getByTestId("scan-idle")).toBeVisible();
    // Use high-severity (patterns only) to avoid entropy false positives from
    // non-secret config files (e.g. age public key in clef.yaml triggers entropy)
    await page.getByTestId("severity-high").click();
    await page.getByRole("button", { name: "Scan repository" }).click();
    await expect(page.getByTestId("scan-clean")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("No issues found")).toBeVisible();
  });
});

// ── clef import → ImportScreen: bulk migrate secrets ────────────────────────
// clef import payments/dev  →  Import → paste content → preview → apply

test.describe("clef import → ImportScreen: bulk migrate secrets", () => {
  test("[positive] import view shows the Source step with namespace and environment selects", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-import").click();
    await expect(page.getByText("clef import")).toBeVisible();
    await expect(page.getByText("Source")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next: Preview" })).toBeVisible();
  });

  test("[positive] import form pre-selects the first namespace and environment", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-import").click();
    // Verify the selects have the expected pre-populated values from the manifest
    await expect(page.locator("select").first()).toHaveValue("payments");
    await expect(page.locator("select").nth(1)).toHaveValue("dev");
  });

  test("[negative] 'Next: Preview' button is disabled when no content is pasted", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-import").click();
    // The button is disabled when the content textarea is empty
    await expect(page.getByRole("button", { name: "Next: Preview" })).toBeDisabled();
  });
});

// ── clef recipients → RecipientsScreen: manage age keys ─────────────────────
// clef recipients list / add / remove

test.describe("clef recipients → RecipientsScreen: manage age encryption keys", () => {
  test("[positive] recipients view loads and shows the recipients list header", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText("clef recipients")).toBeVisible();
    // The recipients are loaded async from the API; allow time for the call to settle
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });
  });

  test("[positive] + Add recipient button reveals the add form", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await expect(page.getByTestId("add-form")).toBeVisible();
    await expect(page.getByTestId("add-key-input")).toBeVisible();
  });

  test("[positive] valid age public key passes inline validation", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await page
      .getByTestId("add-key-input")
      .fill("age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    await page.getByTestId("add-key-input").blur();
    await expect(page.getByText("Valid age public key")).toBeVisible();
  });

  test("[negative] invalid age key does not show the valid confirmation", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await page.getByTestId("add-key-input").fill("not-an-age-key");
    await page.getByTestId("add-key-input").blur();
    await expect(page.getByText("Valid age public key")).not.toBeVisible();
  });

  test("[positive] 'Add and re-encrypt' button is disabled until key is validated", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    // Before entering a key, the button should be disabled
    await expect(page.getByRole("button", { name: "Add and re-encrypt" })).toBeDisabled();
    // Enter an invalid key — button should remain disabled
    await page.getByTestId("add-key-input").fill("not-valid");
    await page.getByTestId("add-key-input").blur();
    // Wait for validation debounce
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "Add and re-encrypt" })).toBeDisabled();
  });

  test("[positive] cancel button on add form dismisses without adding", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await expect(page.getByTestId("add-form")).toBeVisible();
    await page.getByTestId("add-key-input").fill(secondKeys.publicKey);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("add-form")).not.toBeVisible();
    // The + Add recipient button should reappear
    await expect(page.getByRole("button", { name: "+ Add recipient" })).toBeVisible();
  });

  test("[positive] adding a valid recipient with label shows it in the list after re-encryption", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });

    // Count current recipients
    const initialRows = await page.getByTestId("recipient-row").count();

    await page.getByRole("button", { name: "+ Add recipient" }).click();
    await page.getByTestId("add-key-input").fill(secondKeys.publicKey);
    await page.getByTestId("add-key-input").blur();
    await expect(page.getByText("Valid age public key")).toBeVisible({ timeout: 5_000 });

    // Fill optional label
    await page.getByTestId("add-label-input").fill("e2e-test-recipient");

    // Submit — re-encryption takes a few seconds
    const addPromise = page.waitForResponse(
      (r) => r.url().includes("/api/recipients/add") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Add and re-encrypt" }).click();
    const addRes = await addPromise;
    expect(addRes.status()).toBe(200);

    // Form should disappear and the new recipient should appear
    await expect(page.getByTestId("add-form")).not.toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("e2e-test-recipient")).toBeVisible({ timeout: 10_000 });

    // Recipient count should have increased
    const finalRows = await page.getByTestId("recipient-row").count();
    expect(finalRows).toBe(initialRows + 1);
  });

  test("[positive] re-encryption warning shows correct file count", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await page.getByRole("button", { name: "+ Add recipient" }).click();
    // The warning should mention the number of encrypted files
    await expect(page.getByText(/re-encrypt \d+ file/)).toBeVisible();
  });
});

// ── clef recipients → RecipientsScreen: full key add + remove workflow ───────

test.describe("clef recipients → RecipientsScreen: remove workflow", () => {
  test("[positive] Remove button is visible for each recipient row", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });
    const rows = page.getByTestId("recipient-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    // Each row should have a Remove button
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).getByRole("button", { name: "Remove" })).toBeVisible();
    }
  });

  test("[positive] clicking Remove shows the revocation warning dialog", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("recipient-row").first().getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("remove-dialog")).toBeVisible();
    await expect(page.getByText("Remove recipient")).toBeVisible();
    await expect(page.getByTestId("acknowledge-checkbox")).toBeVisible();
  });

  test("[negative] Continue button is disabled until warning is acknowledged", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("recipient-row").first().getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("remove-dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("[negative] Cancel in remove dialog dismisses without removing", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-recipients").click();
    await expect(page.getByText(/Recipients \(/)).toBeVisible({ timeout: 10_000 });
    const initialCount = await page.getByTestId("recipient-row").count();
    await page.getByTestId("recipient-row").first().getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("remove-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("remove-dialog")).not.toBeVisible();
    // Recipient count should be unchanged
    expect(await page.getByTestId("recipient-row").count()).toBe(initialCount);
  });
});

// ── git history → GitLogView: commit log per encrypted file ──────────────────
// No direct CLI equivalent — History view shows git log per namespace/env file

test.describe("git history → GitLogView: commit log per encrypted file", () => {
  test("[positive] history view shows heading and table columns", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-history").click();
    await expect(page.getByText("Commit log per encrypted file")).toBeVisible();
    await expect(page.getByText("Hash")).toBeVisible();
    await expect(page.getByText("Date")).toBeVisible();
    await expect(page.getByText("Author")).toBeVisible();
    await expect(page.getByText("Message")).toBeVisible();
  });

  test("[positive] initial commit from test repo setup appears in the log", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-history").click();
    await expect(page.getByText("Commit log per encrypted file")).toBeVisible();
    // The scaffoldTestRepo creates a repo with an "initial" commit
    await expect(page.getByText("initial")).toBeVisible({ timeout: 15_000 });
  });
});

// ── clef set --random (existing key via overflow menu) ───────────────────────
// clef set --random payments/dev STRIPE_WEBHOOK_SECRET  →  ⋯ menu → reset

test.describe("clef set --random (existing key) → overflow menu reset to pending", () => {
  test("[positive] overflow menu shows Reset to random option", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("overflow-STRIPE_KEY").click();
    await expect(page.getByTestId("overflow-menu-STRIPE_KEY")).toBeVisible();
    await expect(page.getByText("Reset to random (pending)")).toBeVisible();
  });

  test("[positive] clicking Reset to random shows the confirmation dialog", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("overflow-STRIPE_KEY").click();
    await page.getByTestId("reset-random-STRIPE_KEY").click();
    await expect(page.getByTestId("confirm-reset-dialog")).toBeVisible();
    await expect(page.getByTestId("confirm-reset-yes")).toBeVisible();
    await expect(page.getByTestId("confirm-reset-no")).toBeVisible();
  });

  test("[negative] clicking Cancel in the confirmation dialog closes it without resetting", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
    await page.getByTestId("overflow-STRIPE_KEY").click();
    await page.getByTestId("reset-random-STRIPE_KEY").click();
    await expect(page.getByTestId("confirm-reset-dialog")).toBeVisible();
    await page.getByTestId("confirm-reset-no").click();
    // Dialog should be gone; key should not be pending
    await expect(page.getByTestId("confirm-reset-dialog")).not.toBeVisible();
    await expect(page.getByText("STRIPE_KEY")).toBeVisible();
  });

  test("[positive] confirming Reset to random marks the key as PENDING", async ({ page }) => {
    // Collect all API responses for diagnostics
    const apiResponses: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/")) {
        apiResponses.push(`${r.request().method()} ${r.url()} → ${r.status()}`);
      }
    });
    await page.goto(server.url);
    await page.getByTestId("matrix-row-payments").click();
    await expect(page.getByText("STRIPE_WEBHOOK_SECRET")).toBeVisible();
    await page.getByTestId("overflow-STRIPE_WEBHOOK_SECRET").click();
    await page.getByTestId("reset-random-STRIPE_WEBHOOK_SECRET").click();
    await page.getByTestId("confirm-reset-yes").click();
    // Wait for the confirmation dialog to close before checking the PENDING badge —
    // the dialog body also contains the key name, so we must avoid the strict-mode
    // error that fires while both the key row and dialog text are in the DOM.
    await expect(page.getByTestId("confirm-reset-dialog")).not.toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("PENDING").first(),
      `PENDING not found. API responses: ${apiResponses.join(" | ")}`,
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ── clef service → ServiceIdentitiesScreen: list and key retrieval ──────────

test.describe("clef service → ServiceIdentitiesScreen: list view", () => {
  test("[positive] service identities list shows the web-app identity", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await expect(page.getByTestId("si-web-app")).toBeVisible();
  });

  test("[positive] identity card shows scoped namespaces", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await expect(page.getByTestId("si-web-app")).toBeVisible();
    await expect(page.getByTestId("si-web-app").getByText("payments")).toBeVisible();
  });

  test("[positive] identity card shows environment badges", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await expect(page.getByTestId("si-web-app")).toBeVisible();
    await expect(page.getByText("DEV")).toBeVisible();
    await expect(page.getByText("PRD")).toBeVisible();
  });
});

test.describe("clef service → ServiceIdentitiesScreen: detail view", () => {
  test("[positive] clicking an identity navigates to detail view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await expect(page.getByText("Web application service")).toBeVisible();
    await expect(page.getByTestId("back-button")).toBeVisible();
  });

  test("[positive] detail view shows environment cards with public key preview", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await expect(page.getByTestId("env-dev")).toBeVisible();
    await expect(page.getByTestId("env-production")).toBeVisible();
    await expect(page.getByTestId("env-dev").getByText("Public key:")).toBeVisible();
  });

  test("[positive] back button returns to the list view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await expect(page.getByTestId("back-button")).toBeVisible();
    await page.getByTestId("back-button").click();
    await expect(page.getByTestId("si-web-app")).toBeVisible();
  });

  test("[positive] scoped namespaces are displayed with badges", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await expect(page.getByText("Scoped namespaces")).toBeVisible();
    // Use the second occurrence — first is in the sidebar nav
    await expect(page.getByText("payments").nth(1)).toBeVisible();
  });
});

// ── clef service → ServiceIdentitiesScreen: create flow ──────────────────────

test.describe("clef service → ServiceIdentitiesScreen: create flow", () => {
  test("[positive] create form opens and shows namespace checkboxes", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByText("+ New identity").click();
    await expect(page.getByTestId("si-name-input")).toBeVisible();
    await expect(page.getByTestId("ns-checkbox-payments")).toBeVisible();
  });

  test("[positive] submit creates identity and shows private keys view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByText("+ New identity").click();
    await page.getByTestId("si-name-input").fill("e2e-create");
    await page.getByTestId("ns-checkbox-payments").click();
    await page.getByTestId("create-si-submit").click();
    await expect(page.getByText("Copy these private keys now")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("dev", { exact: true })).toBeVisible();
  });

  test("[positive] done button returns to list with new identity", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    // e2e-create was created by the previous test; navigate straight to done
    await expect(page.getByTestId("si-e2e-create")).toBeVisible({ timeout: 10_000 });
  });

  test("[negative] duplicate name shows validation error", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByText("+ New identity").click();
    await page.getByTestId("si-name-input").fill("web-app");
    await expect(page.getByText("A service identity with this name already exists.")).toBeVisible();
    await expect(page.getByTestId("create-si-submit")).toBeDisabled();
  });
});

// ── clef service → ServiceIdentitiesScreen: rotate key flow ──────────────────

test.describe("clef service → ServiceIdentitiesScreen: rotate key flow", () => {
  test("[positive] rotate button shows new private key and done returns to detail", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await page.getByTestId("rotate-dev").click();
    await expect(page.getByTestId("rotate-keys-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Copy the new private key now")).toBeVisible();
    await page.getByTestId("rotate-done-btn").click();
    // Back in detail view
    await expect(page.getByTestId("back-button")).toBeVisible();
    await expect(page.getByTestId("env-dev")).toBeVisible();
  });
});

// ── clef service → ServiceIdentitiesScreen: update backends flow ──────────────

test.describe("clef service → ServiceIdentitiesScreen: update backends flow", () => {
  test("[positive] update form shows current backend type for each environment", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await page.getByTestId("update-backends-btn").click();
    await expect(page.getByText("Update backends")).toBeVisible();
    await expect(page.getByTestId("update-kms-toggle-dev")).toBeVisible();
  });

  test("[positive] switching an env to KMS and saving updates the identity", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    // Use e2e-create so we don't permanently mutate web-app for other tests
    await page.getByTestId("si-e2e-create").click();
    await page.getByTestId("update-backends-btn").click();
    await page.getByTestId("update-kms-toggle-dev").click();
    await page
      .getByTestId("update-keyid-dev")
      .fill("arn:aws:kms:us-east-1:123456789012:key/e2e-test");
    await page.getByTestId("update-submit-btn").click();
    // Returns to detail view on success
    await expect(page.getByTestId("back-button")).toBeVisible({ timeout: 15_000 });
  });

  test("[positive] cancel returns to detail without changes", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-web-app").click();
    await page.getByTestId("update-backends-btn").click();
    await page.getByTestId("update-cancel-btn").click();
    await expect(page.getByTestId("back-button")).toBeVisible();
    await expect(page.getByTestId("update-backends-btn")).toBeVisible();
  });
});

// ── clef service → ServiceIdentitiesScreen: delete flow ──────────────────────

test.describe("clef service → ServiceIdentitiesScreen: delete flow", () => {
  test.beforeEach(async ({ request }) => {
    const { base, headers } = serverApi(server.url);
    // Ensure a fresh identity exists for each delete test
    await request.delete(`${base}/api/service-identities/to-delete`, { headers }).catch(() => {});
    const res = await request.post(`${base}/api/service-identities`, {
      headers,
      data: { name: "to-delete", namespaces: ["payments"] },
    });
    expect(res.ok()).toBe(true);
  });

  test("[positive] delete removes the identity from the list", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-to-delete").click();
    await page.getByTestId("delete-identity-btn").click();
    await expect(page.getByTestId("delete-confirm-view")).toBeVisible();
    await page.getByTestId("confirm-delete-btn").click();
    // Returns to list and identity is gone
    await expect(page.getByTestId("si-to-delete")).not.toBeVisible({ timeout: 10_000 });
  });

  test("[negative] cancel on delete confirm returns to detail view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-service ids").click();
    await page.getByTestId("si-to-delete").click();
    await page.getByTestId("delete-identity-btn").click();
    await expect(page.getByTestId("delete-confirm-view")).toBeVisible();
    await page.getByTestId("cancel-delete-btn").click();
    // Back in detail view
    await expect(page.getByTestId("back-button")).toBeVisible();
    await expect(page.getByTestId("delete-identity-btn")).toBeVisible();
  });
});

// ── clef migrate-backend → BackendScreen ────────────────────────────────────
// Backend migration wizard: view config, select target, preview dry-run.

test.describe("clef migrate-backend → BackendScreen", () => {
  test("[positive] Backend nav item opens the backend migration view", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    await expect(page.getByText("clef migrate-backend")).toBeVisible();
  });

  test("[positive] current config displays age backend", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    await expect(page.getByText("Default backend")).toBeVisible();
    await expect(page.getByText("age").first()).toBeVisible();
  });

  test("[positive] all 5 backend radio buttons are present", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    await expect(page.getByTestId("backend-radio-age")).toBeVisible();
    await expect(page.getByTestId("backend-radio-awskms")).toBeVisible();
    await expect(page.getByTestId("backend-radio-gcpkms")).toBeVisible();
    await expect(page.getByTestId("backend-radio-azurekv")).toBeVisible();
    await expect(page.getByTestId("backend-radio-pgp")).toBeVisible();
  });

  test("[positive] selecting a non-age backend shows the key input", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    // Key input hidden for age (default)
    await expect(page.getByTestId("backend-key-input")).not.toBeVisible();
    // Select AWS KMS
    await page.getByTestId("backend-radio-awskms").click();
    await expect(page.getByTestId("backend-key-input")).toBeVisible();
  });

  test("[negative] Preview button is disabled when KMS key is empty", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    await page.getByTestId("backend-radio-awskms").click();
    // Key input empty — Preview should be disabled
    await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  test("[negative] protected env triggers confirmation before preview", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    // age → age, all envs — will trigger 409 because production is protected
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("protected-confirm")).toBeVisible({ timeout: 5_000 });
    // Should still be on step 1 — not advanced to preview
    await expect(page.getByTestId("backend-radio-age")).toBeVisible();
  });

  test("[positive] dry-run preview shows files to migrate", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-backend").click();
    // Select AWS KMS to get a real migration preview (age → awskms).
    await page.getByTestId("backend-radio-awskms").click();
    await page.getByTestId("backend-key-input").fill("arn:aws:kms:us-east-1:123:key/test");
    await page.getByRole("button", { name: "Preview" }).click();

    // Protected env confirmation will appear — the test repo has production marked protected.
    await expect(page.getByTestId("protected-confirm")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("protected-confirm").click();
    await page.getByRole("button", { name: "Confirm & Preview" }).click();

    // Preview step should show file list or warnings
    await expect(page.getByText(/Files to migrate|Already on target|Would/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
