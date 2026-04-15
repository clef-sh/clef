/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  moduleNameMapper: {
    "^age-encryption$": "<rootDir>/src/__mocks__/age-encryption.ts",
    "^write-file-atomic$": "<rootDir>/src/__mocks__/write-file-atomic.ts",
  },
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
    // Tier 1 modules — security and correctness critical
    "./src/sops/client.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/pending/metadata.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/scanner/patterns.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/diff/engine.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/manifest/parser.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/policy/parser.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/policy/evaluator.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/compliance/generator.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
    "./src/compliance/run.ts": {
      lines: 95,
      functions: 95,
      branches: 90,
    },
  },
};
