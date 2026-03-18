/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@clef-sh/core$": "<rootDir>/../core/src/index.ts",
    "^@clef-sh/ui$": "<rootDir>/src/__mocks__/ui-server.ts",
    "^@clef-sh/agent$": "<rootDir>/src/__mocks__/agent.ts",
    "^age-encryption$": "<rootDir>/../core/src/__mocks__/age-encryption.ts",
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
