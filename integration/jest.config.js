/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  testTimeout: 30000,
  globalTeardown: "./teardown.ts",
};

module.exports = config;
