import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Each test navigates to the live server; allow time for sops decryption.
  timeout: 60_000,
  // No retries — failures should be investigated, not silently re-run.
  retries: 0,
  // Single worker: the shared server is started in beforeAll and bound to a
  // single port. Parallel workers would race over the same handle.
  workers: 1,
  // SOPS decrypt can take 2-6s on CI; raise the default expect timeout
  // so assertions after navigation don't flake on slow runners.
  expect: {
    timeout: 10_000,
  },
  use: {
    headless: true,
    // No baseURL — each test navigates to the full tokenized URL.
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
});
