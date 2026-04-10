/**
 * Blackbox E2E test for `clef serve`.
 *
 * Spawns the SEA binary against a real sops-encrypted test repo, makes
 * an HTTP request to /v1/secrets, and verifies the decrypted values.
 *
 * This catches the bug where serve packed an artifact for the production
 * service identity's public key but tried to decrypt with the user's key.
 * Unit tests mocked ArtifactDecryptor and never noticed.
 *
 * Prerequisites (handled by CI, or run manually before testing locally):
 *   npm run build:sea -w packages/cli
 */
import * as fs from "fs";
import { test, expect } from "@playwright/test";
import { generateAgeKey, type AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, type TestRepo } from "../setup/repo";
import { startClefServe, type ServeInfo } from "../setup/server";

let keys: AgeKeyPair;
let repo: TestRepo;
let serve: ServeInfo;

test.beforeAll(async () => {
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
  serve = await startClefServe(repo.dir, keys.keyFilePath, "web-app", "dev");
});

test.afterAll(async () => {
  if (serve) await serve.stop();
  if (repo) repo.cleanup();
  if (keys?.tmpDir) {
    try {
      fs.rmSync(keys.tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
});

test("clef serve returns decrypted secrets via /v1/secrets", async ({ request }) => {
  const response = await request.get(`${serve.url}/v1/secrets`, {
    headers: { Authorization: `Bearer ${serve.token}` },
  });
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toEqual({
    STRIPE_KEY: "sk_test_abc123",
    STRIPE_WEBHOOK_SECRET: "whsec_xyz789",
  });
});

test("clef serve rejects requests without a bearer token", async ({ request }) => {
  const response = await request.get(`${serve.url}/v1/secrets`);
  expect(response.status()).toBe(401);
});

test("clef serve rejects requests with the wrong bearer token", async ({ request }) => {
  const response = await request.get(`${serve.url}/v1/secrets`, {
    headers: { Authorization: "Bearer wrong-token" },
  });
  expect(response.status()).toBe(401);
});

test("clef serve returns key names via /v1/keys", async ({ request }) => {
  const response = await request.get(`${serve.url}/v1/keys`, {
    headers: { Authorization: `Bearer ${serve.token}` },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as string[];
  expect(body.sort()).toEqual(["STRIPE_KEY", "STRIPE_WEBHOOK_SECRET"]);
});
