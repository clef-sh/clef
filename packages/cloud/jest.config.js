/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "<rootDir>/src/**/*.tsx",
    "!<rootDir>/src/**/*.test.ts",
    "!<rootDir>/src/**/*.test.tsx",
    "!<rootDir>/src/index.ts",
    "!<rootDir>/src/cli.ts",
  ],
};
