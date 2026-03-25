/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/**/*.test.ts",
    "!<rootDir>/src/index.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    "./src/handler.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
    "./src/envelope.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
  },
};
