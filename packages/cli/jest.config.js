/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@clef-sh/core$": "<rootDir>/../core/src/index.ts",
    "^@clef-sh/ui$": "<rootDir>/src/__mocks__/ui-server.ts",
    "^age-encryption$": "<rootDir>/../core/src/__mocks__/age-encryption.ts",
    // Pin write-file-atomic to core's nested copy so both CLI tests and
    // core's source see the same module instance under jest.mock(). Without
    // this, CLI resolves the v4 hoisted by @jest/transform while core
    // resolves its own v7, and jest.mock() only intercepts the CLI path.
    "^write-file-atomic$": "<rootDir>/../core/node_modules/write-file-atomic",
  },
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/**/*.test.ts",
    "!<rootDir>/src/index.ts",
    "!<rootDir>/src/subprocess.ts",
    "!<rootDir>/src/**/*.d.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
};
