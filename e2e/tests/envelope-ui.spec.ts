/**
 * Playwright E2E tests: Envelope debugger UI screen
 *
 * Companion to envelope-smoke.spec.ts (which tests the CLI directly).  This
 * spec drives the same packed artifact through the browser UI to catch
 * regressions in the React component, the /api/envelope/* routes, and the
 * 15-second auto-clear reveal timer.
 *
 * The artifact is encrypted for the service-identity key, NOT the operator's
 * primary age key — so we launch `clef ui` with `CLEF_AGE_KEY_FILE` pointed
 * at the SI key.  This mirrors the real operator workflow the debugger is
 * designed for: triage a service-identity-packed envelope without touching
 * the rest of `clef ui`.
 */
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, type TestRepo } from "../setup/repo";
import { startClefUI, type ServerInfo } from "../setup/server";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SEA_BINARY = path.join(REPO_ROOT, "packages/cli/dist/clef");
const NODE_ENTRY = path.join(REPO_ROOT, "packages/cli/bin/clef.js");

function resolveClefBin(): { command: string; prefixArgs: string[] } {
  const mode = (process.env.CLEF_E2E_MODE ?? "sea") as "sea" | "node";
  if (mode === "node") {
    if (!fs.existsSync(NODE_ENTRY)) {
      throw new Error(`CLI entry not found at ${NODE_ENTRY}.`);
    }
    return { command: process.execPath, prefixArgs: [NODE_ENTRY] };
  }
  const bin = process.platform === "win32" ? SEA_BINARY + ".exe" : SEA_BINARY;
  if (!fs.existsSync(bin)) {
    throw new Error(`SEA binary not found at ${bin}.`);
  }
  return { command: bin, prefixArgs: [] };
}

let keys: AgeKeyPair;
let siKeys: AgeKeyPair;
let repo: TestRepo;
let server: ServerInfo;
let signingPublicKeyBase64: string;
let envelopeJson: string;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  siKeys = await generateAgeKey();
  repo = scaffoldTestRepo(keys, siKeys);

  // Generate an ed25519 signing keypair so we can pack a SIGNED envelope and
  // test verify-with-correct-key + verify-with-wrong-key paths.
  const kp = crypto.generateKeyPairSync("ed25519");
  const signingPrivateKeyBase64 = (
    kp.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer
  ).toString("base64");
  signingPublicKeyBase64 = (
    kp.publicKey.export({ type: "spki", format: "der" }) as Buffer
  ).toString("base64");

  const artifactPath = path.join(repo.dir, "envelope-ui-e2e.json");
  const { command, prefixArgs } = resolveClefBin();
  execFileSync(
    command,
    [
      ...prefixArgs,
      "--dir",
      repo.dir,
      "pack",
      "web-app",
      "dev",
      "--output",
      artifactPath,
      "--signing-key",
      signingPrivateKeyBase64,
    ],
    {
      cwd: repo.dir,
      env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  envelopeJson = fs.readFileSync(artifactPath, "utf-8");

  // Critical: launch the UI with CLEF_AGE_KEY_FILE pointed at the SI key, not
  // the operator's primary key.  The envelope's recipients only include the
  // SI public key (web-app's identity), so decrypt would fail with "no
  // identity matched" if we used `keys.keyFilePath`.
  process.env.CLEF_AGE_KEY_FILE = siKeys.keyFilePath;
  server = await startClefUI(repo.dir, keys.keyFilePath);
});

