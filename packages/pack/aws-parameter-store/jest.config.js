/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  collectCoverageFrom: ["<rootDir>/src/**/*.ts", "!<rootDir>/src/**/*.test.ts"],
  coverageThreshold: {
    global: {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
  },
};
