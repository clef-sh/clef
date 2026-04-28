/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/integration/**/*.integration.test.ts"],
  testTimeout: 30_000,
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.integration.json",
    },
  },
};
