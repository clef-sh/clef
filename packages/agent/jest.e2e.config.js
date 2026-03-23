/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/e2e/**/*.e2e.test.ts"],
  testTimeout: 60_000,
  // On Windows, killing the agent subprocess leaves orphaned stdio handles
  // that keep the Node event loop alive. forceExit ensures Jest exits
  // cleanly after all tests pass.
  forceExit: true,
};
