/**
 * Playwright E2E tests: Schema editor screen
 *
 * Covers the gaps the SchemaEditor unit test cannot reach:
 *   - End-to-end paint: nav → empty state → add → save → reload shows row
 *   - Pattern preview against real decrypted sample values from the test repo
 *   - Validation surfaces (duplicate name, invalid regex, key-name format)
 *   - Server save failure (404 namespace) — exercises the error banner path
 *
 * The unit test mocks fetch and asserts the same matrix of states; this spec
 * exists so the same matrix continues to hold once the inline-style layer is
 * replaced by a Tailwind primitive set.
 */
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, resetTestRepo, type TestRepo } from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

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

// Each test mutates the repo (writes schemas/payments.yaml, edits manifest).
// Reset to the scaffold's initial commit so order doesn't matter.
test.beforeEach(() => {
  resetTestRepo(repo);
});

test.describe("clef schema → SchemaEditor: load + empty state", () => {
  test("[positive] schema nav opens the editor with the empty-state placeholder", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();

    await expect(page.getByText(/Schema · payments/)).toBeVisible();
    await expect(page.getByText(/no schema attached yet/i)).toBeVisible();
    await expect(page.getByText(/No keys declared yet/i)).toBeVisible();
  });

  test("[positive] + Add key reveals one editable row", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();

    await page.getByRole("button", { name: "+ Add key" }).click();

    await expect(page.getByPlaceholder("KEY_NAME")).toBeVisible();
    await expect(page.locator("select").first()).toBeVisible();
    await expect(page.getByText("required", { exact: true })).toBeVisible();
  });
});

test.describe("clef schema → SchemaEditor: pattern preview against decrypted values", () => {
  test("[positive] regex matching the dev sample value renders the match indicator", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    // The dev cell encrypts STRIPE_KEY=sk_test_abc123. A pattern that matches
    // proves the editor pulled the decrypted sample through /api/namespace/.../...
    await page.getByPlaceholder("KEY_NAME").fill("STRIPE_KEY");
    await page.getByPlaceholder(/pattern: \^regex\$/).fill("^sk_test_");

    // Spinner shows briefly (180ms), then the result settles. Wait for the
    // result element rather than the spinner — the spinner is inherently racy.
    await expect(page.getByTestId("pattern-result")).toHaveText(/matches sample value/);
  });

  test("[negative] regex that misses the sample value renders the miss indicator", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    await page.getByPlaceholder("KEY_NAME").fill("STRIPE_KEY");
    await page.getByPlaceholder(/pattern: \^regex\$/).fill("^will_never_match_");

    await expect(page.getByTestId("pattern-result")).toHaveText(/did not match/);
  });

  test("[negative] invalid regex disables Save and shows a per-row error", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    await page.getByPlaceholder("KEY_NAME").fill("STRIPE_KEY");
    await page.getByPlaceholder(/pattern: \^regex\$/).fill("[unclosed");

    await expect(page.getByText(/Pattern is not a valid regex/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

test.describe("clef schema → SchemaEditor: validation", () => {
  test("[negative] duplicate key name disables Save and flags the second row", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();

    await page.getByRole("button", { name: "+ Add key" }).click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    const inputs = page.getByPlaceholder("KEY_NAME");
    await inputs.nth(0).fill("STRIPE_KEY");
    await inputs.nth(1).fill("STRIPE_KEY");

    await expect(page.getByText(/Duplicate key name/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("[negative] invalid identifier format disables Save", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    await page.getByPlaceholder("KEY_NAME").fill("9_starts_with_digit");

    await expect(page.getByText(/Key name must start with a letter or underscore/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

test.describe("clef schema → SchemaEditor: save flow", () => {
  test("[positive] save creates schemas/payments.yaml and shows the saved confirmation", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();

    await page.getByPlaceholder("KEY_NAME").fill("STRIPE_KEY");

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Saved at .* · schemas\/payments\.yaml/)).toBeVisible();

    // The schema file should now exist on disk and contain the declared key.
    const schemaPath = path.join(repo.dir, "schemas", "payments.yaml");
    expect(fs.existsSync(schemaPath)).toBe(true);
    const content = fs.readFileSync(schemaPath, "utf-8");
    expect(content).toMatch(/STRIPE_KEY/);
  });

  test("[positive] reloading the page shows the previously-saved schema as attached", async ({
    page,
  }) => {
    // Seed the schema directly on disk so we don't depend on the previous
    // test having run — describe blocks share a beforeEach reset.
    fs.mkdirSync(path.join(repo.dir, "schemas"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, "schemas", "payments.yaml"),
      "keys:\n  STRIPE_KEY:\n    type: string\n    required: true\n",
    );
    // Wire it up through the manifest. The structure manager would commit, but
    // we're simulating "previous session" so direct write + commit is fine.
    //
    // Normalize line endings before the regex replace: on Windows runners
    // `git reset --hard` (in beforeEach) materializes the manifest with CRLF
    // when autocrlf is on, which makes the `\n`-anchored regex below silently
    // miss and the schema attachment never lands. Coerce to LF so the test
    // behaves identically across platforms.
    const manifestPath = path.join(repo.dir, "clef.yaml");
    const manifest = fs.readFileSync(manifestPath, "utf-8").replace(/\r\n/g, "\n");
    fs.writeFileSync(
      manifestPath,
      manifest.replace(
        /- name: payments\n {4}description: Payment secrets/,
        "- name: payments\n    description: Payment secrets\n    schema: schemas/payments.yaml",
      ),
    );

    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();

    await expect(page.getByText("schemas/payments.yaml")).toBeVisible();
    await expect(page.locator('input[value="STRIPE_KEY"]')).toBeVisible();
    // No empty-state placeholder when the schema has rows.
    await expect(page.getByText(/No keys declared yet/i)).not.toBeVisible();
  });

  test("[negative] save against a missing namespace surfaces the server error banner", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-schema").click();
    await page.getByRole("button", { name: "+ Add key" }).click();
    await page.getByPlaceholder("KEY_NAME").fill("STRIPE_KEY");

    // Force the next PUT to a nonexistent namespace by intercepting the route.
    // This exercises the 404 → error-banner path without needing to fork the
    // manifest mid-test.
    await page.route("**/api/namespaces/payments/schema", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Namespace 'payments' not found.", code: "NOT_FOUND" }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Namespace 'payments' not found/)).toBeVisible();
  });
});