test.afterAll(async () => {
  delete process.env.CLEF_AGE_KEY_FILE;
  if (server) await server.stop();
  if (repo) repo.cleanup();
  for (const k of [keys, siKeys]) {
    if (k?.tmpDir) {
      try {
        fs.rmSync(k.tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
});

test.describe("envelope debugger → paste status", () => {
  test("[positive] valid JSON shows the green 'valid' status pill", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();

    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);

    await expect(page.getByTestId("paste-status")).toContainText(/valid \(/);
  });

  test("[negative] malformed JSON shows the 'invalid JSON' status and disables Load", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();

    await page.getByTestId("envelope-paste-textarea").fill("{ this is not: valid JSON");

    await expect(page.getByTestId("paste-status")).toContainText(/invalid JSON/i);
    await expect(page.getByRole("button", { name: "Load" })).toBeDisabled();
  });
});

test.describe("envelope debugger → inspect card", () => {
  test("[positive] Load populates the inspect card with identity and verified hash", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();

    const inspectCard = page.getByTestId("envelope-card-inspect");
    await expect(inspectCard).toBeVisible();
    await expect(inspectCard).toContainText("web-app");
    await expect(inspectCard).toContainText("dev");
    await expect(inspectCard).toContainText("verified");
  });

  test("[negative] structurally-valid JSON that isn't an envelope shows the inspect error", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page
      .getByTestId("envelope-paste-textarea")
      .fill(JSON.stringify({ hello: "world" }, null, 2));
    await page.getByRole("button", { name: "Load" }).click();

    await expect(page.getByTestId("envelope-error")).toBeVisible();
  });
});

test.describe("envelope debugger → verify card", () => {
  test("[positive] correct signer public key drives overall = PASS", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();

    await page.getByTestId("envelope-signer-key").fill(signingPublicKeyBase64);
    await page.getByRole("button", { name: "Run verify" }).click();

    await expect(page.getByTestId("verify-overall")).toContainText("PASS");
  });

  test("[negative] wrong signer public key drives overall = FAIL", async ({ page }) => {
    // Generate a different keypair to act as the wrong signer.
    const wrongKp = crypto.generateKeyPairSync("ed25519");
    const wrongPub = (wrongKp.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
      "base64",
    );

    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();

    await page.getByTestId("envelope-signer-key").fill(wrongPub);
    await page.getByRole("button", { name: "Run verify" }).click();

    await expect(page.getByTestId("verify-overall")).toContainText("FAIL");
  });
});

test.describe("envelope debugger → decrypt + reveal", () => {
  test("[positive] Decrypt (keys) lists key names with values masked", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();

    await page.getByTestId("decrypt-keys").click();

    await expect(page.getByTestId("decrypt-row-STRIPE_KEY")).toBeVisible();
    await expect(page.getByTestId("decrypt-row-STRIPE_WEBHOOK_SECRET")).toBeVisible();

    // Masked values: literal bullet character × 10. The actual decrypted
    // value (sk_test_abc123) must NOT be in the DOM yet.
    await expect(page.getByTestId("decrypt-value-STRIPE_KEY")).toHaveText("●●●●●●●●●●");
    await expect(page.getByTestId("decrypt-row-STRIPE_KEY")).not.toContainText("sk_test_abc123");
  });

  test("[positive] Reveal all shows values + warning banner with countdown", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();
    await page.getByTestId("decrypt-keys").click();
    await page.getByTestId("reveal-all").click();

    await expect(page.getByTestId("decrypt-value-STRIPE_KEY")).toHaveText("sk_test_abc123");
    await expect(page.getByTestId("reveal-banner")).toBeVisible();
    await expect(page.getByTestId("reveal-countdown")).toContainText(/0:\d{2}/);
  });

  test("[positive] reveal timer auto-clears within 17 seconds", async ({ page }) => {
    await page.goto(server.url);
    await page.getByTestId("nav-envelope").click();
    await page.getByTestId("envelope-paste-textarea").fill(envelopeJson);
    await page.getByRole("button", { name: "Load" }).click();
    await page.getByTestId("decrypt-keys").click();
    await page.getByTestId("reveal-all").click();

    // Banner is up.
    await expect(page.getByTestId("reveal-banner")).toBeVisible();

    // 15s timer + a small buffer for jitter / clock granularity.
    await expect(page.getByTestId("reveal-banner")).not.toBeVisible({ timeout: 17_000 });
    await expect(page.getByTestId("decrypt-value-STRIPE_KEY")).toHaveText("●●●●●●●●●●");
  });
});
